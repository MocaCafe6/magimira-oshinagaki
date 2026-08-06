/**
 * Playwright のページから X の GraphQL レスポンスを傍受する。
 *
 * DOM をパースしない理由:
 *  - React のクラス名は難読化されており頻繁に変わる
 *  - 仮想スクロールのため DOM 上に全件が存在しない
 *  - JSON なら extended_entities から原寸画像URLが確実に取れる
 */

import type { Page, Response } from 'playwright';

import { sleep } from './io';

/** 傍受対象の GraphQL オペレーション */
const TARGET_OPS = ['SearchTimeline', 'UserTweets', 'UserTweetsAndReplies', 'UserByScreenName'];

const GRAPHQL_RE = new RegExp(`/i/api/graphql/[^/]+/(${TARGET_OPS.join('|')})`);

export type Capture = {
  op: string;
  body: unknown;
};

/**
 * X が返すレート制限の状態。
 *
 * X の検索は概ね 15分あたり 50 リクエスト程度で制限される。
 * 推測でバックオフするより、レスポンスヘッダの reset 時刻まで
 * 正確に待つほうが速く、かつ確実に通る。
 */
export type RateLimitInfo = {
  limit: number | null;
  remaining: number | null;
  /** リセット時刻（epoch ミリ秒） */
  resetAt: number | null;
};

export class RateLimitError extends Error {
  constructor(readonly detail: string) {
    super(`X にレート制限されました: ${detail}`);
    this.name = 'RateLimitError';
  }
}

/** JSON に X のレート制限エラー（code 88 / 429）が含まれるか */
function jsonHasRateLimit(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const errors = (body as Record<string, unknown>)['errors'];
  if (!Array.isArray(errors)) return null;
  for (const e of errors) {
    if (typeof e !== 'object' || e === null) continue;
    const rec = e as Record<string, unknown>;
    const code = rec['code'];
    const message = typeof rec['message'] === 'string' ? rec['message'] : '';
    if (code === 88 || /rate limit/i.test(message)) {
      return message || `code=${String(code)}`;
    }
  }
  return null;
}

/**
 * ページに取り付けて GraphQL レスポンスを溜め込むコレクタ。
 * レスポンス本文の取得は非同期なので、取りこぼしを防ぐため
 * 待ち合わせ用の Promise を内部に保持する。
 */
export class ResponseCollector {
  readonly captures: Capture[] = [];
  private pending: Promise<void>[] = [];
  private rateLimitedReason: string | null = null;
  private rateLimit: RateLimitInfo = { limit: null, remaining: null, resetAt: null };
  private readonly onResponse: (res: Response) => void;

  constructor(private readonly page: Page) {
    this.onResponse = (res) => this.handle(res);
    page.on('response', this.onResponse);
  }

  /** レート制限ヘッダを取り込む。X は GraphQL のレスポンスに載せてくる */
  private readRateLimit(res: Response): void {
    const h = res.headers();
    const limit = Number(h['x-rate-limit-limit']);
    const remaining = Number(h['x-rate-limit-remaining']);
    const reset = Number(h['x-rate-limit-reset']);
    if (Number.isFinite(limit)) this.rateLimit.limit = limit;
    if (Number.isFinite(remaining)) this.rateLimit.remaining = remaining;
    // reset は epoch 秒
    if (Number.isFinite(reset) && reset > 0) this.rateLimit.resetAt = reset * 1000;
  }

  private handle(res: Response): void {
    const url = res.url();
    const m = GRAPHQL_RE.exec(url);
    if (!m) {
      // GraphQL 以外でも 429 はレート制限の合図
      if (res.status() === 429) this.rateLimitedReason ??= `HTTP 429 ${url}`;
      return;
    }
    const op = m[1]!;
    this.readRateLimit(res);

    if (res.status() === 429) {
      this.rateLimitedReason ??= `HTTP 429 on ${op}`;
      return;
    }

    this.pending.push(
      (async () => {
        try {
          const ct = res.headers()['content-type'] ?? '';
          if (!ct.includes('json')) return;
          const body: unknown = await res.json();
          const rl = jsonHasRateLimit(body);
          if (rl) {
            this.rateLimitedReason ??= `${op}: ${rl}`;
            return;
          }
          this.captures.push({ op, body });
        } catch {
          // 本文が取れないレスポンス（中断・リダイレクト等）は黙って捨てる
        }
      })(),
    );
  }

  get rateLimited(): string | null {
    return this.rateLimitedReason;
  }

  /** 直近に観測したレート制限の状態。reset を跨いでも値は保持する */
  get rateLimitInfo(): RateLimitInfo {
    return { ...this.rateLimit };
  }

  /** リセットまでの待ち時間（ミリ秒）。不明なら null */
  waitUntilReset(bufferMs = 5_000): number | null {
    if (this.rateLimit.resetAt === null) return null;
    const ms = this.rateLimit.resetAt - Date.now() + bufferMs;
    return ms > 0 ? ms : 0;
  }

  hasOp(ops: string[]): boolean {
    return this.captures.some((c) => ops.includes(c.op));
  }

  /** 進行中の本文取得を待ってから中身を返す */
  async drain(): Promise<unknown[]> {
    await Promise.all(this.pending);
    return this.captures.map((c) => c.body);
  }

  /**
   * 次のハンドルに移るときに呼ぶ。
   * レート制限の残数・リセット時刻はハンドルを跨いで有効なので消さない。
   */
  reset(): void {
    this.captures.length = 0;
    this.pending = [];
    this.rateLimitedReason = null;
  }

  dispose(): void {
    this.page.off('response', this.onResponse);
  }
}

/**
 * 指定オペレーションのレスポンスが来るまで待つ。
 * 来なくてもエラーにはせず、待ち切れたかを返す（0件が正しい場合もある）。
 */
export async function waitForOps(
  collector: ResponseCollector,
  ops: string[],
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (collector.rateLimited) return false;
    if (collector.hasOp(ops)) {
      // 追加のページングレスポンスを取りこぼさないよう少し待つ
      await sleep(800);
      return true;
    }
    await sleep(200);
  }
  return false;
}
