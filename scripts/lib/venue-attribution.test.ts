import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  attributeFromText,
  imageBoundVenues,
  normalizeBooth,
  scanMarkers,
  segmentByVenue,
  type OfficialEntry,
} from './venue-attribution';

const OSAKA_DAYS = ['2026-08-14', '2026-08-15', '2026-08-16'];
const TOKYO_DAYS = ['2026-08-28', '2026-08-29', '2026-08-30'];
const HAMA_DAYS = ['2026-07-24', '2026-07-25', '2026-07-26'];

function official(
  spec: Partial<Record<'hamamatsu' | 'osaka' | 'tokyo', string | null>>,
): OfficialEntry[] {
  const out: OfficialEntry[] = [];
  if ('hamamatsu' in spec)
    out.push({ venue: 'hamamatsu', boothId: spec.hamamatsu ?? null, days: HAMA_DAYS });
  if ('osaka' in spec) out.push({ venue: 'osaka', boothId: spec.osaka ?? null, days: OSAKA_DAYS });
  if ('tokyo' in spec) out.push({ venue: 'tokyo', boothId: spec.tokyo ?? null, days: TOKYO_DAYS });
  return out;
}

// ---------------------------------------------------------------------------
// 正規化
// ---------------------------------------------------------------------------

test('ブース番号の表記ゆれを正規化する', () => {
  for (const s of ['A-1', 'A1', 'A-01', 'a-1', 'Ａ－１', 'A - 1']) {
    assert.equal(normalizeBooth(s), 'A-1', `失敗: ${s}`);
  }
  assert.equal(normalizeBooth('D-06'), 'D-6');
  assert.equal(normalizeBooth('C-28'), 'C-28');
  assert.equal(normalizeBooth('ガチャ'), null);
});

test('日付や価格をブース番号と誤認しない', () => {
  const m = scanMarkers('7/26(日) に頒布 2000円 8月15日');
  const booths = m.filter((x) => x.kind === 'booth');
  assert.deepEqual(booths, [], `誤検出: ${JSON.stringify(booths)}`);
});

// ---------------------------------------------------------------------------
// 会場ごとの区切り（実データの書き方）
// ---------------------------------------------------------------------------

test('「浜松【B-6】 東京【C-19】」を会場ごとに分ける', () => {
  const { segments } = segmentByVenue('「アオワイファイSPOT」 浜松【B-6】 東京【C-19】');
  assert.deepEqual(
    segments.map((s) => [s.venue, s.booths]),
    [
      ['hamamatsu', ['B-6']],
      ['tokyo', ['C-19']],
    ],
  );
});

test('「大阪：8/14~8/16 場所【G-5】 東京：8/29~8/30 場所【C-26】」を分ける', () => {
  const { segments } = segmentByVenue(
    'クリエイターズマーケット 大阪：8/14~8/16 場所【G-5】 東京：8/29~8/30 場所【C-26】',
  );
  const osaka = segments.find((s) => s.venue === 'osaka')!;
  const tokyo = segments.find((s) => s.venue === 'tokyo')!;
  assert.deepEqual(osaka.booths, ['G-5']);
  assert.deepEqual(tokyo.booths, ['C-26']);
  assert.ok(osaka.dates.some((d) => d.month === 8 && d.day === 14));
  assert.ok(tokyo.dates.some((d) => d.month === 8 && d.day === 29));
});

test('「浜松 7/26 のみ C-10  大阪 8/15.16 G-13」を分ける', () => {
  const { segments } = segmentByVenue(
    'ホシゾラ列車【三日月線】 浜松  7/26(日) のみ  "C-10" 大阪  8/15.16(土日)  "G-13"',
  );
  assert.deepEqual(segments.find((s) => s.venue === 'hamamatsu')!.booths, ['C-10']);
  assert.deepEqual(segments.find((s) => s.venue === 'osaka')!.booths, ['G-13']);
});

// ---------------------------------------------------------------------------
// 帰属の確定
// ---------------------------------------------------------------------------

test('浜松だけのお品書きは確定せず、公開されない', () => {
  // 実データ: 「先駆けてマジカルミライ2026浜松のお品書きうpしておきます … 24~26 C-1」
  const r = attributeFromText({
    text: '先駆けてマジカルミライ2026浜松のお品書きうpしておきます\n24~26 C-1に遊びに来て下さい',
    handle: 'nulut',
    official: official({ hamamatsu: 'C-1', osaka: 'A-1' }),
  });
  assert.deepEqual(r.provenVenues, [], `evidence=${r.evidence.join(' / ')}`);
  assert.equal(r.source, 'unresolved');
  assert.ok(r.otherVenues.includes('hamamatsu'));
});

test('東京専用のお品書きは東京だけに確定する（大阪ページには出さない）', () => {
  // 実データ: 「マジカルミライ2026 東京【B-27】お品書き（第1弾）」
  const r = attributeFromText({
    text: 'マジカルミライ2026 東京【B-27】お品書き（第1弾）',
    handle: 'x',
    official: official({ osaka: 'D-3', tokyo: 'B-27' }),
  });
  assert.deepEqual(r.provenVenues, ['tokyo']);
  assert.equal(r.source, 'text-booth');
});

test('複数会場のお品書きは対象会場すべてに確定する', () => {
  // 実データ: 「浜松 A-05 大阪 D-06 東京 C-18」
  const r = attributeFromText({
    text: '【おしながき】 クリエイターズマーケット 浜松 A-05 大阪 D-06 東京 C-18 「錦市場」のおしながきです！',
    handle: 'nishikikn',
    official: official({ hamamatsu: 'A-5', osaka: 'D-6', tokyo: 'C-18' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka', 'tokyo']);
  assert.equal(r.source, 'text-booth');
});

test('本文のブース番号が公式と食い違うときは確定しない', () => {
  // 他人のブースを紹介している、書き間違いなどの可能性がある
  const r = attributeFromText({
    text: 'マジミラ大阪 B-99 に遊びに行きます',
    handle: 'x',
    official: official({ osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, []);
  assert.ok(r.evidence.some((e) => e.includes('一致しない')));
});

test('会場名だけ（ブース番号なし）では確定しない', () => {
  // 会場名は未来の予定・近況報告・在庫の話にも出てくるので証明にならない。
  // 実データで「マジミラ浜松ありがとう！次は大阪でお待ちしてます」が
  // 大阪のお品書きとして公開されていた。
  const r = attributeFromText({
    text: 'マジミラ大阪のお品書きです！よろしくお願いします',
    handle: 'x',
    official: official({ hamamatsu: 'A-1', osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, []);
  assert.ok(r.evidence.some((e) => e.includes('ブース番号が無いため確定しない')));
});

test('お礼の投稿で次の会場に触れていても確定しない', () => {
  for (const text of [
    'マジミラ浜松ありがとうございました！ 次は大阪でお待ちしてます',
    '#マジミラ浜松 ありがとうございました！ 次のマジミラは東京3日目に参戦します',
  ]) {
    const r = attributeFromText({
      text,
      handle: 'x',
      official: official({ hamamatsu: 'A-1', osaka: 'D-3', tokyo: 'C-5' }),
    });
    assert.deepEqual(r.provenVenues, [], `確定してしまっている: ${text}`);
  }
});

test('会場名に加えてブース番号が公式と一致すれば確定する', () => {
  const r = attributeFromText({
    text: 'マジミラ大阪 D-3 のお品書きです！',
    handle: 'x',
    official: official({ hamamatsu: 'A-1', osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.equal(r.source, 'text-booth');
});

test('日付が書かれていればその日だけに絞る', () => {
  const r = attributeFromText({
    text: 'マジミラ大阪 8/15(土) と 8/16(日) は D-3 にいます',
    handle: 'x',
    official: official({ osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.deepEqual(r.daysByVenue.osaka, ['2026-08-15', '2026-08-16']);
});

test('他会場の日付は絞り込みに使わない', () => {
  // 浜松の 7/26 が大阪の絞り込みに漏れないこと
  const r = attributeFromText({
    text: '浜松 7/26 C-1 / 大阪 D-3',
    handle: 'x',
    official: official({ hamamatsu: 'C-1', osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.equal(r.daysByVenue.osaka, undefined, '日付の絞り込みは発生しないはず');
});

test('会場名が無くても公式ブース番号が一意なら確定する', () => {
  const r = attributeFromText({
    text: 'クリエイターズマーケットのお品書きです。ブースは D-6 です',
    handle: 'x',
    official: official({ hamamatsu: 'A-5', osaka: 'D-6', tokyo: 'C-18' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.equal(r.source, 'text-booth');
});

test('複数会場で同じブース番号なら曖昧として確定しない', () => {
  const r = attributeFromText({
    text: 'お品書きです。C-8 でお待ちしています',
    handle: 'x',
    official: official({ hamamatsu: 'C-8', osaka: 'C-8' }),
  });
  assert.deepEqual(r.provenVenues, []);
  assert.ok(r.evidence.some((e) => e.includes('特定できない')));
});

test('1会場にしか出ていない作者は消去法で確定する', () => {
  const r = attributeFromText({
    text: 'クリエイターズマーケットのお品書きです',
    handle: 'x',
    official: official({ osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.equal(r.source, 'sole-venue');
});

test('消去法は本文が他会場に言及していたら使わない', () => {
  const r = attributeFromText({
    text: '浜松ではお世話になりました。お品書きです',
    handle: 'x',
    official: official({ osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('浜松にしか出ていない作者は確定しない（対象外）', () => {
  const r = attributeFromText({
    text: 'クリエイターズマーケットのお品書きです',
    handle: 'x',
    official: official({ hamamatsu: 'A-1' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('会場名もブース番号も無く複数会場に出ている作者は確定しない', () => {
  // ここが「画像から読み取る」層に回るケース
  const r = attributeFromText({
    text: 'Mini Album 「Special Tea」 マジカルミライ2026クリエイターズマーケットで頒布します',
    handle: 'shinra_logic',
    official: official({ osaka: 'B-5', tokyo: 'C-9' }),
  });
  assert.deepEqual(r.provenVenues, []);
  assert.equal(r.source, 'unresolved');
});

test('全角のブース番号でも公式と照合できる', () => {
  const r = attributeFromText({
    text: 'マジミラ大阪　Ｄ－０６ でお待ちしています',
    handle: 'x',
    official: official({ osaka: 'D-6' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
});

test('同じ会場が本文の離れた位置に出てもまとめて扱う', () => {
  const r = attributeFromText({
    text: '大阪に参加します。詳細は後日。大阪は D-6 です。',
    handle: 'x',
    official: official({ osaka: 'D-6' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.equal(r.source, 'text-booth');
});

// ---------------------------------------------------------------------------
// 画像がどの会場のお品書きか
// ---------------------------------------------------------------------------

test('「◯◯のお品書き」で画像の会場を読み取る', () => {
  assert.deepEqual(imageBoundVenues('まずは浜松のお品書き👇'), ['hamamatsu']);
  assert.deepEqual(imageBoundVenues('マジカルミライ2026 東京【B-27】お品書き（第1弾）'), ['tokyo']);
  assert.deepEqual(imageBoundVenues('大阪 8/15(土) のお品書きです'), ['osaka']);
  // サークル名にかかっている「の」は紐づけと見なさない
  assert.deepEqual(imageBoundVenues('浜松 A-05 大阪 D-06 東京 C-18 「錦市場」のおしながきです'), []);
  assert.deepEqual(imageBoundVenues('クリエイターズマーケットのお品書きです'), []);
  // 会場名が続くときは両方に紐づく。片方だけ拾うと、もう片方の会場ページで
  // 「別会場のお品書き」と誤判定してしまう
  assert.deepEqual(imageBoundVenues('#マジカルミライ2026 の大阪東京のお品書きです'), [
    'osaka',
    'tokyo',
  ]);
  assert.deepEqual(imageBoundVenues('浜松・大阪・東京のお品書きです'), [
    'hamamatsu',
    'osaka',
    'tokyo',
  ]);
});

test('画像が浜松のお品書きなら、東京が確定していても東京には載せない', () => {
  // 実データ: 東京 A-26 は正しいが、貼られている画像は浜松のお品書き
  const r = attributeFromText({
    text:
      '☕️クリエイターズマーケットお品書き☕️\n\n浜松 : 7/26(日) C-2\n東京 : 8/29(土),30(日) A-26\n\nまずは浜松のお品書き👇',
    handle: 'x',
    official: official({ hamamatsu: 'C-2', tokyo: 'A-26' }),
  });
  assert.deepEqual(r.provenVenues, [], `evidence=${r.evidence.join(' / ')}`);
  assert.ok(r.evidence.some((e) => e.includes('浜松のお品書き')));
});

test('画像が対象会場のお品書きなら確定は保たれる', () => {
  const r = attributeFromText({
    text: '浜松 C-2 / 東京 A-26\n東京のお品書きです👇',
    handle: 'x',
    official: official({ hamamatsu: 'C-2', tokyo: 'A-26' }),
  });
  assert.deepEqual(r.provenVenues, ['tokyo']);
});

test('判定根拠が必ず残る（レビューで理由を確認できる）', () => {
  const r = attributeFromText({
    text: '浜松のお品書き',
    handle: 'x',
    official: official({ hamamatsu: 'A-1', osaka: 'B-2' }),
  });
  assert.ok(r.evidence.length > 0);
});
