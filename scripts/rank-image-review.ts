/**
 * 判別待ちの画像を「お品書きらしさ」で並べ替える。
 *
 * お品書きは商品名と価格がびっしり並んだポスターなので、
 * 写真や商品1点の画像に比べて**輪郭の密度が圧倒的に高い**。
 * ラプラシアン相当の畳み込みで輪郭を取り、その割合を測る。
 *
 * 中身を読むわけではないので、これ自体は判定ではない。
 * 人（または画像判別）がどれから見るかを決めるための並べ替え。
 *
 *   npm run rank-image-review
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import type { Post } from './lib/types';
import type { ReviewTask } from './prepare-image-review';

const DATA = path.join(process.cwd(), 'data');

/** 輪郭の割合。文字が多いほど高い */
async function edgeDensity(file: string): Promise<number> {
  const buf = await sharp(file)
    .greyscale()
    .resize(600, 600, { fit: 'inside' })
    // ラプラシアン
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer();
  let strong = 0;
  for (const v of buf) {
    if (v > 24) strong++;
  }
  return strong / buf.length;
}

async function main() {
  const tasks = JSON.parse(
    await readFile(path.join(DATA, 'image-review-queue.json'), 'utf8'),
  ) as ReviewTask[];
  const posts = JSON.parse(await readFile(path.join(DATA, 'posts.json'), 'utf8')) as Post[];
  const byId = new Map(posts.map((p) => [p.id, p]));

  const rows: { task: ReviewTask; file: string; density: number; text: string }[] = [];
  for (const t of tasks) {
    for (const img of t.images) {
      if (!existsSync(img.file)) continue;
      let d = 0;
      try {
        d = await edgeDensity(img.file);
      } catch {
        continue;
      }
      rows.push({
        task: t,
        file: path.basename(img.file),
        density: d,
        text: (byId.get(t.postId)?.text ?? '').replace(/\s+/g, ' ').slice(0, 46),
      });
    }
  }

  rows.sort((a, b) => b.density - a.density);
  console.log(`\n判別待ちの画像 ${rows.length}枚を、お品書きらしさ（輪郭の密度）順に並べた\n`);
  for (const r of rows.slice(0, 45)) {
    console.log(
      `${(r.density * 100).toFixed(1).padStart(5)}%  ${r.file.padEnd(26)} @${r.task.handle.padEnd(16)} ${r.text}`,
    );
  }
  const rest = rows.length - 45;
  if (rest > 0) console.log(`\n（以下 ${rest}枚は輪郭が薄く、写真や商品1点の画像の可能性が高い）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
