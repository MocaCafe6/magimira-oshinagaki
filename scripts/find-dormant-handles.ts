/**
 * 紐づけたアカウントが「生きているか」を確かめ、死んでいたら
 * 公式ページのサイトから別のアカウントを探す。
 *
 *   npm run find-dormant-handles
 *
 * ## なぜ要るか
 *
 * ハンドルが取れていても、そのアカウントが動いているとは限らない。
 * 実例: BASYAUMA RECORDS（*Luna）に @BasyaumaRecords を紐づけていたが、
 * そのアカウントの最新投稿は2018年だった。屋号のアカウントを作ったまま
 * 放置し、本人のアカウント（@Luna_miko00）で活動していた。
 * 結果として *Luna のブースが丸ごと空のままになっていた。
 *
 * find-x-from-website は「X ハンドルが1つも無いサークル」しか見ないので、
 * この形の漏れは構造的に検出できない。こちらで補う。
 *
 * ## やること
 *
 *   1. 収集済みの投稿から、ハンドルごとの最新投稿日を出す
 *   2. マジカルミライ2026の告知が始まった時期より古いものを「休止」とみなす
 *   3. そのサークルの公式ページに載っているサイトを開き、X リンクを拾う
 *   4. まだ紐づいていないハンドルが見つかったら提案する
 *
 * 採用は自動でしない。公式ページのサイトからのリンクは強い証拠だが、
 * 既存の紐づけを機械が置き換えると事故ったとき気づけない。
 */
import { writeFile } from 'node:fs/promises';

import { chromium } from 'playwright';

import { dataPath, jitter, readJson, sleep } from './lib/io';
import type { Creator, Post } from './lib/types';

/** これより古い投稿しか無ければ休止とみなす。2026の告知は6月ごろから */
const ALIVE_SINCE = '2026-05-01';

type Finding = {
  circleName: string;
  boothIds: string[];
  handle: string;
  lastPostAt: string | null;
  siteUrls: string[];
  foundHandles: string[];
  /** まだ紐づいていない候補 */
  suggestions: string[];
};

function handlesFromHrefs(hrefs: string[]): string[] {
  const out: string[] = [];
  for (const href of hrefs) {
    const m = /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i.exec(href);
    if (!m) continue;
    const h = m[1]!;
    if (/^(i|intent|share|home|explore|search|hashtag|login|signup)$/i.test(h)) continue;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

async function main(): Promise<void> {
  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const lastByHandle = new Map<string, string>();
  for (const p of posts) {
    const k = p.handle.toLowerCase();
    const cur = lastByHandle.get(k);
    if (!cur || p.createdAt > cur) lastByHandle.set(k, p.createdAt);
  }

  // サークルごとに、全ハンドルが休止しているものを集める
  const targets = new Map<string, Finding>();
  for (const v of ['osaka', 'tokyo']) {
    for (const kind of ['creators', 'sponsors']) {
      for (const c of await readJson<Creator[]>(dataPath(`${kind}.${v}.json`), [])) {
        const hs = c.xHandles ?? [];
        if (hs.length === 0) continue;
        const lasts = hs.map((h) => lastByHandle.get(h.toLowerCase()) ?? null);
        // 1つでも生きていれば問題ない
        if (lasts.some((d) => d && d >= ALIVE_SINCE)) continue;

        const urls = (c.members ?? [])
          .flatMap((m) => m.links ?? [])
          .map((l) => l.url)
          .filter((u) => /^https?:\/\//.test(u));

        const cur = targets.get(c.circleName);
        if (cur) {
          if (c.boothId) cur.boothIds.push(`${v}:${c.boothId}`);
          continue;
        }
        targets.set(c.circleName, {
          circleName: c.circleName,
          boothIds: c.boothId ? [`${v}:${c.boothId}`] : [],
          handle: hs.join(', '),
          lastPostAt: lasts.filter(Boolean).sort().at(-1) ?? null,
          siteUrls: urls,
          foundHandles: [],
          suggestions: [],
        });
      }
    }
  }

  const queue = [...targets.values()];
  console.log('紐づけたアカウントが動いていないサークルを探します');
  console.log(`  ${ALIVE_SINCE} 以降に投稿が無いもの: ${queue.length}件\n`);
  if (queue.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  });
  await context.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();

  for (const t of queue) {
    for (const url of t.siteUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await page.waitForTimeout(1500);
        const hrefs = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href),
        );
        for (const h of handlesFromHrefs(hrefs)) {
          if (!t.foundHandles.includes(h)) t.foundHandles.push(h);
        }
      } catch {
        // 開けないサイトは飛ばす
      }
      await sleep(jitter(1_500, 3_000));
    }
    const known = t.handle.toLowerCase().split(', ');
    t.suggestions = t.foundHandles.filter((h) => !known.includes(h.toLowerCase()));

    console.log(
      `  ${t.circleName.slice(0, 22).padEnd(24)} @${t.handle} 最終 ${t.lastPostAt?.slice(0, 10) ?? '投稿なし'}` +
        (t.suggestions.length > 0 ? `  → 候補 @${t.suggestions.join(', @')}` : '  → 候補なし'),
    );
  }

  await browser.close();
  await writeFile(
    dataPath('x-handles-dormant.json'),
    JSON.stringify(queue, null, 2) + '\n',
    'utf8',
  );

  const withSuggestion = queue.filter((t) => t.suggestions.length > 0);
  console.log(`\n候補が見つかったサークル: ${withSuggestion.length}件`);
  console.log('  → data/x-handles-dormant.json');
  console.log('  中身を確認して data/x-handles-manual.json に追記してください。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
