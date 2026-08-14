/**
 * 目視用の一覧シートを作る。
 *
 *   npm run make-review-sheets -- --dir <fetch-images-for-review の出力先>
 *
 * 1枚ずつ開くのは効率が悪い。16枚を1枚に並べると、お品書きかどうかは
 * ひと目で分かる（価格が並んだポスターと物撮りは見た目が全く違う）。
 * 実測で、これに切り替えてから確認の速度が桁違いになった。
 *
 * OCR や輪郭密度で絞る案はどちらも外れた。OCR は tesseract の読み取りが
 * ほとんど文字になっておらず、輪郭密度は布の上に置いた物撮りが1位に来た
 * （布目で密度が上がる）。素直に全部見るのが速い。
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

const COLS = 4;
const ROWS = 4;
const CELL = 470;

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const dir = arg('--dir');
  if (!dir) throw new Error('--dir <画像を落としたディレクトリ> が要ります');

  const index = JSON.parse(await readFile(path.join(dir, '_index.json'), 'utf8')) as {
    file: string;
    id: string;
    handle: string;
    venues: string[];
    text: string;
  }[];

  const per = COLS * ROWS;
  const sheets = Math.ceil(index.length / per);

  for (let s = 0; s < sheets; s++) {
    const group = index.slice(s * per, (s + 1) * per);
    const composites: sharp.OverlayOptions[] = [];
    for (const [i, r] of group.entries()) {
      try {
        const buf = await sharp(path.join(dir, r.file))
          .resize(CELL - 8, CELL - 8, { fit: 'contain', background: { r: 250, g: 250, b: 250 } })
          .png()
          .toBuffer();
        composites.push({
          input: buf,
          left: (i % COLS) * CELL + 4,
          top: Math.floor(i / COLS) * CELL + 4,
        });
      } catch {
        // 壊れた画像は飛ばす。1枚のためにシート全体を落とさない
      }
    }
    await sharp({
      create: {
        width: COLS * CELL,
        height: ROWS * CELL,
        channels: 3,
        background: { r: 190, g: 190, b: 190 },
      },
    })
      .composite(composites)
      .jpeg({ quality: 78 })
      .toFile(path.join(dir, `s${s}.jpg`));
  }

  // 各シートの中身を index 付きで書き出す。見ながら対応を引けるように
  const lines = index.map(
    (r, i) =>
      `${String(i).padStart(3)} [シート${Math.floor(i / per)}の${i % per}] ${r.id} @${r.handle} [${r.venues.join(',')}] ${r.text.slice(0, 60)}`,
  );
  await writeFile(path.join(dir, '_map.txt'), lines.join('\n'), 'utf8');

  console.log(`シート ${sheets}枚（各${per}枚）`);
  console.log(`  → ${path.join(dir, 's0.jpg')} …`);
  console.log(`  → ${path.join(dir, '_map.txt')}（index と投稿の対応）`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
