/**
 * 会場マップ画像からブース座標を作る。
 *
 *   npm run detect-booths                  … 大阪・東京の両方
 *   npm run detect-booths -- --venue osaka
 *   npm run detect-booths -- --debug       … 検出結果を重ねた確認用画像も出す
 *
 * 出力: data/booth-coords.<venue>.json
 *
 * 公式マップは列ごとに色分けされた平坦な矩形の格子なので、
 * ピクセル解析で座標を機械的に取り出せる（AI も手作業も不要）。
 * 検出したブース数が公式一覧と一致しない場合は異常終了する。
 * ずれた座標のマップは誤った場所へ案内するので、無いより悪い。
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import sharp from 'sharp';

import { assignRows, detectRows, type RawImage } from './lib/booth-detect';
import { dataPath, readJson, writeJson, PROJECT_ROOT } from './lib/io';
import type { BoothCoord, Creator, Venue, VenueMap } from './lib/types';
import { VENUES, VENUE_META } from './lib/types';

const CACHE_DIR = resolve(PROJECT_ROOT, 'data', '.cache');

const MAP_URL: Record<Venue, string> = {
  osaka: 'https://magicalmirai.com/2026/images/ex/market/map_osaka_exmarket.png',
  tokyo: 'https://magicalmirai.com/2026/images/ex/market/map_tokyo_exmarket.png',
};

function parseVenues(argv: string[]): Venue[] {
  const i = argv.indexOf('--venue');
  if (i < 0) return [...VENUES];
  const v = argv[i + 1];
  if (v !== 'osaka' && v !== 'tokyo') {
    throw new Error(`--venue は osaka | tokyo（受け取った値: ${v}）`);
  }
  return [v];
}

async function loadMapImage(venue: Venue): Promise<{ buf: Buffer; path: string }> {
  await mkdir(CACHE_DIR, { recursive: true });
  const path = resolve(CACHE_DIR, `map_${venue}.png`);
  try {
    const { readFile } = await import('node:fs/promises');
    return { buf: await readFile(path), path };
  } catch {
    const res = await fetch(MAP_URL[venue]);
    if (!res.ok) throw new Error(`マップ画像の取得に失敗: ${res.status} ${MAP_URL[venue]}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(path, buf);
    return { buf, path };
  }
}

/** 公式一覧から「列ごとのブース数」を作る。ブース番号の最大値ではなくユニーク数 */
async function expectedRows(venue: Venue): Promise<{ line: string; count: number }[]> {
  const creators = await readJson<Creator[]>(dataPath(`creators.${venue}.json`), []);
  if (creators.length === 0) {
    throw new Error(
      `data/creators.${venue}.json が空です。先に \`npm run scrape-official\` を実行してください。`,
    );
  }
  const byLine = new Map<string, Set<number>>();
  for (const c of creators) {
    if (!c.line || c.boothNo === null) continue;
    const set = byLine.get(c.line) ?? new Set<number>();
    set.add(c.boothNo);
    byLine.set(c.line, set);
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([line, set]) => ({ line, count: set.size }));
}

/** 検出結果を重ねた確認用画像を書き出す */
async function writeDebugImage(
  venue: Venue,
  buf: Buffer,
  width: number,
  height: number,
  coords: BoothCoord[],
): Promise<string> {
  const marks = coords
    .map((c) => {
      const x = c.x * width;
      const y = c.y * height;
      return (
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="#111" stroke-width="4"/>` +
        `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="9" fill="none" stroke="#39c5bb" stroke-width="2"/>` +
        `<text x="${x.toFixed(1)}" y="${(y - 14).toFixed(1)}" font-size="14" font-family="sans-serif" ` +
        `text-anchor="middle" fill="#111" stroke="#fff" stroke-width="3" paint-order="stroke">${c.boothId}</text>`
      );
    })
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${marks}</svg>`;
  const out = resolve(PROJECT_ROOT, 'screenshots', `booths-${venue}.png`);
  await mkdir(resolve(PROJECT_ROOT, 'screenshots'), { recursive: true });
  await sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .png()
    .toFile(out);
  return out;
}

async function run(venue: Venue, debug: boolean): Promise<void> {
  const meta = VENUE_META[venue];
  console.log(`\n[${meta.label}]`);

  const { buf, path } = await loadMapImage(venue);
  const image = sharp(buf);
  const info = await image.metadata();
  const { data, info: raw } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // HTML の width/height 属性は実寸と食い違うことがあるので実寸を使う
  console.log(`  画像: ${path} (${raw.width}x${raw.height}, HTML属性は ${info.width}x${info.height})`);

  const img: RawImage = {
    width: raw.width,
    height: raw.height,
    channels: raw.channels,
    data,
  };

  const rows = detectRows(img);
  console.log(`  検出した列: ${rows.length}`);
  for (const r of rows) {
    console.log(
      `    y ${r.y0}-${r.y1} rgb(${r.color.join(',')}) → ブース ${r.booths.length}件`,
    );
  }

  const expected = await expectedRows(venue);
  console.log(`  公式一覧: ${expected.map((e) => `${e.line}:${e.count}`).join(' ')}`);

  const { assigned, problems } = assignRows(rows, expected);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ✖ ${p}`);
    throw new Error(
      `[${meta.label}] ブース検出が公式一覧と一致しませんでした。` +
        ' ずれた座標は誤った場所へ案内するため、書き出しを中止します。' +
        ' --debug で確認用画像を出して booth-detect.ts のしきい値を調整してください。',
    );
  }

  const coords: BoothCoord[] = [];
  for (const { line, row } of assigned) {
    row.booths.forEach((b, i) => {
      coords.push({
        boothId: `${line}-${i + 1}`,
        x: Number(b.cx.toFixed(5)),
        y: Number(b.cy.toFixed(5)),
        // 画像から機械的に取っているので検証済み扱い。
        // 目視で確認したいときは --debug の画像を見る。
        verified: true,
      });
    });
  }

  // 公式一覧に存在するブースIDが全部あるか（取りこぼしを検出する）
  const creators = await readJson<Creator[]>(dataPath(`creators.${venue}.json`), []);
  const wanted = new Set(
    creators.filter((c) => c.boothId && c.line).map((c) => c.boothId as string),
  );
  const got = new Set(coords.map((c) => c.boothId));
  const missing = [...wanted].filter((b) => !got.has(b));
  if (missing.length > 0) {
    throw new Error(
      `[${meta.label}] 座標が作れなかったブースがある: ${missing.join(', ')}。` +
        ' 検出したブース数は合っているのに ID が噛み合っていないので、' +
        ' 列の割り当て順（マップ上から A, B, ...）を確認してください。',
    );
  }

  // ブースが実際にある領域を求める。告知や余白を切り落とすために使う。
  // 入口・出口の矢印や列ラベルが入るよう、少し外側に余白を足す。
  const xs = assigned.flatMap(({ row }) => row.booths.flatMap((b) => [b.x0, b.x1]));
  const ys = assigned.flatMap(({ row }) => [row.y0, row.y1]);
  const padX = raw.width * 0.09;
  const padY = raw.height * 0.05;
  const boothArea = {
    x0: Number((Math.max(0, Math.min(...xs) - padX) / raw.width).toFixed(5)),
    y0: Number((Math.max(0, Math.min(...ys) - padY) / raw.height).toFixed(5)),
    x1: Number((Math.min(raw.width, Math.max(...xs) + padX) / raw.width).toFixed(5)),
    y1: Number((Math.min(raw.height, Math.max(...ys) + padY) / raw.height).toFixed(5)),
  };
  console.log(
    `  ブース領域: x ${boothArea.x0}–${boothArea.x1} / y ${boothArea.y0}–${boothArea.y1}`,
  );

  const map: VenueMap = {
    venue,
    imageUrl: MAP_URL[venue],
    imageWidth: raw.width,
    imageHeight: raw.height,
    boothArea,
    coords,
  };
  await writeJson(dataPath(`booth-coords.${venue}.json`), map);
  console.log(`  → data/booth-coords.${venue}.json (${coords.length}ブース)`);

  if (debug) {
    const out = await writeDebugImage(venue, buf, raw.width, raw.height, coords);
    console.log(`  → ${out}（検出位置の確認用）`);
  }
}

async function main(): Promise<void> {
  const venues = parseVenues(process.argv.slice(2));
  const debug = process.argv.includes('--debug');
  for (const v of venues) await run(v, debug);
  console.log('\n完了。');
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
