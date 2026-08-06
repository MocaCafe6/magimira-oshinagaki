/**
 * 会場・ブース番号の言及パターンを実データから洗い出す（設計用の調査スクリプト）。
 *
 *   npm run analyze-venue
 *
 * 会場帰属を自動判別する規則を作るために、実際の投稿が
 * 会場名とブース番号をどう書いているかを網羅的に見る。
 */

import { dataPath, readJson } from './lib/io';
import type { Creator, Post } from './lib/types';

const VENUE_WORDS = ['浜松', 'HAMAMATSU', 'hamamatsu', '大阪', 'OSAKA', 'osaka', '東京', 'TOKYO', 'tokyo'];

/** ブース番号らしき表記を全部拾う（表記揺れを含む） */
const BOOTH_RE = /([A-Ga-g])\s*[-‐‑–—−ー－]?\s*(\d{1,2})(?![0-9])/g;

async function main(): Promise<void> {
  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const creators: Creator[] = [];
  for (const f of ['creators.osaka.json', 'creators.tokyo.json']) {
    creators.push(...(await readJson<Creator[]>(dataPath(f), [])));
  }

  // ハンドル → 会場ごとの公式ブース番号
  const official = new Map<string, { osaka: string[]; tokyo: string[] }>();
  for (const c of creators) {
    for (const h of c.xHandles) {
      const k = h.toLowerCase();
      const cur = official.get(k) ?? { osaka: [], tokyo: [] };
      if (c.boothId) cur[c.venue].push(c.boothId);
      official.set(k, cur);
    }
  }

  const candidates = posts.filter((p) => p.score >= 50);
  console.log(`候補 ${candidates.length}件を分析\n`);

  let withVenueWord = 0;
  let withBooth = 0;
  let withBoth = 0;
  let withNeither = 0;
  const neitherSamples: Post[] = [];
  const patternSamples = new Map<string, string[]>();

  for (const p of candidates) {
    const text = p.text;
    const hasVenue = VENUE_WORDS.some((w) => text.includes(w));
    BOOTH_RE.lastIndex = 0;
    const booths = [...text.matchAll(BOOTH_RE)].map((m) => `${m[1]!.toUpperCase()}-${Number(m[2])}`);
    const hasBooth = booths.length > 0;

    if (hasVenue) withVenueWord += 1;
    if (hasBooth) withBooth += 1;
    if (hasVenue && hasBooth) withBoth += 1;
    if (!hasVenue && !hasBooth) {
      withNeither += 1;
      if (neitherSamples.length < 12) neitherSamples.push(p);
    }

    // 会場名とブース番号がどう並んでいるかのパターンを集める
    if (hasVenue && hasBooth) {
      const snippet = text
        .replace(/\s+/g, ' ')
        .match(/.{0,12}(浜松|HAMAMATSU|大阪|OSAKA|東京|TOKYO).{0,18}/gi)
        ?.slice(0, 3)
        .join(' … ');
      if (snippet) {
        const key = snippet.slice(0, 60);
        const arr = patternSamples.get(key) ?? [];
        arr.push(p.handle);
        patternSamples.set(key, arr);
      }
    }
  }

  console.log('=== 言及の内訳 ===');
  console.log(`  会場名あり: ${withVenueWord}件`);
  console.log(`  ブース番号あり: ${withBooth}件`);
  console.log(`  両方あり: ${withBoth}件`);
  console.log(`  どちらも無い: ${withNeither}件  ← 本文だけでは会場を特定できない`);

  console.log('\n=== 公式ブース番号との照合可能性 ===');
  let matchOsaka = 0;
  let matchTokyo = 0;
  let matchNeither = 0;
  for (const p of candidates) {
    const off = official.get(p.handle.toLowerCase());
    if (!off) continue;
    BOOTH_RE.lastIndex = 0;
    const booths = new Set(
      [...p.text.matchAll(BOOTH_RE)].map((m) => `${m[1]!.toUpperCase()}-${Number(m[2])}`),
    );
    const norm = (b: string) => {
      const m = /^([A-Z])-0*(\d+)$/.exec(b);
      return m ? `${m[1]}-${Number(m[2])}` : b;
    };
    const o = off.osaka.some((b) => booths.has(norm(b)));
    const t = off.tokyo.some((b) => booths.has(norm(b)));
    if (o) matchOsaka += 1;
    if (t) matchTokyo += 1;
    if (!o && !t) matchNeither += 1;
  }
  console.log(`  大阪の公式ブース番号と一致: ${matchOsaka}件`);
  console.log(`  東京の公式ブース番号と一致: ${matchTokyo}件`);
  console.log(`  どちらとも一致しない: ${matchNeither}件`);

  console.log('\n=== 会場名もブース番号も無い投稿の例 ===');
  for (const p of neitherSamples) {
    const t = p.text.replace(/\n/g, ' ').slice(0, 78);
    console.log(`  画像${p.media.length}枚 @${p.handle}: ${t}`);
  }

  console.log('\n=== 会場名とブース番号の並びパターン（上位） ===');
  const top = [...patternSamples.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 14);
  for (const [k, v] of top) console.log(`  (${v.length}) ${k}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
