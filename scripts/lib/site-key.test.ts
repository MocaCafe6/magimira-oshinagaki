import assert from 'node:assert/strict';
import { test } from 'node:test';

import { baseHost, siteKey } from './site-key';

test('自社ドメインはホスト名まで見れば足りる（パスの深さは無関係）', () => {
  assert.equal(siteKey('https://www.taito.co.jp/'), 'taito.co.jp');
  assert.equal(siteKey('https://www.taito.co.jp/product/detail/123'), 'taito.co.jp');
  assert.equal(siteKey('https://segaplaza.jp/lp/hatsunemiku/'), 'segaplaza.jp');
});

test('サブドメインが違っても同じ会社とみなす', () => {
  assert.equal(siteKey('https://jp.yamaha.com/products/'), siteKey('https://www.yamaha.com/'));
  assert.equal(baseHost('sp.wmg.jp'), 'wmg.jp');
});

test('共有ドメインはパスまで見ないと別人を拾う', () => {
  // 実際に誤検出した組み合わせ。
  // 公式は和田たけあき、拾ったのは橘あきのアカウントだった。
  const official = siteKey('https://lit.link/wadatakeaki');
  const other = siteKey('https://lit.link/akitatchi');
  assert.notEqual(official, other);
  assert.equal(official, 'lit.link/wadatakeaki');
});

test('KARENT はアーティストIDまで見る', () => {
  assert.equal(siteKey('https://karent.jp/artist/pp000812'), 'karent.jp/artist/pp000812');
  assert.notEqual(
    siteKey('https://karent.jp/artist/pp000812'),
    siteKey('https://karent.jp/artist/pp000321'),
  );
});

test('BOOTH・STORES・note も持ち主ごとに分ける', () => {
  assert.notEqual(siteKey('https://mayuro.booth.pm/'), siteKey('https://other.booth.pm/'));
  assert.notEqual(siteKey('https://itarack.stores.jp/'), siteKey('https://foo.stores.jp/'));
  assert.notEqual(siteKey('https://note.com/aaa'), siteKey('https://note.com/bbb'));
});

test('URLとして壊れているものは null', () => {
  assert.equal(siteKey('not a url'), null);
  assert.equal(siteKey(''), null);
});

test('スキーム無しでも読める（Xのプロフィール欄はドメインだけ表示される）', () => {
  assert.equal(siteKey('lit.link/wadatakeaki'), 'lit.link/wadatakeaki');
  assert.equal(siteKey('taito.co.jp'), 'taito.co.jp');
});
