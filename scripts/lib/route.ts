/**
 * 周回ルートの並べ替え。
 *
 * 即売会の会場は「通路に沿った列」でできているので、
 * 最短経路探索（TSP）より蛇行順（serpentine）のほうが実際の歩き方に合う。
 * 列を順に回り、1列ごとに進行方向を反転させる。
 *
 * 列の順序と最初の向きは会場ごとに違う（入口の位置が逆）。
 * VENUE_META[venue].route に入れてある。
 */

import type { Venue } from './types';
import { VENUE_META } from './types';

export type RouteStop<T> = {
  item: T;
  boothId: string;
  line: string;
  boothNo: number;
  /** 1 起点の訪問順 */
  order: number;
};

export type RouteInput<T> = {
  item: T;
  boothId: string | null;
  line: string | null;
  boothNo: number | null;
};

/** ルートに載せられると確定した項目（null を絞り込んだ形） */
type Placed<T> = {
  item: T;
  boothId: string;
  line: string;
  boothNo: number;
};

/**
 * 蛇行順に並べる。
 *
 * - 列は venue の lineOrder 順
 * - 最初の列は startFromRight なら番号の大きい方から
 * - 以降の列は 1 列ごとに向きを反転する
 * - lineOrder に無い列やブース番号が無い項目は末尾にまとめる
 */
export function buildSerpentineRoute<T>(
  venue: Venue,
  items: RouteInput<T>[],
  overrides?: { lineOrder?: string[]; startFromRight?: boolean },
): { stops: RouteStop<T>[]; unplaced: T[] } {
  const cfg = VENUE_META[venue].route;
  const lineOrder = overrides?.lineOrder ?? cfg.lineOrder;
  const startFromRight = overrides?.startFromRight ?? cfg.startFromRight;

  const rank = new Map(lineOrder.map((l, i) => [l, i]));

  const placeable: Placed<T>[] = [];
  const unplaced: T[] = [];
  for (const it of items) {
    if (it.line && it.boothNo !== null && it.boothId && rank.has(it.line)) {
      placeable.push({
        item: it.item,
        boothId: it.boothId,
        line: it.line,
        boothNo: it.boothNo,
      });
    } else {
      unplaced.push(it.item);
    }
  }

  // 列ごとにまとめる
  const byLine = new Map<string, Placed<T>[]>();
  for (const p of placeable) {
    const arr = byLine.get(p.line) ?? [];
    arr.push(p);
    byLine.set(p.line, arr);
  }

  const stops: RouteStop<T>[] = [];
  // 実際に訪問先がある列だけを数えて向きを反転させる。
  // 空の列で向きが変わると、通路を無駄に往復する順番になってしまう。
  let visitedLineCount = 0;
  for (const line of lineOrder) {
    const arr = byLine.get(line);
    if (!arr || arr.length === 0) continue;
    const rightToLeft = startFromRight ? visitedLineCount % 2 === 0 : visitedLineCount % 2 === 1;
    arr.sort((a, b) => (rightToLeft ? b.boothNo - a.boothNo : a.boothNo - b.boothNo));
    for (const p of arr) {
      stops.push({
        item: p.item,
        boothId: p.boothId,
        line: p.line,
        boothNo: p.boothNo,
        order: stops.length + 1,
      });
    }
    visitedLineCount += 1;
  }

  return { stops, unplaced };
}

/**
 * 手動並べ替え（routeOrder）を優先して並べる。
 * routeOrder が未設定の項目は蛇行順の位置を保ったまま後ろに続く。
 */
export function applyManualOrder<T>(
  stops: RouteStop<T>[],
  orderOf: (item: T) => number | null,
): RouteStop<T>[] {
  const withManual: { stop: RouteStop<T>; manual: number }[] = [];
  const rest: RouteStop<T>[] = [];
  for (const s of stops) {
    const m = orderOf(s.item);
    if (m === null) rest.push(s);
    else withManual.push({ stop: s, manual: m });
  }
  withManual.sort((a, b) => a.manual - b.manual);
  return [...withManual.map((w) => w.stop), ...rest].map((s, i) => ({ ...s, order: i + 1 }));
}
