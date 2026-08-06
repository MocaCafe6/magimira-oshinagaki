/**
 * レビュー画面（ローカル専用）の検証。
 *
 *   npm run admin-server                    (別ターミナル)
 *   NEXT_PUBLIC_ADMIN=1 npx next dev -p 3010 (別ターミナル)
 *   npm run verify-review
 *
 * 確認すること:
 *   - 会場が未確定の投稿が「公開されません」と表示されること
 *   - 会場を人手で指定すると data/curation.json に永続化されること
 *   - 指定した会場だけに公開されること（担保が保たれること）
 *   - 採用・却下が永続化されること
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { selectPostsForVenue } from './lib/curation';
import { dataPath, readJson, PROJECT_ROOT } from './lib/io';
import type { Curation, Post } from './lib/types';

const OUT_DIR = resolve(PROJECT_ROOT, 'screenshots');

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const BASE = arg('--base', 'http://localhost:3010').replace(/\/$/, '');

const emptyCuration: Curation = { verdicts: {}, excludedHandles: [], updatedAt: '' };

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const problems: string[] = [];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 1000 },
    locale: 'ja-JP',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));

  console.log(`検証対象: ${BASE}/admin/review\n`);

  const res = await page.goto(`${BASE}/admin/review/`, { waitUntil: 'networkidle' });
  if (!res || res.status() >= 400) {
    throw new Error(
      `/admin/review が ${res?.status() ?? 'no response'} を返しました。` +
        ' NEXT_PUBLIC_ADMIN=1 で next dev を起動していますか？',
    );
  }

  const heading = await page.locator('h1').first().textContent();
  if (!heading?.includes('お品書きレビュー')) problems.push(`見出しが想定と違う: ${heading}`);

  // 既定は「会場未確定のみ」表示
  const cards = await page.locator('article').count();
  console.log(`  会場未確定の候補: ${cards}件`);
  if (cards === 0) {
    problems.push('会場未確定の候補が0件（先に npm run crawl-x / rescore が必要）');
  }

  const unresolvedLabel = await page.locator('text=/会場未確定 — 公開されません/').count();
  console.log(`  「公開されません」の表示: ${unresolvedLabel}件`);
  if (cards > 0 && unresolvedLabel === 0) {
    problems.push('会場未確定の表示が出ていない');
  }

  await page.screenshot({ path: resolve(OUT_DIR, '50-review-unresolved.png') });
  console.log('  50-review-unresolved.png');

  // 1件目に大阪を指定してみる
  const before = await readJson<Curation>(dataPath('curation.json'), emptyCuration);
  const first = page.locator('article').first();
  const postIdText = await first.locator('a[href*="/status/"]').first().getAttribute('href');
  const postId = postIdText?.split('/').pop() ?? null;

  const osakaBtn = first.getByRole('button', { name: /^大阪/ });
  if ((await osakaBtn.count()) === 0) {
    problems.push('会場指定ボタン（大阪）が見つからない');
  } else {
    await osakaBtn.first().click();
    await page.waitForTimeout(1200);

    if ((await page.locator('text=保存に失敗しました').count()) > 0) {
      problems.push('保存に失敗（admin サーバが起動していない可能性）');
    }

    const after = await readJson<Curation>(dataPath('curation.json'), emptyCuration);
    const assigned = Object.entries(after.manualVenues ?? {}).filter(
      ([id, vs]) => vs.includes('osaka') && !(before.manualVenues?.[id] ?? []).includes('osaka'),
    );
    if (assigned.length === 0) {
      problems.push('会場指定が data/curation.json に永続化されていない');
    } else {
      const [id] = assigned[0]!;
      console.log(`  会場指定を永続化: postId=${id} → 大阪`);
      if (postId && id !== postId) {
        console.log(`    （画面上の投稿 ${postId} と一致: ${id === postId}）`);
      }

      // 指定した会場にだけ公開されること
      const posts = await readJson<Post[]>(dataPath('posts.json'), []);
      const inOsaka = selectPostsForVenue(posts, after, 'osaka').some((p) => p.id === id);
      const inTokyo = selectPostsForVenue(posts, after, 'tokyo').some((p) => p.id === id);
      console.log(`    大阪に公開: ${inOsaka} / 東京に公開: ${inTokyo}`);
      if (!inOsaka) problems.push('大阪を指定したのに大阪に公開されていない');
      if (inTokyo) problems.push('大阪だけ指定したのに東京にも公開されている');

      // 後始末（検証用の指定を消す）
      await osakaBtn.first().click();
      await page.waitForTimeout(1000);
      const cleaned = await readJson<Curation>(dataPath('curation.json'), emptyCuration);
      if ((cleaned.manualVenues?.[id] ?? []).includes('osaka')) {
        problems.push('会場指定の解除が効いていない');
      } else {
        console.log('    指定の解除: OK');
      }
    }
  }

  await page.screenshot({ path: resolve(OUT_DIR, '51-review-assigned.png') });
  console.log('  51-review-assigned.png');

  // 却下の永続化
  await page.locator('article').first().getByRole('button', { name: '却下', exact: true }).click();
  await page.waitForTimeout(1200);
  const afterReject = await readJson<Curation>(dataPath('curation.json'), emptyCuration);
  const rejected = Object.values(afterReject.verdicts).filter((v) => v === 'rejected').length;
  console.log(`  却下の永続化: ${rejected}件`);
  if (rejected === 0) problems.push('却下が永続化されていない');

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
