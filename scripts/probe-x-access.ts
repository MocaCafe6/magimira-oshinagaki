/**
 * その環境から X にアクセスできるかを、**1リクエストだけ**で確かめる。
 *
 * GitHub Actions で自動更新を回す前に、データセンターの IP が
 * ブロックされないかを見るための調査。全件クロールを試して凍結を招く
 * ようなことはせず、検索を1回だけ実行して結果の種類を判定する。
 *
 *   npm run probe-x                 未ログインで到達性だけ見る（アカウントに一切触らない）
 *   npm run probe-x -- --auth       保存済みセッションで検索を1回だけ実行する
 *
 * 判定:
 *   ok          … 投稿データが返った。この環境から収集できる
 *   login       … ログイン画面に飛ばされた。セッション切れかブロック
 *   rate-limit  … レート制限に当たった
 *   challenge   … 認証チャレンジ/ロボット判定が出た。この IP は警戒されている
 *   blocked     … 403 など、そもそも拒否された
 *   no-data     … ページは出たが投稿が取れなかった
 */
import { chromium, type BrowserContext } from 'playwright';

import { createLoggedInContext, hasSavedSession, looksLoggedOut } from './lib/x-session';

type Verdict = 'ok' | 'login' | 'rate-limit' | 'challenge' | 'blocked' | 'no-data';

/** 収集の中身は見ない。1件でも投稿が返ったかどうかだけ判定する */
const TIMELINE_OP = /\/i\/api\/graphql\/[^/]+\/(SearchTimeline|UserTweets)/;

async function probe(context: BrowserContext, authed: boolean): Promise<{ verdict: Verdict; detail: string }> {
  const page = await context.newPage();

  let sawTweets = false;
  let rateLimited = false;
  let httpStatus = 0;

  page.on('response', async (res) => {
    const url = res.url();
    if (res.status() === 429) rateLimited = true;
    if (!TIMELINE_OP.test(url)) return;
    httpStatus = res.status();
    try {
      const body = await res.text();
      // ツイート1件でも含まれていれば取得できている
      if (/"tweet_results"|"legacy"\s*:\s*\{/.test(body)) sawTweets = true;
    } catch {
      /* 読めなくても判定は続ける */
    }
  });

  // 未ログインならトップだけ、ログイン済みなら検索を1回
  const target = authed
    ? 'https://x.com/search?f=live&q=' +
      encodeURIComponent('from:nulut マジカルミライ')
    : 'https://x.com/';

  let status = 0;
  try {
    const res = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    status = res?.status() ?? 0;
  } catch (e) {
    await page.close();
    return { verdict: 'blocked', detail: `到達できません: ${(e as Error).message.split('\n')[0]}` };
  }

  await page.waitForTimeout(8000);
  const url = page.url();
  const text = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '');
  await page.close();

  if (rateLimited) return { verdict: 'rate-limit', detail: 'HTTP 429 が返りました' };
  if (status === 403) return { verdict: 'blocked', detail: 'HTTP 403 が返りました' };
  if (/arkose|challenge|認証を完了|ロボットではない|Verify/i.test(text)) {
    return { verdict: 'challenge', detail: `チャレンジ画面: ${text.slice(0, 80)}` };
  }
  if (looksLoggedOut(url)) {
    return { verdict: 'login', detail: `ログイン画面に遷移: ${url}` };
  }
  if (authed && sawTweets) {
    return { verdict: 'ok', detail: `投稿データを取得できました（GraphQL HTTP ${httpStatus}）` };
  }
  if (!authed) {
    return {
      verdict: status === 200 ? 'ok' : 'blocked',
      detail: `HTTP ${status}（未ログインなので投稿は取れません。到達性のみ確認）`,
    };
  }
  return { verdict: 'no-data', detail: `ページは出ましたが投稿が取れませんでした（HTTP ${status}）` };
}

async function main() {
  const authed = process.argv.includes('--auth');

  console.log(`\nX へのアクセス調査（${authed ? 'ログイン済みセッションを使用' : '未ログイン・到達性のみ'}）`);
  if (authed && !(await hasSavedSession())) {
    console.error('\n✗ 保存済みセッションがありません。先に npm run x-login を実行してください。');
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = authed
    ? await createLoggedInContext(browser)
    : await browser.newContext({ locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });

  const { verdict, detail } = await probe(context, authed);
  await browser.close();

  const label: Record<Verdict, string> = {
    ok: '✓ 問題なし',
    login: '✗ ログイン画面に飛ばされた',
    'rate-limit': '✗ レート制限',
    challenge: '✗ ロボット判定/チャレンジ',
    blocked: '✗ 拒否された',
    'no-data': '△ データが取れなかった',
  };

  console.log(`\n  判定: ${label[verdict]}`);
  console.log(`  詳細: ${detail}`);
  console.log(`\n  結論: ${
    verdict === 'ok'
      ? 'この環境から収集できます。'
      : 'この環境からの収集は難しそうです。手元での実行を続けてください。'
  }`);

  // GitHub Actions のログで一目で分かるようにする
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      `## X アクセス調査\n\n- モード: ${authed ? '認証あり' : '認証なし'}\n- 判定: ${label[verdict]}\n- 詳細: ${detail}\n`,
    );
  }

  process.exit(verdict === 'ok' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
