/**
 * 会場マップ画像からブース矩形を検出する。
 *
 * 公式のマップ画像は「列ごとに色分けされた平坦な矩形の格子」なので、
 * ピクセルを解析すれば座標を機械的に取り出せる。
 * AI に読ませたり人手でクリックして置く必要がない。
 *
 * ブース内には白い番号文字があるため、水平1ラインの走査では
 * ブースが途切れてしまう。列（x）ごとに帯の高さ方向へ投影して
 * 「その x がブース内か」を数で判定する。
 */

export type Rgb = readonly [number, number, number];

export type RawImage = {
  width: number;
  height: number;
  channels: number;
  data: Uint8Array | Buffer;
};

export type DetectedBooth = {
  /** 列内の並び（0 起点、左から右） */
  index: number;
  /** ブース矩形（ピクセル） */
  x0: number;
  x1: number;
  /** 中心（正規化 0..1） */
  cx: number;
  cy: number;
};

export type DetectedRow = {
  color: Rgb;
  y0: number;
  y1: number;
  booths: DetectedBooth[];
};

// --- チューニング値 -------------------------------------------------------
/** 色一致の許容差（アンチエイリアスを吸収する） */
const COLOR_TOLERANCE = 12;
/** 帯とみなす最小の水平方向の広がり（px）。ロゴや注意アイコンを除外する */
const MIN_ROW_SPAN = 300;
/** 帯とみなす最小の高さ（px） */
const MIN_ROW_HEIGHT = 20;
/** ブースとみなす最小幅（px）。文字の隙間を拾わないため */
const MIN_BOOTH_WIDTH = 12;
/** その x を「ブース内」とみなす、帯高さに対する色ピクセルの割合 */
const COLUMN_FILL_RATIO = 0.35;

function px(img: RawImage, x: number, y: number): Rgb {
  const i = (y * img.width + x) * img.channels;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
}

function alphaAt(img: RawImage, x: number, y: number): number {
  if (img.channels < 4) return 255;
  return img.data[(y * img.width + x) * img.channels + 3]!;
}

export function colorsClose(a: Rgb, b: Rgb, tol = COLOR_TOLERANCE): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol
  );
}

/** 白・黒・灰色は背景や文字なので帯の色候補から外す */
export function isChromatic(c: Rgb): boolean {
  const [r, g, b] = c;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  // 彩度が低い（灰色系）は除外
  if (max - min < 25) return false;
  // 暗すぎる／明るすぎるものも除外（アイコンの黒、背景の白）
  if (max < 60 || min > 245) return false;
  return true;
}

function colorKey(c: Rgb): string {
  return `${c[0]},${c[1]},${c[2]}`;
}

function parseKey(k: string): Rgb {
  const [r, g, b] = k.split(',').map(Number);
  return [r!, g!, b!];
}

/**
 * 色の帯（= ブースの列）を上から順に検出する。
 * マップは A 列が最上段なので、検出順がそのまま列順になる。
 */
export function detectRowBands(img: RawImage): { color: Rgb; y0: number; y1: number }[] {
  // 各 y の「最も多い有彩色」とその幅を求める
  const perRow: ({ key: string; count: number } | null)[] = [];
  for (let y = 0; y < img.height; y++) {
    const tally = new Map<string, number>();
    for (let x = 0; x < img.width; x++) {
      if (alphaAt(img, x, y) < 128) continue;
      const c = px(img, x, y);
      if (!isChromatic(c)) continue;
      const k = colorKey(c);
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    let best: { key: string; count: number } | null = null;
    for (const [k, n] of tally) {
      if (!best || n > best.count) best = { key: k, count: n };
    }
    perRow.push(best && best.count >= MIN_ROW_SPAN ? best : null);
  }

  // 同じ色が連続する y をまとめて帯にする
  const bands: { color: Rgb; y0: number; y1: number }[] = [];
  let cur: { color: Rgb; y0: number; y1: number } | null = null;
  for (let y = 0; y < perRow.length; y++) {
    const r = perRow[y];
    if (!r) {
      if (cur) {
        if (cur.y1 - cur.y0 + 1 >= MIN_ROW_HEIGHT) bands.push(cur);
        cur = null;
      }
      continue;
    }
    const c = parseKey(r.key);
    if (cur && colorsClose(cur.color, c)) {
      cur.y1 = y;
    } else {
      if (cur && cur.y1 - cur.y0 + 1 >= MIN_ROW_HEIGHT) bands.push(cur);
      cur = { color: c, y0: y, y1: y };
    }
  }
  if (cur && cur.y1 - cur.y0 + 1 >= MIN_ROW_HEIGHT) bands.push(cur);

  return bands;
}

/**
 * 帯の中でブース矩形を検出する。
 * 列（x）ごとに帯の高さ方向へ投影するので、ブース内の白い番号文字で
 * 矩形が分断されない。
 */
export function detectBoothsInBand(
  img: RawImage,
  band: { color: Rgb; y0: number; y1: number },
): DetectedBooth[] {
  const height = band.y1 - band.y0 + 1;
  const need = Math.max(2, Math.floor(height * COLUMN_FILL_RATIO));

  const inside: boolean[] = new Array(img.width).fill(false);
  for (let x = 0; x < img.width; x++) {
    let n = 0;
    for (let y = band.y0; y <= band.y1; y++) {
      if (alphaAt(img, x, y) < 128) continue;
      if (colorsClose(px(img, x, y), band.color)) n += 1;
    }
    inside[x] = n >= need;
  }

  const booths: DetectedBooth[] = [];
  let start = -1;
  const cyPx = (band.y0 + band.y1) / 2;
  for (let x = 0; x <= img.width; x++) {
    const on = x < img.width && inside[x] === true;
    if (on && start < 0) start = x;
    if (!on && start >= 0) {
      const x1 = x - 1;
      if (x1 - start + 1 >= MIN_BOOTH_WIDTH) {
        booths.push({
          index: booths.length,
          x0: start,
          x1,
          cx: (start + x1) / 2 / img.width,
          cy: cyPx / img.height,
        });
      }
      start = -1;
    }
  }
  return booths;
}

export function detectRows(img: RawImage): DetectedRow[] {
  return detectRowBands(img).map((band) => ({
    ...band,
    booths: detectBoothsInBand(img, band),
  }));
}

/**
 * 検出した帯を列名（A, B, ...）に割り当てる。
 *
 * 検出できた帯の数が期待と違う場合や、ブース数が公式一覧と食い違う場合は
 * 黙って進めず、何がどう違うのかを返す。座標がずれたマップは
 * 誤った場所へ案内してしまい、無いより悪い。
 */
export function assignRows(
  rows: DetectedRow[],
  expected: { line: string; count: number }[],
): { assigned: { line: string; row: DetectedRow }[]; problems: string[] } {
  const problems: string[] = [];
  const assigned: { line: string; row: DetectedRow }[] = [];

  if (rows.length !== expected.length) {
    problems.push(
      `検出した列の数が公式一覧と違う: 検出 ${rows.length} / 期待 ${expected.length}` +
        `（検出: ${rows.map((r) => `y${r.y0}-${r.y1}:${r.booths.length}件`).join(' ')}）`,
    );
  }

  const n = Math.min(rows.length, expected.length);
  for (let i = 0; i < n; i++) {
    const row = rows[i]!;
    const exp = expected[i]!;
    assigned.push({ line: exp.line, row });
    if (row.booths.length !== exp.count) {
      problems.push(
        `${exp.line}列のブース数が違う: 検出 ${row.booths.length} / 期待 ${exp.count}`,
      );
    }
  }

  return { assigned, problems };
}
