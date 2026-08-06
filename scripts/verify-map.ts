/**
 * 会場マップ・周回ルートの検証。
 *
 *   npm run build
 *   npm run preview        (別ターミナル)
 *   npm run verify-map
 *
 * ずれた座標や誤った周回順は「無いより悪い」ので、
 * ピンの位置とルートの順序を実データで確かめる。
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { dataPath, readJson, PROJECT_ROOT } from './lib/io';
import type { Creator, VenueMap } from './lib/types';

const OUT_DIR = resolve(PROJECT_ROOT, 'screenshots');

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const BASE = arg('--base', 'http://localhost:4173').replace(/\/$/, '');

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const problems: string[] = [];

  // 座標データの健全性を先に確認する
  for (const venue of ['osaka', 'tokyo'] as const) {
    const map = await readJson<VenueMap | null>(dataPath(`booth-coords.${venue}.json`), null);
    if (!map) {
      problems.push(`data/booth-coords.${venue}.json が無い（npm run detect-booths が必要）`);
      continue;
    }
    const creators = await readJson<Creator[]>(dataPath(`creators.${venue}.json`), []);
    const wanted = new Set(creators.filter((c) => c.line && c.boothId).map((c) => c.boothId!));
    const got = new Set(map.coords.map((c) => c.boothId));
    const missing = [...wanted].filter((b) => !got.has(b));
    const outOfRange = map.coords.filter((c) => c.x < 0 || c.x > 1 || c.y < 0 || c.y > 1);
    console.log(
      `  ${venue}: ${map.coords.length}ブース / 画像 ${map.imageWidth}x${map.imageHeight}` +
        ` / 未配置 ${missing.length} / 範囲外 ${outOfRange.length}`,
    );
    if (missing.length > 0) problems.push(`${venue}: 座標が無いブース ${missing.join(',')}`);
    if (outOfRange.length > 0) {
      problems.push(`${venue}: 正規化座標が 0..1 の外にある ${outOfRange.length}件`);
    }
  }

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

  console.log(`\n検証対象: ${BASE}/map/\n`);

  // お気に入りを付ける（マップに出るのはお気に入りのみ）
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  const cards = page.locator('[data-testid="creator-list"] > li');
  const picked: string[] = [];
  // 離れた列のブースを選んで蛇行順が効いているか見えるようにする
  for (const n of [0, 20, 50, 80, 100]) {
    if (n >= (await cards.count())) continue;
    const li = cards.nth(n);
    const booth = await li.locator('span').first().textContent();
    if (booth) picked.push(booth.trim());
    await li.locator('button[aria-label*="お気に入り"]').first().click();
    await page.waitForTimeout(120);
  }
  console.log(`  お気に入りに追加したブース: ${picked.join(' , ')}`);

  await page.goto(`${BASE}/map/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const h1 = await page.locator('h1').first().textContent();
  if (!h1?.includes('会場マップ')) problems.push(`マップページの見出しが想定と違う: ${h1}`);

  // マップ画像が読めているか
  const imgOk = await page
    .locator('img[alt*="ブース配置図"]')
    .first()
    .evaluate((el) => {
      const img = el as HTMLImageElement;
      return img.complete && img.naturalWidth > 0;
    })
    .catch(() => false);
  if (!imgOk) problems.push('会場マップ画像が読み込めていない');
  else console.log('  マップ画像: 読み込み OK');

  // ピンとルート線
  const pins = await page.locator('svg circle').count();
  const hasPolyline = (await page.locator('svg polyline').count()) > 0;
  console.log(`  ピン: ${pins}件 / ルート線: ${hasPolyline ? 'あり' : 'なし'}`);
  if (pins === 0) problems.push('マップ上にピンが表示されていない');
  if (!hasPolyline && pins > 1) problems.push('ルート線が描かれていない');

  // 周回順のリスト
  const listItems = await page.locator('ol > li').count();
  console.log(`  周回順リスト: ${listItems}件`);
  if (listItems === 0) problems.push('周回順リストが空');

  // 周回順に入っている項目には必ずピンがあること。
  // 数が合わないのは、座標を持たないブースがルートに混ざっている合図
  // （出展ブースの "A6" をクリエイターズマーケットのA列と誤認するなど）。
  if (pins !== listItems) {
    problems.push(
      `ピン数と周回順の件数が一致しない（ピン ${pins} / リスト ${listItems}）。` +
        ' 座標を持たないブースがルートに混ざっている可能性がある。',
    );
  }

  // マップ外に振られた項目も確認する
  const outside = await page
    .locator('h2', { hasText: 'マップ外' })
    .first()
    .textContent()
    .catch(() => null);
  if (outside) console.log(`  ${outside.trim()}`);

  // 順番が 1..N の連番になっているか
  const orders = await page.locator('ol > li > span:first-child').allTextContents();
  const nums = orders.map((s) => Number(s.trim()));
  const expected = Array.from({ length: nums.length }, (_, i) => i + 1);
  if (JSON.stringify(nums) !== JSON.stringify(expected)) {
    problems.push(`周回順の番号が連番でない: ${nums.join(',')}`);
  } else {
    console.log(`  周回順の番号: 1..${nums.length} の連番 OK`);
  }

  // 実際に並んだブース順を出す（蛇行しているか目で見る）
  const booths = await page.locator('ol > li > span:nth-child(2)').allTextContents();
  console.log(`  周回順: ${booths.map((b) => b.trim()).join(' → ')}`);

  await page.screenshot({ path: resolve(OUT_DIR, '40-map.png') });
  console.log('  40-map.png');

  // 訪問済みにすると残り件数が減るか
  const firstToggle = page.locator('ol > li button').first();
  await firstToggle.click();
  await page.waitForTimeout(500);
  const remainText = await page.locator('text=/未訪問 \\d+件/').first().textContent();
  console.log(`  訪問済みにした後: ${remainText?.trim()}`);
  if (remainText && listItems > 0) {
    const m = /未訪問 (\d+)件/.exec(remainText);
    if (m && Number(m[1]) !== listItems - 1) {
      problems.push(`未訪問件数が減っていない（${remainText.trim()} / 全${listItems}件）`);
    }
  }

  await page.screenshot({ path: resolve(OUT_DIR, '41-map-visited.png') });
  console.log('  41-map-visited.png');

  // 東京に切り替えても動くか
  await page.getByRole('button', { name: '東京', exact: true }).click();
  await page.waitForTimeout(1200);
  const tokyoImgOk = await page
    .locator('img[alt*="ブース配置図"]')
    .first()
    .evaluate((el) => (el as HTMLImageElement).naturalWidth > 0)
    .catch(() => false);
  if (!tokyoImgOk) problems.push('東京のマップ画像が読み込めていない');
  else console.log('  東京マップ: 読み込み OK');
  await page.screenshot({ path: resolve(OUT_DIR, '42-map-tokyo.png') });
  console.log('  42-map-tokyo.png');

  await browser.close();

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
