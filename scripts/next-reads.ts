/**
 * 画像を読めば掲載できるようになる投稿を、効果の大きい順に並べる。
 *
 * いちばん効くのは「**会場は既に確定しているのに、お品書きだと確認できて
 * いないせいで非掲載**」のもの。画像を1枚見て確認するだけで掲載に変わる。
 *
 *   npm run next-reads
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isMagimiraPost, isOshinagakiPost, selectReviewCandidates } from './lib/curation';
import type { Curation, Post } from './lib/types';
import type { ReviewTask } from './prepare-image-review';

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
  const queue = await read<ReviewTask[]>('image-review-queue.json', []);
  const byId = new Map(queue.map((t) => [t.postId, t]));

  const cands = selectReviewCandidates(posts, curation);

  // 会場は確定済み。お品書きだと確認できれば即掲載になる
  const ready = cands.filter(
    (p) =>
      (p.attribution?.provenVenues.length ?? 0) > 0 &&
      isMagimiraPost(p) &&
      !isOshinagakiPost(p) &&
      p.media.some((m) => m.kind === 'photo'),
  );

  // 会場が未確定。画像から会場が読めれば掲載になる（読み手の力量が要る）
  const unresolved = cands.filter(
    (p) =>
      (p.attribution?.provenVenues.length ?? 0) === 0 &&
      isMagimiraPost(p) &&
      p.media.some((m) => m.kind === 'photo') &&
      p.imageIsOshinagaki === undefined,
  );

  const show = (list: Post[], title: string) => {
    console.log(`\n── ${title}: ${list.length}件`);
    for (const p of list) {
      const t = byId.get(p.id);
      const files = t ? t.images.map((i) => path.basename(i.file)).join(' ') : '(キュー外)';
      console.log(
        `  ${(p.attribution?.provenVenues.join(',') || '未確定').padEnd(12)} @${p.handle.padEnd(16)} ${files}`,
      );
      console.log(`      ${p.text.replace(/\s+/g, ' ').slice(0, 62)}`);
    }
  };

  show(ready, '会場は確定済み。画像を1枚見るだけで掲載になる');
  show(unresolved.slice(0, 30), '会場が未確定。画像から会場が読めれば掲載になる（先頭30件）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
