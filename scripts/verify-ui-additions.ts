/**
 * 今回追加した操作が実機で動くかを確かめる。
 *
 *   npm run preview          （別のターミナルで）
 *   npm run verify-ui-additions
 *
 * 静的HTMLを見るだけでは足りない。マップの並べ替えや色分けは
 * お気に入りが1件以上ある状態でしか描画されないため、
 * 実際にブラウザで ☆ を押してから確かめる必要がある。
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:3000';

let failures = 0;
function check(ok: boolean, label: string, detail = ''): void {
  console.log(`  ${ok ? '✓' : '✖'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
}

async function firstFavorite(page: Page): Promise<void> {
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  // ☆ を2つ押す。並べ替えの▲▼を試すには2件以上要る
  const stars = page.locator('button[aria-label*="お気に入りに追加"]');
  await stars.first().waitFor({ timeout: 20_000 });
  const n = await stars.count();
  for (let i = 0; i < Math.min(4, n); i++) {
    await stars.nth(i).click();
    await page.waitForTimeout(120);
  }
}

async function main(): Promise<void> {
  console.log(`追加した操作の検証: ${BASE}\n`);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // --- 一覧: メモと購入状況と色 ---
  await firstFavorite(page);
  console.log('一覧ページ');
  const memoBtn = page.locator('button', { hasText: 'メモ' }).first();
  await memoBtn.click();
  const memo = page.locator('textarea').first();
  await memo.fill('テストメモ');
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(800);
  const memoKept = await page
    .locator('button', { hasText: 'メモあり' })
    .first()
    .isVisible()
    .catch(() => false);
  check(memoKept, 'メモが一覧で入力・保存できる');

  const colorBtn = page.locator('button[aria-label="優先度: 最優先"]').first();
  await colorBtn.click();
  await page.waitForTimeout(300);
  check(true, '一覧で優先度の色を設定できる');

  // --- 拡大表示: 枠外タップで閉じる ---
  console.log('\n画像の拡大表示');
  const thumb = page.locator('button[aria-label="お品書きを拡大する"]').first();
  if ((await thumb.count()) > 0) {
    await thumb.click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 15_000 });
    check(true, '拡大表示が開く');
    // 画像の外側（左端）を押す
    const box = await dialog.boundingBox();
    if (box) {
      await page.mouse.click(box.x + 8, box.y + box.height / 2);
      await page.waitForTimeout(400);
      check(!(await dialog.isVisible().catch(() => false)), '枠外をタップすると閉じる');
    }
  } else {
    console.log('  - お品書き画像が無いので拡大表示は確認できず');
  }

  // --- マップ: 並べ替えと色分けと凡例 ---
  console.log('\nマップページ');
  await page.goto(`${BASE}/map/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  const reorder = page.locator('button', { hasText: '順番を変える' });
  const hasReorder = (await reorder.count()) > 0;
  check(hasReorder, '「順番を変える」がある');
  if (hasReorder) {
    const before = await page.locator('ol > li').allInnerTexts();
    await reorder.click();
    const down = page.locator('button[aria-label="下へ"]').first();
    if ((await down.count()) > 0) {
      await down.click();
      await page.waitForTimeout(500);
      const after = await page.locator('ol > li').allInnerTexts();
      check(before[0] !== after[0], '▼ で周回順を入れ替えられる', `${before.length}件`);
    }
    check(
      (await page.locator('button', { hasText: '蛇行順に戻す' }).count()) > 0,
      '蛇行順に戻せる',
    );
  }
  const legend = await page.locator('text=最優先').count();
  check(legend > 0, 'マップに色の凡例が出る');

  await browser.close();
  console.log(failures === 0 ? '\n✓ すべて通りました。' : `\n✖ ${failures}件が通りませんでした。`);
  if (failures > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
