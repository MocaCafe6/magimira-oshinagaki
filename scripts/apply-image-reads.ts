/**
 * 画像から読み取った会場情報を data/posts.json に取り込む。
 *
 * 入力: data/image-reads.json — 読み取り結果の配列
 *   [{ "postId": "19...", "isOshinagaki": true,
 *      "venues": [{ "venue": "osaka", "boothId": "D-6", "dates": ["2026-08-15"] }],
 *      "notes": null }]
 *
 * 読み取った内容をそのまま信じることはしない。verifyImageRead が
 * 公式の出展記録と突き合わせ、通ったものだけを確定にする。
 * これは attribute-images.ts（Claude API 経由）と同じ判定を通る。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { verifyImageRead, type ImageRead } from './lib/image-verdict';
import { buildOfficialIndex } from './lib/venue-attribution';
import { REF_VENUES, type Creator, type Post, type RefVenue } from './lib/types';

const DATA = path.join(process.cwd(), 'data');

type Input = ImageRead & { postId: string };

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const file = process.argv[2] ?? 'image-reads.json';
  const reads = await readJson<Input[]>(file, []);
  if (reads.length === 0) {
    console.error(`data/${file} が空か、読めません。`);
    process.exit(1);
  }

  const posts = await readJson<Post[]>('posts.json', []);
  const byId = new Map(posts.map((p) => [p.id, p]));

  const officialRows = (
    await Promise.all(
      REF_VENUES.flatMap((v: RefVenue) =>
        ['creators', 'sponsors'].map(async (kind) => {
          const list = await readJson<Creator[]>(`${kind}.${v}.json`, []);
          return list.map((c) => ({
            venue: v,
            boothId: c.boothId,
            days: c.days,
            xHandles: c.xHandles,
          }));
        }),
      ),
    )
  ).flat();
  const officialIndex = buildOfficialIndex(officialRows);

  let proven = 0;
  let unresolved = 0;
  let mismatch = 0;
  let missing = 0;

  for (const r of reads) {
    const post = byId.get(r.postId);
    if (!post) {
      missing++;
      console.log(`  ${r.postId} — 該当する投稿が無い`);
      continue;
    }
    const official = officialIndex.get(post.handle.toLowerCase()) ?? [];
    const { attribution, mismatched } = verifyImageRead(r, official);
    if (mismatched) mismatch++;

    // 画像がお品書きかどうかは、会場の確定とは別に記録する。
    //
    // ただし OCR の陰性は書き込まない。tesseract は本物のお品書きを
    // かなり読み落とすので、「読めなかった」を「お品書きではない」として
    // 記録すると、本文の「お品書き」の語で正しく載っている投稿を消してしまう。
    // 未判定のままにして本文による判定に委ねる。
    const trustNegative = (r.readBy ?? 'manual') !== 'ocr' || r.negativeIsReliable === true;
    const next: Post = { ...post };
    if (r.isOshinagaki || trustNegative) next.imageIsOshinagaki = r.isOshinagaki;

    if (attribution.provenVenues.length > 0) {
      proven++;
      next.attribution = attribution;
      console.log(`  @${post.handle} ${post.id} → ${attribution.provenVenues.join(',')}`);
    } else {
      unresolved++;
      // 画像から会場が読めなかっただけなら、本文で確定済みの帰属は消さない。
      // 根拠は既存のものに追記して、レビューで理由が見えるようにする。
      const had = (post.attribution?.provenVenues.length ?? 0) > 0;
      if (had) {
        next.attribution = {
          ...post.attribution!,
          evidence: [...post.attribution!.evidence, ...attribution.evidence],
        };
        console.log(`  @${post.handle} ${post.id} 画像からは会場を読めず（本文の判定を維持）`);
      } else {
        next.attribution = attribution;
        console.log(`  @${post.handle} ${post.id} 確定せず（${attribution.evidence[0] ?? ''}）`);
      }
    }
    byId.set(post.id, next);
  }

  const next = posts.map((p) => byId.get(p.id) ?? p);
  await writeFile(path.join(DATA, 'posts.json'), JSON.stringify(next, null, 2) + '\n', 'utf8');

  console.log(`\n読み取り ${reads.length}件`);
  console.log(`  確定: ${proven}件 / 確定せず: ${unresolved}件`);
  if (mismatch > 0) console.log(`  公式と食い違い: ${mismatch}件`);
  if (missing > 0) console.log(`  投稿が見つからない: ${missing}件`);
  console.log('  → data/posts.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
