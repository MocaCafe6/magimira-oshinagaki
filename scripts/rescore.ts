/**
 * 取得済みの投稿にスコアリングだけを再適用する。
 *
 *   npm run rescore
 *
 * スコアリング規則を変えたときに使う。X に再アクセスしないので
 * レート制限を消費せず、数秒で終わる。
 * data/posts.json のスコアと判定根拠だけを書き換える。
 */

import { dataPath, readJson, writeJson } from './lib/io';
import type { OfficialListing } from './lib/official-parser';
import { scoreOshinagaki, CANDIDATE_THRESHOLD } from './lib/oshinagaki-score';
import type { Creator, Post } from './lib/types';
import { attributeFromText, buildOfficialIndex } from './lib/venue-attribution';

async function loadBoothIndex(): Promise<Map<string, string[]>> {
  const creators: Creator[] = [];
  for (const f of [
    'creators.osaka.json',
    'creators.tokyo.json',
    'sponsors.osaka.json',
    'sponsors.tokyo.json',
  ]) {
    creators.push(...(await readJson<Creator[]>(dataPath(f), [])));
  }
  const byHandle = new Map<string, string[]>();
  for (const c of creators) {
    for (const h of c.xHandles) {
      const arr = byHandle.get(h) ?? [];
      if (c.boothId && !arr.includes(c.boothId)) arr.push(c.boothId);
      byHandle.set(h, arr);
    }
  }
  return byHandle;
}

async function main(): Promise<void> {
  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  if (posts.length === 0) {
    throw new Error('data/posts.json が空です。先に `npm run crawl-x` を実行してください。');
  }
  const boothIndex = await loadBoothIndex();
  const listings = await readJson<OfficialListing[]>(dataPath('official-listings.json'), []);
  if (listings.length === 0) {
    throw new Error(
      'data/official-listings.json がありません。先に `npm run scrape-official` を実行してください。',
    );
  }
  const officialIndex = buildOfficialIndex(listings);

  const before = posts.filter((p) => p.score >= CANDIDATE_THRESHOLD).length;
  const changed: { post: Post; from: number; to: number }[] = [];

  const rescored = posts.map((p) => {
    const { score, signals } = scoreOshinagaki({
      text: p.text,
      mediaCount: p.media.length,
      isPinned: p.isPinned,
      isReply: p.isReply,
      isRetweet: p.isRetweet,
      createdAt: p.createdAt,
      boothIds: boothIndex.get(p.handle) ?? [],
    });
    // 画像から確定済みのものは上書きしない（本文より強い証拠）
    const keepImage = p.attribution?.source === 'image' || p.attribution?.source === 'manual';
    const attribution = keepImage
      ? p.attribution
      : attributeFromText({
          text: p.text,
          handle: p.handle,
          altTexts: p.media.map((m) => m.altText),
          official: officialIndex.get(p.handle.toLowerCase()) ?? [],
        });
    if (score !== p.score) changed.push({ post: p, from: p.score, to: score });
    return { ...p, score, matchedSignals: signals, attribution };
  });

  await writeJson(dataPath('posts.json'), rescored);

  const after = rescored.filter((p) => p.score >= CANDIDATE_THRESHOLD).length;
  console.log(`再スコアリング完了: ${posts.length}件`);
  console.log(`  候補（score≧${CANDIDATE_THRESHOLD}）: ${before}件 → ${after}件`);
  console.log(`  スコアが変わった投稿: ${changed.length}件`);

  // 会場帰属の内訳。ここが公開可否を決める
  const cand = rescored.filter((p) => p.score >= CANDIDATE_THRESHOLD);
  const bySource = new Map<string, number>();
  let osaka = 0;
  let tokyo = 0;
  let unresolved = 0;
  for (const p of cand) {
    const a = p.attribution;
    const s = a?.source ?? 'unresolved';
    bySource.set(s, (bySource.get(s) ?? 0) + 1);
    if (a?.provenVenues.includes('osaka')) osaka += 1;
    if (a?.provenVenues.includes('tokyo')) tokyo += 1;
    if (!a || a.provenVenues.length === 0) unresolved += 1;
  }
  console.log(`\n  会場帰属（候補 ${cand.length}件）`);
  console.log(`    大阪と確定: ${osaka}件 / 東京と確定: ${tokyo}件`);
  console.log(`    未確定（公開されない）: ${unresolved}件`);
  console.log(
    `    判定根拠: ${[...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
  );

  // 閾値を跨いだものだけ具体的に出す（意図した変化か目で確かめる）
  const crossed = changed.filter(
    (c) =>
      (c.from >= CANDIDATE_THRESHOLD) !== (c.to >= CANDIDATE_THRESHOLD),
  );
  if (crossed.length > 0) {
    const dropped = crossed.filter((c) => c.to < CANDIDATE_THRESHOLD);
    const added = crossed.filter((c) => c.to >= CANDIDATE_THRESHOLD);
    console.log(`  候補から外れた: ${dropped.length}件 / 新たに候補: ${added.length}件`);
    for (const c of dropped.slice(0, 8)) {
      const t = c.post.text.replace(/\n/g, ' ').slice(0, 55);
      console.log(`    -${c.from}→${c.to} @${c.post.handle}: ${t}`);
    }
    if (dropped.length > 8) console.log(`    ... 他 ${dropped.length - 8}件`);
  }
  console.log(`  → data/posts.json`);
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
