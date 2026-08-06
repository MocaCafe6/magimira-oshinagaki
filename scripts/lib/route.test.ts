import assert from 'node:assert/strict';
import { test } from 'node:test';

import { applyManualOrder, buildSerpentineRoute, type RouteInput } from './route';

function booth(boothId: string): RouteInput<string> {
  const m = /^([A-Z])-(\d+)$/.exec(boothId);
  return {
    item: boothId,
    boothId,
    line: m ? m[1]! : null,
    boothNo: m ? Number(m[2]) : null,
  };
}

const ids = (r: { stops: { item: string }[] }) => r.stops.map((s) => s.item);

test('大阪は入口(右下)から G列→A列 の蛇行順になる', () => {
  const r = buildSerpentineRoute('osaka', [
    booth('A-1'),
    booth('A-5'),
    booth('G-2'),
    booth('G-10'),
    booth('F-3'),
    booth('F-7'),
  ]);
  // G列は右(番号大)から、F列は反転して左(番号小)から、A列はまた右から
  assert.deepEqual(ids(r), ['G-10', 'G-2', 'F-3', 'F-7', 'A-5', 'A-1']);
});

test('東京は入口(右上)から A列→D列 の蛇行順になる', () => {
  const r = buildSerpentineRoute('tokyo', [
    booth('A-2'),
    booth('A-28'),
    booth('B-1'),
    booth('B-30'),
    booth('D-5'),
  ]);
  // A列は右から、B列は左から、C列は無いので D列は右から
  assert.deepEqual(ids(r), ['A-28', 'A-2', 'B-1', 'B-30', 'D-5']);
});

test('訪問先が無い列は向きの反転に数えない', () => {
  // G列とE列だけ回る場合。F列が空なので E列は「2列目」として扱う。
  // 空の列で向きが変わると通路を無駄に往復することになる。
  const r = buildSerpentineRoute('osaka', [
    booth('G-1'),
    booth('G-13'),
    booth('E-2'),
    booth('E-9'),
  ]);
  assert.deepEqual(ids(r), ['G-13', 'G-1', 'E-2', 'E-9']);
});

test('1列だけなら入口側から一方向に回る', () => {
  const r = buildSerpentineRoute('osaka', [booth('C-1'), booth('C-7'), booth('C-12')]);
  assert.deepEqual(ids(r), ['C-12', 'C-7', 'C-1']);
});

test('order は 1 起点の連番になる', () => {
  const r = buildSerpentineRoute('osaka', [booth('G-1'), booth('F-1'), booth('A-1')]);
  assert.deepEqual(
    r.stops.map((s) => s.order),
    [1, 2, 3],
  );
});

test('ブース番号を持たない項目は unplaced に分ける', () => {
  const r = buildSerpentineRoute('osaka', [
    booth('G-1'),
    { item: '企業ブース', boothId: null, line: null, boothNo: null },
    { item: 'ガチャ', boothId: 'ガチャ', line: null, boothNo: null },
  ]);
  assert.deepEqual(ids(r), ['G-1']);
  assert.deepEqual(r.unplaced.sort(), ['ガチャ', '企業ブース']);
});

test('会場の列に無い記号は unplaced に回す', () => {
  // 東京に G列は無い
  const r = buildSerpentineRoute('tokyo', [booth('A-1'), booth('G-1')]);
  assert.deepEqual(ids(r), ['A-1']);
  assert.deepEqual(r.unplaced, ['G-1']);
});

test('向きは overrides で上書きできる', () => {
  const r = buildSerpentineRoute('osaka', [booth('G-1'), booth('G-5')], {
    startFromRight: false,
  });
  assert.deepEqual(ids(r), ['G-1', 'G-5']);
});

test('列順も overrides で上書きできる', () => {
  const r = buildSerpentineRoute('osaka', [booth('A-1'), booth('G-1')], {
    lineOrder: ['A', 'G'],
    startFromRight: false,
  });
  assert.deepEqual(ids(r), ['A-1', 'G-1']);
});

test('手動並べ替えを優先し、未設定は蛇行順のまま後に続く', () => {
  const r = buildSerpentineRoute('osaka', [
    booth('G-1'),
    booth('G-5'),
    booth('A-1'),
    booth('A-3'),
  ]);
  // G列を右→左に歩き終えると左端にいるので、次の列は左→右に歩く
  assert.deepEqual(ids(r), ['G-5', 'G-1', 'A-1', 'A-3']);

  // A-1 を先頭に、G-1 を2番目に手動指定する
  const manual = new Map<string, number>([
    ['A-1', 1],
    ['G-1', 2],
  ]);
  const reordered = applyManualOrder(r.stops, (item) => manual.get(item) ?? null);
  assert.deepEqual(
    reordered.map((s) => s.item),
    ['A-1', 'G-1', 'G-5', 'A-3'],
  );
  assert.deepEqual(
    reordered.map((s) => s.order),
    [1, 2, 3, 4],
  );
});
