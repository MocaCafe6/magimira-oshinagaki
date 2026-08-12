/**
 * マップのサークル名が重なっていないかを実機で確かめる。
 *
 *   npm run preview          （別のターミナルで）
 *   npm run verify-map-labels
 *
 * 「重ならないようにずらす」は layoutLabels の単体テストで担保しているが、
 * SVG に実際どう出るかは別問題（フォントサイズ・省略の長さ・座標の縮尺）。
 * 隣り合うブースを多めにお気に入りに入れて、描画結果を測る。
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:3000';
/** MapView の NAME_FONT と合わせる */
const NAME_FONT = 30;

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 430, height: 900 } });

  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  const stars = page.locator('button[aria-label*="お気に入りに追加"]');
  await stars.first().waitFor({ timeout: 20_000 });
  const n = Math.min(16, await stars.count());
  for (let i = 0; i < n; i++) {
    await stars.nth(i).click();
    await page.waitForTimeout(80);
  }

  await page.goto(`${BASE}/map/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const labels = await page.evaluate((font) => {
    return [...document.querySelectorAll('svg text')]
      .filter((t) => t.getAttribute('font-size') === String(font))
      .map((t) => ({
        x: Number(t.getAttribute('x')),
        y: Number(t.getAttribute('y')),
        s: t.textContent ?? '',
      }));
  }, NAME_FONT);

  console.log(`マップのサークル名ラベル: ${labels.length}件`);
  if (labels.length === 0) {
    console.error('✖ ラベルが1つも描かれていない（お気に入りの登録に失敗した可能性）');
    await browser.close();
    process.exit(1);
  }

  // 幅は全角基準で見積もる。重なり判定はテスト側と同じ考え方
  const width = (s: string) => {
    let u = 0;
    for (const ch of s) u += /[\x20-\x7e]/.test(ch) ? 0.55 : 1;
    return u * NAME_FONT;
  };
  let over = 0;
  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i]!;
      const b = labels[j]!;
      const w = (width(a.s) + width(b.s)) / 2;
      if (Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < NAME_FONT + 6) over++;
    }
  }
  console.log(`  重なり: ${over}組`);
  console.log(`  Y座標の種類: ${new Set(labels.map((l) => l.y)).size}`);

  await browser.close();
  if (over > 0) {
    console.error('✖ ラベルが重なっている');
    process.exit(1);
  }
  console.log('✓ サークル名は重なっていません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
