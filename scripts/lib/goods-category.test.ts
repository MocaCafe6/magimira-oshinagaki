import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectGoodsCategories } from './goods-category';

test('実データのお品書きから種類を拾う', () => {
  // アカサキサギリ 大阪B-8
  const a = detectGoodsCategories(
    'Re:Collection 2008-2026 ¥1,500 / こんにちはアカサキサギリです ¥1,500 / ' +
      'めじるしチャーム ミク/リン ¥600 / アクリルキーホルダー サギリちゃん ¥800 / ' +
      'CD1枚ご購入につき対応絵柄のトレカ1枚プレゼント',
  );
  assert.ok(a.includes('cd'));
  assert.ok(a.includes('acrylic'));
  assert.ok(a.includes('accessory'));
  assert.ok(a.includes('card'));

  // 幽霊一文字 大阪A-9
  const b = detectGoodsCategories(
    'EP 万々災 ¥1,000 / Goods 一寸拍子 アクリルキーホルダー(セット) ¥500 / ' +
      'Single 一寸拍子 ¥500 / 2nd Album 冥府新都心 ¥2,000',
  );
  assert.ok(b.includes('cd'));
  assert.ok(b.includes('acrylic'));

  // 家の裏でマンボウが死んでるP
  const c = detectGoodsCategories(
    'お品書き 浜松B-2 大阪G-6 東京B-5 『面白いアルバム』¥2000 2年ぶりの新譜 / ' +
      '小説版『粘着系男子の15年ネチネチ』¥1200',
  );
  assert.ok(c.includes('cd'));
  assert.ok(c.includes('book'));
});

test('表記ゆれを吸収する', () => {
  for (const t of ['アクキー', 'アクリルキーホルダー', 'アクスタ', 'アクリルスタンド']) {
    assert.ok(detectGoodsCategories(t).includes('acrylic'), t);
  }
  for (const t of ['缶バッジ', 'カンバッジ', 'ピンバッジ']) {
    assert.ok(detectGoodsCategories(t).includes('badge'), t);
  }
  for (const t of ['CD', 'ＣＤ', '新譜', 'アルバム', 'SONOCA', 'カセットテープ']) {
    assert.ok(detectGoodsCategories(t).includes('cd'), t);
  }
});

test('企業ブースの品目も拾う', () => {
  const gift = detectGoodsCategories(
    'Gift MAGICAL MIRAI 2026 ITEM LIST 初音ミク マジカルミライ2026 ぬいぐるみ イベント価格7,000円',
  );
  assert.deepEqual(gift, ['plush']);

  const gsc = detectGoodsCategories(
    'GOOD SMILE COMPANY 販売商品 ねんどろいど初音ミク ¥8,000 HELLO! GOOD SMILE Charm ¥1,300',
  );
  assert.ok(gsc.includes('plush')); // ねんどろいど・フィギュア
  assert.ok(gsc.includes('accessory')); // Charm

  const kanade = detectGoodsCategories(
    '奏の森Resorts 出展情報 フランネルブランケット ¥8,800 缶バッジ ¥500 オリジナルスパイス ねぎ塩 ¥880',
  );
  assert.ok(kanade.includes('badge'));
  assert.ok(kanade.includes('food'));
});

test('手掛かりが無ければ other にして絞り込みから消さない', () => {
  assert.deepEqual(detectGoodsCategories(''), ['other']);
  assert.deepEqual(detectGoodsCategories(null, undefined), ['other']);
  assert.deepEqual(detectGoodsCategories('よろしくお願いします'), ['other']);
});

test('複数の情報源をまとめて見る（本文＋代替テキスト＋OCR）', () => {
  const cats = detectGoodsCategories('お品書きです', 'Tシャツの写真', 'ステッカー ¥300');
  assert.ok(cats.includes('apparel'));
  assert.ok(cats.includes('sticker'));
});
