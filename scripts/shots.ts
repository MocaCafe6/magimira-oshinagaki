/**
 * 主要画面のスクリーンショットを撮る。
 *   npm run shots            スマホ幅（390px）
 *   npm run shots -- --pc    PC幅（1280px）
 */
import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://localhost:4173';

/**
 * `full` を付けるとページ全体。一覧のように縦に長いページは
 * 全体を撮ると縮小されて読めなくなるので、既定は画面1枚分。
 */
const PAGES: { path: string; name: string; full?: boolean }[] = [
  { path: '/', name: '01-一覧' },
  { path: '/creator/tokyo-B-27/', name: '02-サークル詳細（お品書きあり）', full: true },
  { path: '/creator/osaka-C-2/', name: '03-サークル詳細（参考枠）', full: true },
  { path: '/items/', name: '04-グッズ横断' },
  { path: '/map/', name: '05-会場マップ' },
  { path: '/favorites/', name: '06-お気に入り' },
];

async function main() {
  const pc = process.argv.includes('--pc');
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: pc ? { width: 1280, height: 900 } : { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });

  for (const p of PAGES) {
    try {
      await page.goto(BASE + p.path, { waitUntil: 'networkidle', timeout: 45_000 });
      await page.waitForTimeout(2500);
      const file = `screenshots/${pc ? 'pc-' : 'sp-'}${p.name}.png`;
      await page.screenshot({ path: file, fullPage: p.full === true });
      console.log(`✓ ${file}`);
    } catch (e) {
      console.log(`✗ ${p.path} — ${(e as Error).message.split('\n')[0]}`);
    }
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
