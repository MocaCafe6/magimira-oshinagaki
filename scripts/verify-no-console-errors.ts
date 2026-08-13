/**
 * ブラウザのコンソールにエラーが出ていないかを確かめる。
 *
 *   npm run preview                （別のターミナルで）
 *   npm run verify-no-console-errors
 *   PREVIEW_URL=https://... npm run verify-no-console-errors   （本番を見る）
 *
 * 表示は正しく見えてもコンソールにエラーが積まれていることがある。
 * 実際に本番でサークル詳細ページが React error #418
 * （ハイドレーション不一致）を出していた。原因は投稿日時を
 * getFullYear/getHours で組んでいたこと。静的書き出しはビルドが UTC なので、
 * 閲覧者の端末が JST だとサーバの文字列と client の描画が食い違う。
 *
 * 見に行くページは代表的なものと、サークル詳細を数件。
 * 詳細は 314 ページあるので全部は見ない（同じ実装なので数件で足りる）。
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const BASE = process.env.PREVIEW_URL ?? 'http://127.0.0.1:3000';
const CREATOR_SAMPLES = 6;

async function creatorPaths(): Promise<string[]> {
  try {
    const dir = path.join(process.cwd(), 'out', 'creator');
    const names = await readdir(dir);
    // 端から均等に拾う（大阪・東京・企業が混ざるように）
    const step = Math.max(1, Math.floor(names.length / CREATOR_SAMPLES));
    return names.filter((_, i) => i % step === 0).slice(0, CREATOR_SAMPLES).map((n) => `/creator/${n}/`);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const paths = ['/', '/items/', '/map/', '/favorites/', ...(await creatorPaths())];
  console.log(`コンソールのエラーを検査: ${BASE}`);
  console.log(`  対象 ${paths.length}ページ\n`);

  const browser = await chromium.launch({ headless: true });
  let total = 0;

  for (const p of paths) {
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text().slice(0, 180));
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 180)}`));

    await page
      .goto(BASE + p, { waitUntil: 'networkidle', timeout: 45_000 })
      .catch((e) => errors.push(`goto: ${(e as Error).message.slice(0, 120)}`));
    // ハイドレーションは描画の後に走るので少し待つ
    await page.waitForTimeout(2000);

    const uniq = [...new Set(errors)];
    total += uniq.length;
    console.log(`  ${uniq.length === 0 ? '✓' : '✖'} ${p}${uniq.length ? `  ${uniq.length}件` : ''}`);
    for (const e of uniq.slice(0, 4)) console.log(`      ! ${e}`);
    await page.close();
  }

  await browser.close();
  if (total > 0) {
    console.error(`\n✖ コンソールエラー ${total}件`);
    process.exit(1);
  }
  console.log('\n✓ コンソールエラーはありません。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
