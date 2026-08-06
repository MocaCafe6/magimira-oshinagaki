/**
 * ビルド済みサイトの目視・自動検証。
 *
 *   npm run build
 *   npm run preview            (別ターミナルで)
 *   npm run verify-ui          (既定 http://localhost:4173)
 *   npm run verify-ui -- --base http://localhost:3000
 *
 * 会場で使うのはスマホなので、iPhone SE 相当のモバイル幅で確認する。
 * スクリーンショットは screenshots/ に出る（.gitignore 済み）。
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from 'playwright';

import { PROJECT_ROOT } from './lib/io';

const OUT_DIR = resolve(PROJECT_ROOT, 'screenshots');

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const BASE = arg('--base', 'http://localhost:4173').replace(/\/$/, '');

type Problem = string;

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const problems: Problem[] = [];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  // 外部画像（pbs.twimg.com / 公式サイト）の 404 は問題として扱わない。
  // クリエイターが投稿を削除すれば画像は消える。それに耐えるのが仕様であり、
  // 検証で拾いたいのは自前アセットの欠落とスクリプトエラーだけ。
  let externalImage404 = 0;
  page.on('response', (res) => {
    if (res.status() < 400) return;
    const u = res.url();
    if (/pbs\.twimg\.com|magicalmirai\.com/.test(u)) {
      externalImage404 += 1;
      return;
    }
    problems.push(`${res.status()} ${u}`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 上の response ハンドラで分類済みのリソース 404 は二重に数えない
    if (/Failed to load resource/.test(m.text())) return;
    problems.push(`console error: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

  const shot = async (
    path: string,
    name: string,
    action?: (p: Page) => Promise<void>,
  ): Promise<void> => {
    const res = await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
    if (!res || res.status() >= 400) {
      problems.push(`${path} が ${res?.status() ?? 'no response'} を返した`);
      return;
    }
    if (action) await action(page);
    await page.waitForTimeout(400);
    await page.screenshot({ path: resolve(OUT_DIR, `${name}.png`) });
    console.log(`  ${name}.png  <- ${path}`);
  };

  console.log(`検証対象: ${BASE}\n`);

  await shot('/', '01-list');

  // 一覧に実データが出ているか
  const cardCount = await page.locator('[data-testid="creator-list"] > li').count();
  if (cardCount < 10) problems.push(`一覧のカードが少なすぎる: ${cardCount}件`);
  console.log(`  一覧カード数: ${cardCount}`);

  await shot('/', '02-filter-oshinagaki', async (p) => {
    await p.getByRole('button', { name: 'お品書きあり' }).click();
  });

  await shot('/', '03-favorited', async (p) => {
    const stars = p.locator('button[aria-label*="お気に入りに追加"]');
    const n = await stars.count();
    if (n < 2) {
      problems.push('お気に入りボタンが見つからない');
      return;
    }
    await stars.nth(0).click();
    await stars.nth(1).click();
    await p.waitForTimeout(300);
  });

  // お気に入りが永続化されているか（リロードして残るか）
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const favChip = await page.getByRole('button', { name: /★のみ/ }).textContent();
  if (!favChip?.includes('(2)')) {
    problems.push(`お気に入りがリロード後に復元されていない（チップ表示: ${favChip}）`);
  } else {
    console.log(`  お気に入り永続化: OK ${favChip.trim()}`);
  }

  await shot('/', '04-tokyo', async (p) => {
    await p.getByRole('button', { name: '東京', exact: true }).click();
  });

  await shot('/', '05-search', async (p) => {
    await p.getByPlaceholder(/検索/).fill('mothy');
  });
  const searchHits = await page.locator('[data-testid="creator-list"] > li').count();
  console.log(`  「mothy」検索ヒット: ${searchHits}件`);
  if (searchHits === 0) problems.push('「mothy」の検索が 0 件（検索インデックスを確認）');

  await shot('/creator/osaka-A-1/', '06-detail');
  const detailTitle = await page.locator('h1').first().textContent();
  if (detailTitle?.trim() !== '偽犬') {
    problems.push(`詳細ページの見出しが想定と違う: ${detailTitle}`);
  }

  await shot('/creator/osaka-A-1/', '07-memo', async (p) => {
    await p.getByPlaceholder(/気になったグッズ/).fill('アクリルスタンド / 初日午前に行く');
    await p.waitForTimeout(400);
  });

  // メモが永続化されているか
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const memo = await page.getByPlaceholder(/気になったグッズ/).inputValue();
  if (!memo.includes('アクリルスタンド')) {
    problems.push(`メモがリロード後に復元されていない: "${memo}"`);
  } else {
    console.log('  メモ永続化: OK');
  }

  await shot('/favorites/', '08-favorites');
  const favRows = await page.locator('[data-testid="favorite-list"] > li').count();
  console.log(`  お気に入り一覧: ${favRows}件`);
  if (favRows < 2) problems.push(`お気に入り一覧に反映されていない: ${favRows}件`);

  await shot('/items/', '09-items');

  // 横スクロール漏れ（body が横に動いてはいけない）
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const ov = await page.evaluate(() => ({
    s: document.documentElement.scrollWidth,
    c: document.documentElement.clientWidth,
  }));
  if (ov.s > ov.c + 1) {
    problems.push(`横スクロールが発生している (scrollWidth=${ov.s} > clientWidth=${ov.c})`);
  } else {
    console.log(`  横スクロール: なし (${ov.s}px)`);
  }

  // 下部ナビが実際に押せる位置にあるか（会場で片手操作するため）
  const navBox = await page.locator('nav[aria-label="メインナビゲーション"]').boundingBox();
  if (!navBox) problems.push('下部ナビが見つからない');
  else if (navBox.y + navBox.height > 812 + 1) {
    problems.push(`下部ナビが画面外に出ている (y=${navBox.y} h=${navBox.height})`);
  } else {
    console.log(`  下部ナビ: OK (y=${Math.round(navBox.y)})`);
  }

  // ライトモード
  const light = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    colorScheme: 'light',
    locale: 'ja-JP',
  });
  const lp = await light.newPage();
  await lp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await lp.waitForTimeout(400);
  await lp.screenshot({ path: resolve(OUT_DIR, '10-list-light.png') });
  console.log('  10-list-light.png <- / (ライトモード)');

  // タブレット/PC幅でも崩れないか
  const wide = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP' });
  const wp = await wide.newPage();
  await wp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await wp.waitForTimeout(400);
  await wp.screenshot({ path: resolve(OUT_DIR, '11-list-desktop.png') });
  console.log('  11-list-desktop.png <- / (PC幅)');

  await browser.close();

  if (externalImage404 > 0) {
    console.log(
      `  外部画像の読み込み失敗: ${externalImage404}件（削除済み投稿やフィクスチャでは正常。問題として扱いません）`,
    );
  }

  // 公開成果物に管理画面が混ざっていないこと。
  // 実行時ゲートではクライアントチャンクが出荷されてしまうため、
  // ビルド対象から外れていることを毎回確かめる。
  // 注意: 単に "8787" で探すとツイートIDに偶然含まれて誤検知する。
  const outDir = resolve(PROJECT_ROOT, 'out');
  if (existsSync(outDir)) {
    const leaks: string[] = [];
    const walk = (dir: string): void => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, e.name);
        if (e.isDirectory()) {
          walk(p);
          continue;
        }
        if (!/\.(html|js|txt)$/.test(e.name)) continue;
        const text = readFileSync(p, 'utf8');
        if (/127\.0\.0\.1:8787|localhost:8787|curation\/verdict|お品書きレビュー/.test(text)) {
          leaks.push(p.replace(PROJECT_ROOT, ''));
        }
      }
    };
    walk(outDir);
    if (existsSync(resolve(outDir, 'admin'))) leaks.push('/out/admin ディレクトリが存在する');
    if (leaks.length > 0) {
      problems.push(`公開成果物に管理画面が混ざっている: ${leaks.slice(0, 3).join(', ')}`);
    } else {
      console.log('  公開成果物への admin 混入: なし');
    }
  }

  console.log(`\nスクリーンショット: ${OUT_DIR}`);
  if (problems.length > 0) {
    console.log(`\n問題 ${problems.length}件:`);
    for (const p of problems) console.log(`  ✖ ${p}`);
    process.exit(1);
  }
  console.log('\n問題は検出されませんでした。');
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
