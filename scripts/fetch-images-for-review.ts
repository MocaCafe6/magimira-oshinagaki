/**
 * 目で確かめるために画像を落としてくる。
 *
 *   npm run fetch-images-for-review -- --out <dir> [--limit 20] [--offset 0]
 *   npm run fetch-images-for-review -- --out <dir> --ids 123,456
 *   npm run fetch-images-for-review -- --out <dir> --ids 123 --all-media
 *
 * ⚠ 既定では投稿の**1枚目だけ**を落とす。お品書きが2枚目以降にある投稿が
 *   実際にある（PERIHAPI! 東京E2: 1枚目は出展告知のバナー、2枚目が
 *   「Single ¥1,870 / Box(8pcs) ¥14,960」の価格表だった）。
 *   取りこぼしたくない走査では --all-media を付けて全部落とすこと。
 *
 * 対象は「会場は確定しているのに、本文からはお品書きとも商品紹介とも
 * 判定できず落ちている投稿」。本文に「お品書き」と書かずに画像だけを
 * 貼るサークルが多く、ここが最大の取りこぼしになっている。
 *
 * 実例（ユーザー指摘）:
 *   https://x.com/akasakisagiri/status/2086408781395804573
 *   本文は「B-08「アカサキサギリ」のブースに遊びに来てね⭐ 修正しました💦」
 *   だけだが、貼られている画像はお品書きそのもの。
 *
 * 落としたものを人（または目のあるモデル）が見て、
 * data/image-reads.json に結果を書く。判定は verifyImageRead が
 * 公式データと突き合わせるので、読み違えても誤掲載にはならない。
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { isMagimiraPost, isOshinagakiPost, isProductPost } from './lib/curation';
import { dataPath, readJson, sleep } from './lib/io';
import type { Post } from './lib/types';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const out = arg('--out');
  if (!out) throw new Error('--out <dir> が要ります');
  const limit = arg('--limit') ? Number(arg('--limit')) : 20;
  const offset = arg('--offset') ? Number(arg('--offset')) : 0;
  const ids = arg('--ids')?.split(',').map((s) => s.trim());

  const posts = await readJson<Post[]>(dataPath('posts.json'), []);

  // --include-unresolved: 会場が未確定のものも対象にする。
  //
  // 画像には会場名とブース番号が印字されていることが多く、読めば
  // 「お品書きである」と「どの会場か」の両方が片付く。会場が確定して
  // いるものだけ見ていると、この一番効く層に手が届かない。
  const includeUnresolved = process.argv.includes('--include-unresolved');

  const targets = ids
    ? posts.filter((p) => ids.includes(p.id))
    : posts
        .filter(
          (p) =>
            p.score >= 50 &&
            p.media.some((m) => m.kind === 'photo') &&
            (includeUnresolved || (p.attribution?.provenVenues.length ?? 0) > 0) &&
            isMagimiraPost(p) &&
            !isOshinagakiPost(p) &&
            !isProductPost(p) &&
            p.imageIsOshinagaki === undefined,
        )
        // 縦長で大きい画像から見る。お品書きは縦長の一覧であることが多い
        .sort((a, b) => {
          const r = (p: Post): number => {
            const m = p.media.find((x) => x.kind === 'photo');
            return m && m.width && m.height ? m.height / m.width : 0;
          };
          return r(b) - r(a);
        });

  const slice = targets.slice(offset, offset + limit);
  // --all-media: 投稿の写真を全部落とす。お品書きが2枚目以降にあることがある
  const allMedia = process.argv.includes('--all-media');
  await mkdir(out, { recursive: true });

  const index: { file: string; id: string; handle: string; venues: string[]; text: string }[] = [];
  for (const [i, p] of slice.entries()) {
    const photos = p.media.filter((m) => m.kind === 'photo');
    const picked = allMedia ? photos : photos.slice(0, 1);
    for (const [mi, photo] of picked.entries()) {
      const url = photo.largeUrl || photo.origUrl || photo.baseUrl;
      if (!url) continue;
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`  取得失敗 ${p.id}[${mi}]: HTTP ${res.status}`);
        continue;
      }
      const suffix = picked.length > 1 ? `_${mi + 1}` : '';
      const file = `${String(offset + i).padStart(3, '0')}${suffix}_${p.handle}_${p.id}.jpg`;
      await writeFile(path.join(out, file), Buffer.from(await res.arrayBuffer()));
      index.push({
        file,
        id: p.id,
        handle: p.handle,
        venues: p.attribution?.provenVenues ?? [],
        text:
          (picked.length > 1 ? `[${mi + 1}/${picked.length}] ` : '') +
          p.text.replace(/\s+/g, ' ').slice(0, 100),
      });
      await sleep(300);
    }
  }

  await writeFile(path.join(out, '_index.json'), JSON.stringify(index, null, 2), 'utf8');
  console.log(`対象 ${targets.length}件中 ${slice.length}件を取得（offset ${offset}）`);
  console.log(`  → ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
