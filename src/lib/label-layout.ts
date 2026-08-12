/**
 * マップ上のラベルが重ならないように位置をずらす。
 *
 * ピンの真上にサークル名を置くだけだと、隣り合うブースを両方お気に入りに
 * 入れた時点で文字が重なって読めなくなる。実際にそうなっていた。
 *
 * やること: ラベルを矩形として扱い、重なっていたら片方を上下にずらす。
 * 力学的なレイアウト（反復して押し合う）は結果が安定せずマップ上で
 * 揺れるので、決定的な貪欲法にする。同じ入力なら必ず同じ配置になる。
 */

export type LabelBox = {
  /** 対象の識別子 */
  id: string;
  /** ピンの位置（画像座標） */
  x: number;
  y: number;
  /** ラベルの幅・高さ（画像座標） */
  w: number;
  h: number;
};

/** 文字を置いてよい範囲（画像座標）。外に出ると端で切れる */
export type Bounds = { minY: number; maxY: number };

export type PlacedLabel = LabelBox & {
  /** ずらした後のラベル中心 */
  labelX: number;
  labelY: number;
  /** ピンからラベルまで線を引くか（大きくずれた時だけ） */
  needsLeader: boolean;
};

/** ピンの上に置くときの基準の隙間 */
const BASE_GAP = 30;
/** 1段ずらす量 */
const STEP = 26;
/** 何段まで試すか */
const MAX_STEPS = 8;

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return (
    Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h
  );
}

/**
 * 上に置く → 下に置く → 上に1段ずつ離す → 下に1段ずつ離す、の順に
 * 空いている場所を探す。見つからなければ最後の候補に置く。
 *
 * 入力は呼び出し側で安定した順（周回順）に並べておくこと。
 * 順番が変わると配置も変わるため。
 */
export function layoutLabels(boxes: LabelBox[], bounds?: Bounds): PlacedLabel[] {
  const placed: PlacedLabel[] = [];

  for (const box of boxes) {
    const candidates: { dx: number; dy: number }[] = [
      { dx: 0, dy: -BASE_GAP },
      { dx: 0, dy: BASE_GAP + box.h },
    ];
    for (let i = 1; i <= MAX_STEPS; i++) {
      candidates.push({ dx: 0, dy: -BASE_GAP - i * STEP });
      candidates.push({ dx: 0, dy: BASE_GAP + box.h + i * STEP });
    }

    // 表示範囲の外に出る候補は使わない。
    // 最前列（A列）のピンは真上に置くと画面の上端で文字が切れる。
    // 実際にそうなっていたので、範囲内のものを優先する。
    const inBounds = (dy: number): boolean => {
      if (!bounds) return true;
      const top = box.y + dy - box.h;
      const bottom = box.y + dy + box.h * 0.3;
      return top >= bounds.minY && bottom <= bounds.maxY;
    };
    const ordered = [...candidates.filter((c) => inBounds(c.dy)), ...candidates];

    let chosen = ordered[0]!;
    for (const cand of ordered) {
      const rect = { x: box.x + cand.dx, y: box.y + cand.dy, w: box.w, h: box.h };
      if (!placed.some((p) => overlaps(rect, { x: p.labelX, y: p.labelY, w: p.w, h: p.h }))) {
        chosen = cand;
        break;
      }
    }

    // 基準位置から2段以上離れたら、どのピンのラベルか分からなくなるので
    // 引き出し線を引く
    const needsLeader = Math.abs(chosen.dy) > BASE_GAP + box.h + STEP;

    placed.push({
      ...box,
      labelX: box.x + chosen.dx,
      labelY: box.y + chosen.dy,
      needsLeader,
    });
  }

  return placed;
}

/**
 * 文字数からラベルの幅を見積もる。
 * 日本語は全角なのでフォントサイズとほぼ同じ、英数字はその半分で数える。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const ch of text) {
    units += /[\x20-\x7e]/.test(ch) ? 0.55 : 1;
  }
  return units * fontSize;
}
