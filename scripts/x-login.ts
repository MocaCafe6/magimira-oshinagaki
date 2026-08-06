/**
 * X のログインセッションを確立して保存する。
 *
 *   npm run x-login
 *
 * ブラウザが開いたら **人間が手動でログインする**。
 * ID・パスワード・2FA コードはすべてブラウザに直接入力し、
 * このスクリプトは一切受け取らず、保存もしない。
 * 保存されるのは Cookie などのセッション情報（secrets/x-storage-state.json）だけ。
 *
 * ⚠ X の利用規約は自動アクセスを禁止しており、アカウント凍結のリスクがある。
 *    メインアカウントではなく、サブ／捨てアカウントでログインすること。
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

import { SECRETS_DIR, sleep } from './lib/io';
import { STORAGE_STATE_PATH, isLoggedIn } from './lib/x-session';

/** 手動ログインを待つ上限（分） */
const LOGIN_TIMEOUT_MIN = 10;

async function main(): Promise<void> {
  await mkdir(SECRETS_DIR, { recursive: true });

  console.log('X のログインセッションを作成します。\n');
  console.log('  ⚠ メインアカウントは使わないでください。');
  console.log('    X の規約上、自動アクセスはアカウント凍結のリスクがあります。');
  console.log('    サブアカウント／捨てアカウントでログインしてください。\n');
  console.log('  ブラウザが開いたら手動でログインしてください。');
  console.log('  ID・パスワード・2FA はこのスクリプトには渡りません。\n');

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  try {
    await page.goto('https://x.com/login', { waitUntil: 'domcontentloaded' });

    const deadline = Date.now() + LOGIN_TIMEOUT_MIN * 60_000;
    let ok = false;
    let lastReport = 0;

    while (Date.now() < deadline) {
      if (page.isClosed()) {
        throw new Error('ログイン完了前にブラウザが閉じられました。もう一度実行してください。');
      }
      if (await isLoggedIn(page)) {
        ok = true;
        break;
      }
      // 30秒ごとに残り時間を知らせる
      const remain = Math.ceil((deadline - Date.now()) / 1000);
      if (Date.now() - lastReport > 30_000) {
        console.log(`  ログイン待ち... (残り約 ${Math.ceil(remain / 60)} 分)`);
        lastReport = Date.now();
      }
      await sleep(2_000);
    }

    if (!ok) {
      throw new Error(
        `${LOGIN_TIMEOUT_MIN} 分以内にログインが完了しませんでした。もう一度実行してください。`,
      );
    }

    // ホームが安定するまで少し待ってから保存する
    await sleep(2_000);
    await context.storageState({ path: STORAGE_STATE_PATH });

    console.log('\nログイン成功。セッションを保存しました。');
    console.log(`  → ${STORAGE_STATE_PATH}`);
    console.log('\n  このファイルは .gitignore 済みです。絶対に共有・コミットしないでください。');
    console.log('  次は `npm run crawl-x -- --limit 3` で少数から試してください。');
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
