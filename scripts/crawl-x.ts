/**
 * X クローラー。公式一覧から得たハンドルごとにお品書き投稿を収集する。
 *
 *   npm run crawl-x -- --limit 3      … まず少数で試す（推奨）
 *   npm run crawl-x -- --handle nulut … 特定ハンドルだけ
 *   npm run crawl-x                   … 全件（161ハンドル / 約15〜25分）
 *   npm run crawl-x -- --fresh        … 前回の進捗を無視して最初から
 *   npm run crawl-x -- --headed       … ブラウザを表示して挙動を確認
 *
 * ⚠ X の規約は自動アクセスを禁止しており、アカウント凍結のリスクがある。
 *    サブアカウントで実行し、間隔を詰めないこと。
 *
 * 出力: data/posts.json（全投稿 + スコア）
 * 状態: data/crawl-state.json（中断・再開用。.gitignore 済み）
 */

import { chromium } from 'playwright';

import { dataPath, jitter, readJson, sleep, writeJson } from './lib/io';
import { buildSearchQuery, scoreOshinagaki } from './lib/oshinagaki-score';
import type { Creator, CrawlState, ManualPost, Post } from './lib/types';
import type { OfficialListing } from './lib/official-parser';
import {
  attributeFromText,
  buildOfficialIndex,
  type OfficialByHandle,
} from './lib/venue-attribution';
import { extractPostsForHandle, parseTweetUrl, type RawPost } from './lib/x-graphql';
import { ResponseCollector, waitForOps } from './lib/x-capture';
import {
  blockHeavyResources,
  createLoggedInContext,
  looksLoggedOut,
  SessionExpiredError,
} from './lib/x-session';

// --- レート制御パラメータ ------------------------------------------------
/** ナビゲーション間の待ち時間（ミリ秒）。詰めないこと */
const DELAY_MIN_MS = 3_000;
const DELAY_MAX_MS = 6_000;
/** GraphQL レスポンスを待つ上限 */
const RESPONSE_TIMEOUT_MS = 20_000;
/**
 * X の検索は概ね 15分あたり 50 リクエストで制限される。
 * 実測でも 30 ハンドルほどで 429 に達した。
 * レスポンスヘッダの reset 時刻まで待てば確実に回復するので、
 * 推測のバックオフは reset が読めなかったときの保険としてだけ使う。
 */
const FALLBACK_BACKOFF_MS = 15 * 60_000;
/** 残数がこれを下回ったら、次の窓が開くまで先回りして待つ */
const REMAINING_THRESHOLD = 3;
/** 待機の上限。これを超える reset が返ってきたら異常とみなして中断する */
const MAX_WAIT_MS = 20 * 60_000;

function formatWait(ms: number): string {
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

type Target = { handle: string; creatorIds: string[] };

type Args = {
  limit: number | null;
  handle: string | null;
  fresh: boolean;
  headed: boolean;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | null => {
    const i = argv.indexOf(flag);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const limitRaw = get('--limit');
  const limit = limitRaw === null ? null : Number(limitRaw);
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit は正の整数（受け取った値: ${limitRaw}）`);
  }
  return {
    limit,
    handle: get('--handle'),
    fresh: argv.includes('--fresh'),
    headed: argv.includes('--headed'),
  };
}

/** ハンドル → そのクリエイターのブースID一覧（スコアリングに使う） */
async function loadBoothIndex(): Promise<Map<string, string[]>> {
  const creators: Creator[] = [];
  for (const f of [
    'creators.osaka.json',
    'creators.tokyo.json',
    'sponsors.osaka.json',
    'sponsors.tokyo.json',
  ]) {
    creators.push(...(await readJson<Creator[]>(dataPath(f), [])));
  }
  const byHandle = new Map<string, string[]>();
  for (const c of creators) {
    for (const h of c.xHandles) {
      const arr = byHandle.get(h) ?? [];
      if (c.boothId && !arr.includes(c.boothId)) arr.push(c.boothId);
      byHandle.set(h, arr);
    }
  }
  return byHandle;
}

function scorePosts(
  raw: RawPost[],
  boothIds: string[],
  official: OfficialByHandle,
): Post[] {
  return raw.map((p) => {
    const { score, signals } = scoreOshinagaki({
      text: p.text,
      mediaCount: p.media.length,
      isPinned: p.isPinned,
      isReply: p.isReply,
      isRetweet: p.isRetweet,
      createdAt: p.createdAt,
      boothIds,
    });
    // どの会場・どの日のお品書きかを本文から確定する。
    // 確定できなければ公開されない（画像からの読み取りに回る）。
    const attribution = attributeFromText({
      text: p.text,
      handle: p.handle,
      altTexts: p.media.map((m) => m.altText),
      official: official.get(p.handle.toLowerCase()) ?? [],
    });
    return { ...p, score, matchedSignals: signals, attribution };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  let targets = await readJson<Target[]>(dataPath('x-targets.json'), []);
  if (targets.length === 0) {
    throw new Error(
      'data/x-targets.json が空です。先に `npm run scrape-official` を実行してください。',
    );
  }
  if (args.handle) {
    targets = targets.filter((t) => t.handle.toLowerCase() === args.handle!.toLowerCase());
    if (targets.length === 0) throw new Error(`対象に含まれないハンドルです: ${args.handle}`);
  }

  const boothIndex = await loadBoothIndex();
  const listings = await readJson<OfficialListing[]>(dataPath('official-listings.json'), []);
  if (listings.length === 0) {
    throw new Error(
      'data/official-listings.json がありません。先に `npm run scrape-official` を実行してください。',
    );
  }
  const officialIndex = buildOfficialIndex(listings);

  // 既存の結果と進捗を読む（再開できるようにする）
  const existing = await readJson<Post[]>(dataPath('posts.json'), []);
  const state = args.fresh
    ? null
    : await readJson<CrawlState | null>(dataPath('crawl-state.json'), null);
  const done = new Set(Object.keys(state?.done ?? {}));

  const postsById = new Map<string, Post>();
  if (!args.fresh) for (const p of existing) postsById.set(p.id, p);

  let queue = targets.filter((t) => !done.has(t.handle));
  if (args.limit !== null) queue = queue.slice(0, args.limit);

  console.log(`X クロール開始`);
  console.log(`  対象: ${queue.length} ハンドル（全 ${targets.length}、済み ${done.size}）`);
  if (args.limit !== null) console.log(`  --limit ${args.limit} が指定されています`);
  const estMin = Math.ceil((queue.length * (DELAY_MAX_MS + 5000)) / 60_000);
  console.log(`  推定所要時間: 約 ${estMin} 分\n`);
  if (queue.length === 0) {
    console.log('処理対象がありません。--fresh で最初からやり直せます。');
    return;
  }

  const newState: CrawlState = {
    startedAt: state?.startedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    done: { ...(state?.done ?? {}) },
    failed: {},
  };

  const browser = await chromium.launch({
    headless: !args.headed,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await createLoggedInContext(browser);
  await blockHeavyResources(context);
  const page = await context.newPage();
  const collector = new ResponseCollector(page);

  /** 進捗と結果を都度書き出す（中断してもここまでは残る） */
  const persist = async (): Promise<void> => {
    newState.updatedAt = new Date().toISOString();
    const all = [...postsById.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    await writeJson(dataPath('posts.json'), all);
    await writeJson(dataPath('crawl-state.json'), newState);
  };

  /**
   * レート制限を待つ。X が返す reset 時刻まで待てば確実に回復する。
   * 待つ前に必ず結果を保存するので、途中で止めても失われない。
   */
  const waitForRateLimit = async (reason: string): Promise<boolean> => {
    const info = collector.rateLimitInfo;
    const wait = collector.waitUntilReset() ?? FALLBACK_BACKOFF_MS;
    if (wait > MAX_WAIT_MS) {
      console.log(
        `\nレート制限のリセットが ${formatWait(wait)} 先と報告されました（想定外）。中断します。`,
      );
      return false;
    }
    await persist();
    console.log(
      `\n  レート制限（${reason}）` +
        (info.limit !== null ? ` [${info.remaining}/${info.limit}]` : '') +
        `。${formatWait(wait)} 待機します…（ここまでは保存済み。Ctrl+C で中断しても再開できます）`,
    );
    await sleep(wait);
    collector.reset();
    return true;
  };

  try {
    // レート制限で待った場合は同じハンドルをやり直すため、
    // for-of ではなく先頭から取り出す可変キューで回す。
    const pending = [...queue];
    const total = queue.length;
    let processed = 0;
    let rateLimitRetries = 0;

    while (pending.length > 0) {
      const target = pending.shift()!;
      const { handle } = target;

      // 残数が尽きる前に、先回りして次の窓を待つ。
      // 429 を踏んでから待つより無駄が少なく、アカウントへの当たりも弱い。
      const info = collector.rateLimitInfo;
      if (info.remaining !== null && info.remaining <= REMAINING_THRESHOLD) {
        const ok = await waitForRateLimit(`残り ${info.remaining} 回`);
        if (!ok) return;
      }
      const boothIds = boothIndex.get(handle) ?? [];
      const label = `[${processed + 1}/${total}] @${handle}`;

      // --- 主系: 絞り込み検索 ---
      collector.reset();
      const query = buildSearchQuery(handle);
      const searchUrl = `https://x.com/search?f=live&src=typed_query&q=${encodeURIComponent(query)}`;

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      } catch (err) {
        newState.failed[handle] = `検索ページの読み込み失敗: ${(err as Error).message}`;
        console.log(`${label} 読み込み失敗 — スキップ`);
        processed += 1;
        await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
        continue;
      }

      if (looksLoggedOut(page.url())) throw new SessionExpiredError();

      await waitForOps(collector, ['SearchTimeline'], RESPONSE_TIMEOUT_MS);

      if (collector.rateLimited) {
        const ok = await waitForRateLimit(collector.rateLimited);
        if (!ok) {
          console.log('  時間を置いてから再実行すると、この続きから再開します。');
          return;
        }
        // 待ったので同じハンドルをやり直す（飛ばさない）
        rateLimitRetries += 1;
        if (rateLimitRetries > total + 10) {
          console.log('\nレート制限の再試行が多すぎます。中断します。');
          await persist();
          return;
        }
        pending.unshift(target);
        continue;
      }

      let raw = extractPostsForHandle(await collector.drain(), handle, 'search');

      // --- 副系: 0件なら プロフィールタイムライン（固定ツイートが拾える） ---
      if (raw.length === 0) {
        await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
        collector.reset();
        try {
          await page.goto(`https://x.com/${handle}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
          if (looksLoggedOut(page.url())) throw new SessionExpiredError();
          await waitForOps(collector, ['UserTweets', 'UserTweetsAndReplies'], RESPONSE_TIMEOUT_MS);
          if (!collector.rateLimited) {
            raw = extractPostsForHandle(await collector.drain(), handle, 'timeline');
          }
        } catch (err) {
          if (err instanceof SessionExpiredError) throw err;
          newState.failed[handle] = `プロフィール取得失敗: ${(err as Error).message}`;
        }
      }

      const scored = scorePosts(raw, boothIds, officialIndex);
      for (const p of scored) {
        const prev = postsById.get(p.id);
        // 手動追加した投稿の情報は上書きしない
        if (prev?.isManual) continue;
        postsById.set(p.id, p);
      }

      const candidates = scored.filter((p) => p.score >= 50).length;
      newState.done[handle] = scored.length;
      delete newState.failed[handle];
      processed += 1;
      const info2 = collector.rateLimitInfo;
      console.log(
        `${label} ${scored.length}件取得 / 候補 ${candidates}件` +
          (boothIds.length > 0 ? ` (${boothIds.join(',')})` : '') +
          (info2.remaining !== null ? ` [残 ${info2.remaining}]` : ''),
      );

      await persist();
      await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
    }

    // --- 手動追加の投稿を取り込む ---
    const manual = await readJson<ManualPost[]>(dataPath('manual-posts.json'), []);
    if (manual.length > 0) {
      console.log(`\n手動追加分を確認: ${manual.length}件`);
      for (const m of manual) {
        const parsed = parseTweetUrl(m.url);
        if (!parsed) {
          console.log(`  スキップ（URLを解釈できない）: ${m.url}`);
          continue;
        }
        if (postsById.has(parsed.id)) {
          // 既に取得済みなら手動フラグだけ立てて採用側に寄せる
          const p = postsById.get(parsed.id)!;
          postsById.set(parsed.id, { ...p, isManual: true });
          continue;
        }
        console.log(`  未取得: ${m.url}（次のクロールで拾えなければ個別に取得が必要）`);
      }
      await persist();
    }
  } finally {
    collector.dispose();
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  await persist();

  const all = [...postsById.values()];
  const candidates = all.filter((p) => p.score >= 50);
  const withMedia = candidates.filter((p) => p.media.length > 0);
  const failedCount = Object.keys(newState.failed).length;

  console.log(`\n完了`);
  console.log(`  取得した投稿: ${all.length}件`);
  console.log(`  お品書き候補（score>=50）: ${candidates.length}件`);
  console.log(`  うち画像あり: ${withMedia.length}件`);
  if (failedCount > 0) {
    console.log(`  失敗: ${failedCount}ハンドル（再実行すると再挑戦します）`);
    for (const [h, why] of Object.entries(newState.failed)) console.log(`    @${h}: ${why}`);
  }
  console.log(`  → data/posts.json`);
  console.log(`\n次は \`npm run review\` で候補を確認してください。`);
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
