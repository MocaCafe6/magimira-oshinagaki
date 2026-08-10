/**
 * 目視の順番を決める。落としてきた画像を OCR にかけ、
 * 「お品書きらしさ」の強い順に並べて出す。
 *
 *   npm run fetch-images-for-review -- --out <dir> --limit 40
 *   npm run rank-unresolved-images -- --dir <dir>
 *
 * 1枚ずつ見るのは効率が悪い。実測で、上から順に見ると
 * 公式ページのスクリーンショット・商品1点の物撮り・ブースの写真が
 * 大半で、お品書きは少数だった。先に機械で絞る。
 *
 * これ自体は判定ではない。OCR は誤読するので、**掲載可否には使わない**。
 * 「どれを人が見るか」を決めるだけ。判定は目視の結果を
 * data/image-reads.json に書き、verifyImageRead が公式データと
 * 突き合わせて確定させる。
 *
 * 見る手がかり:
 *   価格の個数   … お品書きは商品名と価格が並ぶ。多いほど一覧らしい
 *   サークルメンバー … この語があれば公式サイトのスクショ。お品書きではない
 *   お品書きの語 … 画像の見出しに入っていることが多い
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { countPrices, isOfficialListingShot, ocrImage } from './lib/ocr';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

const OSHINAGAKI_RE = /お品書き|おしながき|品書き|MENU|LINE\s*UP|LINEUP/i;

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

  const rows: {
    file: string;
    id: string;
    handle: string;
    venues: string[];
    prices: number;
    listingShot: boolean;
    hasWord: boolean;
    score: number;
  }[] = [];

  for (const [i, r] of index.entries()) {
    let text = '';
    try {
      text = await ocrImage(path.join(dir, r.file));
    } catch (e) {
      console.log(`  OCR失敗 ${r.file}: ${(e as Error).message}`);
    }
    const prices = countPrices(text);
    const listingShot = isOfficialListingShot(text);
    const hasWord = OSHINAGAKI_RE.test(text);
    // 公式スクショは強く下げる。価格の個数と見出しの語で上げる
    const score = (listingShot ? -100 : 0) + prices * 10 + (hasWord ? 30 : 0);
    rows.push({ ...r, prices, listingShot, hasWord, score });
    process.stdout.write(`\r  OCR ${i + 1}/${index.length}   `);
  }
  console.log('');

  rows.sort((a, b) => b.score - a.score);
  await writeFile(path.join(dir, '_ranked.json'), JSON.stringify(rows, null, 2), 'utf8');

  console.log('お品書きらしさの順（OCRによる目安。判定ではない）');
  for (const r of rows) {
    const tag = r.listingShot ? '公式スクショ' : r.hasWord ? 'お品書きの語あり' : '';
    console.log(
      `  ${String(r.score).padStart(4)}  価格${String(r.prices).padStart(2)}個  ${r.file.padEnd(48)}${tag}`,
    );
  }
  console.log(`\n  → ${path.join(dir, '_ranked.json')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
