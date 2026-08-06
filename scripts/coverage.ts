/**
 * 会場ごとに「何ブースのお品書きが載っているか」を出す。
 *
 * 件数が妥当かを確かめるための道具。公式のサークル総数を分母にして、
 * どのブースが載っていてどれが未掲載かを並べる。
 *
 *   npm run coverage
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  isMagimiraPost,
  isOshinagakiPost,
  selectPostsForVenue,
  selectReferencePostsForVenue,
  selectReviewCandidates,
} from './lib/curation';
import { REF_VENUE_META, VENUES, type Creator, type Curation, type Post, type Venue } from './lib/types';

const DATA = path.join(process.cwd(), 'data');

async function read<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const posts = await read<Post[]>('posts.json', []);
  const curation = await read<Curation>('curation.json', {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });

  console.log(`\n収集済み投稿 ${posts.length}件（うち画像つき ${posts.filter((p) => p.media.some((m) => m.kind === 'photo')).length}件）`);

  // 「お品書き」を含みマジミラに言及している投稿が、コーパス全体にいくつあるか。
  // 掲載件数がこれを大きく下回っていたら、判定のどこかで落としすぎている。
  const oshAll = posts.filter(
    (p) => p.media.some((m) => m.kind === 'photo') && isOshinagakiPost(p) && isMagimiraPost(p),
  );
  const cands = selectReviewCandidates(posts, curation);
  console.log(`マジミラのお品書きと判定できる投稿: ${oshAll.length}件`);
  console.log(`  うち候補（score>=50）: ${oshAll.filter((p) => cands.includes(p)).length}件`);
  console.log(
    `  うち候補外（浜松専用はスコア0で足切り）: ${oshAll.filter((p) => !cands.includes(p)).length}件`,
  );

  for (const v of VENUES as readonly Venue[]) {
    const creators = [
      ...(await read<Creator[]>(`creators.${v}.json`, [])),
      ...(await read<Creator[]>(`sponsors.${v}.json`, [])),
    ];
    const handleToBooth = new Map<string, string>();
    for (const c of creators) {
      if (!c.boothId) continue;
      for (const h of c.xHandles) handleToBooth.set(h.toLowerCase(), c.boothId);
    }

    const sel = selectPostsForVenue(posts, curation, v);
    const booths = new Set(
      sel.map((p) => handleToBooth.get(p.handle.toLowerCase())).filter((b): b is string => !!b),
    );

    const ref = selectReferencePostsForVenue(posts, curation, v, (h) => handleToBooth.has(h));
    const refBooths = new Set(
      ref.map((p) => handleToBooth.get(p.handle.toLowerCase())).filter((b): b is string => !!b),
    );

    console.log(`\n── ${REF_VENUE_META[v].label}`);
    console.log(`  サークル総数: ${creators.length}`);
    console.log(`  この会場のお品書きが載っているブース: ${booths.size} （投稿 ${sel.length}件）`);
    console.log(`  ${[...booths].sort().join(', ')}`);
    console.log(
      `  参考（浜松のお品書き）を出しているブース: ${refBooths.size} （投稿 ${ref.length}件）`,
    );
    console.log(`  合わせて何らかの情報があるブース: ${new Set([...booths, ...refBooths]).size}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
