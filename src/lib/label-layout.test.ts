import assert from 'node:assert/strict';
import { test } from 'node:test';

import { estimateTextWidth, layoutLabels, type LabelBox } from './label-layout';

function boxesOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

test('離れたピンのラベルはそのまま真上に置く', () => {
  const boxes: LabelBox[] = [
    { id: 'a', x: 100, y: 100, w: 120, h: 24 },
    { id: 'b', x: 600, y: 600, w: 120, h: 24 },
  ];
  const placed = layoutLabels(boxes);
  assert.equal(placed[0]!.labelX, 100);
  assert.ok(placed[0]!.labelY < 100, 'ピンより上に置く');
  assert.equal(placed[0]!.needsLeader, false);
  assert.equal(placed[1]!.needsLeader, false);
});

test('同じ場所に重なるピンのラベルは重ならないようにずらす', () => {
  // 隣り合うブースを両方お気に入りにすると起きる状況
  const boxes: LabelBox[] = [
    { id: 'a', x: 300, y: 300, w: 200, h: 24 },
    { id: 'b', x: 305, y: 302, w: 200, h: 24 },
    { id: 'c', x: 310, y: 298, w: 200, h: 24 },
  ];
  const placed = layoutLabels(boxes);
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i]!;
      const b = placed[j]!;
      assert.ok(
        !boxesOverlap(
          { x: a.labelX, y: a.labelY, w: a.w, h: a.h },
          { x: b.labelX, y: b.labelY, w: b.w, h: b.h },
        ),
        `${a.id} と ${b.id} のラベルが重なっている`,
      );
    }
  }
});

test('同じ入力なら必ず同じ配置になる（マップ上で揺れない）', () => {
  const boxes: LabelBox[] = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i}`,
    x: 200 + (i % 4) * 12,
    y: 200 + Math.floor(i / 4) * 10,
    w: 180,
    h: 24,
  }));
  const a = layoutLabels(boxes);
  const b = layoutLabels(boxes);
  assert.deepEqual(a, b);
});

test('大きくずれたものには引き出し線を立てる', () => {
  const boxes: LabelBox[] = Array.from({ length: 6 }, (_, i) => ({
    id: `p${i}`,
    x: 400,
    y: 400 + i, // ほぼ同じ場所
    w: 200,
    h: 24,
  }));
  const placed = layoutLabels(boxes);
  assert.ok(placed.some((p) => p.needsLeader), '離れたラベルには線が必要');
});

test('表示範囲の上端では下側に置く（端で文字が切れないように）', () => {
  // 最前列（A列）のピン。真上に置くと画面外に出て名前が半分消えていた。
  const placed = layoutLabels([{ id: 'a', x: 300, y: 60, w: 200, h: 30 }], {
    minY: 30,
    maxY: 900,
  });
  assert.ok(placed[0]!.labelY > 60, `下に置くべきだが ${placed[0]!.labelY} になった`);
});

test('範囲に収まるならこれまでどおり上に置く', () => {
  const placed = layoutLabels([{ id: 'a', x: 300, y: 500, w: 200, h: 30 }], {
    minY: 30,
    maxY: 900,
  });
  assert.ok(placed[0]!.labelY < 500);
});

test('範囲を渡さなければ従来の挙動', () => {
  const placed = layoutLabels([{ id: 'a', x: 300, y: 60, w: 200, h: 30 }]);
  assert.ok(placed[0]!.labelY < 60);
});

test('幅の見積もりは全角と半角を区別する', () => {
  assert.equal(estimateTextWidth('あいう', 20), 60);
  assert.ok(estimateTextWidth('abc', 20) < estimateTextWidth('あいう', 20));
});
