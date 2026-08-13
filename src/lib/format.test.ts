import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatDateTimeJst, formatEventDay } from './format';

test('投稿日時は実行環境のタイムゾーンに関わらず日本時間で出る', () => {
  // UTC の 2026-08-13T12:05:00Z は JST では 21:05
  assert.equal(formatDateTimeJst('2026-08-13T12:05:00.000Z'), '2026/8/13 21:05');
  // 日付が繰り上がる境界
  assert.equal(formatDateTimeJst('2026-08-13T15:30:00.000Z'), '2026/8/14 00:30');
});

test('壊れた日時はそのまま返す（落とさない）', () => {
  assert.equal(formatDateTimeJst('not a date'), 'not a date');
});

test('会期の日付は曜日つきで出る', () => {
  assert.equal(formatEventDay('2026-08-14'), '8/14(金)');
  assert.equal(formatEventDay('2026-08-15'), '8/15(土)');
  assert.equal(formatEventDay('2026-08-16'), '8/16(日)');
  assert.equal(formatEventDay('2026-08-28'), '8/28(金)');
});

test('想定外の形式はそのまま返す', () => {
  assert.equal(formatEventDay('2026/08/14'), '2026/08/14');
});
