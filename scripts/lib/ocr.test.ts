import assert from 'node:assert/strict';
import { test } from 'node:test';

import { countPrices } from './ocr';

test('価格表記を数える', () => {
  assert.equal(countPrices('CD ¥2,000'), 1);
  assert.equal(countPrices('CD ¥2,000\nアクスタ ¥1,500\n缶バッジ ¥400'), 3);
  assert.equal(countPrices('新譜 2000円 / 旧譜 1500円'), 2);
  assert.equal(countPrices('全角 ￥2000'), 1);
});

test('OCR が円記号を読み違えても拾う', () => {
  // ¥ が Y や全角Ｙ に化けることがある
  assert.equal(countPrices('CD Y2,000 アクキー Ｙ800'), 2);
});

test('年号や曲数を価格と誤認しない', () => {
  assert.equal(countPrices('マジカルミライ2026 クリエイターズマーケット'), 0);
  assert.equal(countPrices('全12曲入り 2026年発売'), 0);
  assert.equal(countPrices('浜松 A-5 大阪 D-6 東京 C-18'), 0);
  assert.equal(countPrices('7/24-26 8/14-16 8/28-30'), 0);
});

test('同じ位置の価格を二重に数えない', () => {
  // 「¥2,000円」のように両方の書き方が重なっても1件
  const n = countPrices('¥2,000');
  assert.equal(n, 1);
});

test('価格が無い画像は0件', () => {
  assert.equal(countPrices('設営完了しました！ A-9 でお待ちしてます'), 0);
  assert.equal(countPrices(''), 0);
});
