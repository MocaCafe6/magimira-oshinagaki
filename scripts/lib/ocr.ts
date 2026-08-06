/**
 * お品書き画像から印字された文字を読む。
 *
 * お品書きには会場名とブース番号がほぼ必ず印字されている。
 * つまり画像を「理解」する必要はなく、**書いてある文字を読むだけでよい**。
 * それなら OCR で足りる（Claude API も API キーも要らない）。
 *
 * 読み取った文字はそのまま信じない。既存の照合関門
 * `verifyImageRead()`（image-verdict.ts）に流し、公式の出展記録と
 * 突き合わせたものだけが確定する。**OCR が誤読しても誤掲載にはならない**
 * — 公式データと一致しなくなるので、非掲載になるだけ。
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';
import { createWorker, type Worker } from 'tesseract.js';

const CACHE_PATH = path.join(process.cwd(), 'data', 'ocr-cache.json');

// ---------------------------------------------------------------------------
// 価格表記の検出 — 「これは頒布物の一覧か」の判定材料
// ---------------------------------------------------------------------------

/**
 * 価格表記の個数を数える。
 *
 * お品書きは商品名と価格が並んだ一覧なので、価格表記が複数ある。
 * 「設営完了しました！A-9です」のような写真にはブース看板が写ることがあり、
 * ブース番号だけでは頒布物の一覧だと言えない。価格の個数がその区別になる。
 *
 * OCR は「¥」を Y や ￥ や半角の Ұ に読み違えることがあるので幅を持たせる。
 * 「2026年」を価格と誤認しないよう、円記号か「円」の字を必須にする。
 */
export function countPrices(text: string): number {
  const t = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const found = new Set<string>();
  // OCR は桁区切りのカンマを「.」や「,」や空白に読み違える
  const num = (s: string): number => Number(s.replace(/[,.\s]/g, ''));

  // ¥1,500 / ￥2000 / Y1500 / y2.000
  // OCR は「¥」を Y y Ұ ￥ に読み違える。y は誤検出しやすいので3桁以上に限る。
  for (const m of t.matchAll(/[¥￥ҰＹYy]\s?(\d{1,3}(?:[,.\s]\d{3})+|\d{2,6})/g)) {
    const n = num(m[1]!);
    if (n >= 100 && n <= 999999) found.add(`${m.index}:${n}`);
  }
  // 1,500円 / 2000 円。「円」があるので誤検出しにくく、下限を緩めてよい
  for (const m of t.matchAll(/(\d{1,3}(?:[,.\s]\d{3})+|\d{2,6})\s?円/g)) {
    const n = num(m[1]!);
    if (n >= 10 && n <= 999999) found.add(`${m.index}:${n}`);
  }

  return found.size;
}

/**
 * 公式出店者一覧ページのスクリーンショットか。
 *
 * 6/11（公式一覧の公開日）に多くのサークルが「参加します」とだけ書いて
 * 公式ページの自分の欄を画面写真で貼った。会場ごとに1枚ずつ並べるので
 * 一見お品書きに似ているが、頒布物は一切載っていない。
 *
 * 公式ページには「サークルメンバー」という見出しがあり、
 * これはお品書きにはまず出てこない。読めた時点で
 * 「お品書きではない」と断定できる数少ない否定の証拠。
 */
export function isOfficialListingShot(text: string): boolean {
  const t = text.replace(/\s+/g, '');
  return /サークルメンバー|サーク[ルレ]メン[バパ]ー/.test(t);
}

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

type Cache = Record<string, { text: string; at: string }>;

let cache: Cache | null = null;
let worker: Worker | null = null;

async function loadCache(): Promise<Cache> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await readFile(CACHE_PATH, 'utf8')) as Cache;
  } catch {
    cache = {};
  }
  return cache;
}

export async function saveCache(): Promise<void> {
  if (!cache) return;
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
}

/**
 * tesseract に渡す前に画像を整える。
 * お品書きは装飾的な背景の上に文字が乗っていることが多いので、
 * グレースケール化してコントラストを立て、小さすぎる文字は拡大する。
 */
/** OCR に渡す画像の長辺。実測でこのくらい拡大しないと小さい文字を拾えない */
const TARGET_LONG_EDGE = 2800;

async function preprocess(file: string): Promise<Buffer> {
  const img = sharp(file);
  const meta = await img.metadata();
  const w = meta.width ?? 1000;
  const h = meta.height ?? 1000;
  const long = Math.max(w, h);
  const scale = long > 0 ? TARGET_LONG_EDGE / long : 1;

  // sharpen() は入れない。装飾的な背景のノイズまで立ってしまい、
  // 実測で読み取りが悪化した。
  return img
    .greyscale()
    .resize({
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      fit: 'inside',
      withoutEnlargement: false,
    })
    .normalise()
    .png()
    .toBuffer();
}

async function getWorker(): Promise<Worker> {
  if (worker) return worker;
  // jpn: 商品名・会場名  eng: ブース番号(A-1)・価格の数字
  worker = await createWorker(['jpn', 'eng']);
  return worker;
}

export async function closeOcr(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
  await saveCache();
}

/** 画像から文字を読む。同じ内容の画像は二度読まない */
export async function ocrImage(file: string): Promise<string> {
  const buf = await readFile(file);
  const key = createHash('sha256').update(buf).digest('hex').slice(0, 16);

  const c = await loadCache();
  const hit = c[key];
  if (hit) return hit.text;

  const pre = await preprocess(file);
  const w = await getWorker();
  const { data } = await w.recognize(pre);
  const text = data.text ?? '';

  c[key] = { text, at: new Date().toISOString() };
  return text;
}
