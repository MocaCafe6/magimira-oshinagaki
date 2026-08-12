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

test('会場名があり公式にも出展していれば、ブース番号が無くても確定する', () => {
  // 実データ: 「マジカルミライ2026 OSAKA・TOKYO会場にて先行販売する新商品を公開」
  // のように、会場名は書くがブース番号を一度も書かないサークルがある（企業ブースに多い）。
  // 番号を必須にすると構造的に拾えない。
  const r = attributeFromText({
    text: 'マジミラ大阪のお品書きです！よろしくお願いします',
    handle: 'x',
    official: official({ hamamatsu: 'A-1', osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
  assert.equal(r.source, 'text-venue');
});

test('URL やハンドル名に含まれる地名は会場と見なさない', () => {
  // 実データ: 浜松の販売実況が東京のページに出ていた。
  // ドメイン "shop.ozakka.tokyo" とハンドル "OZaKKa_tokyo" の tokyo を拾っていた。
  const r = attributeFromText({
    text:
      '＼ #マジカルミライ2026 HAMAMATSU 完売情報／ 【B5】ピアプロキャラクターズ×OZaKKa\n' +
      '＼ OZaKKa公式通販サイトもご確認ください／ ▽ http://shop.ozakka.tokyo',
    handle: 'OZaKKa_tokyo',
    official: official({ hamamatsu: 'B-5', osaka: 'C-6', tokyo: 'A-8' }),
  });
  assert.deepEqual(r.provenVenues, [], `evidence=${r.evidence.join(' / ')}`);
  assert.ok(r.otherVenues.includes('hamamatsu'));
});

test('@メンションの地名も会場と見なさない', () => {
  const r = attributeFromText({
    text: 'マジカルミライ2026 浜松のお品書きです @tokyo_circle さんと合同です',
    handle: 'x',
    official: official({ hamamatsu: 'A-1', tokyo: 'B-2' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('他イベントの名前があるときは会場名だけでは確定しない', () => {
  // 実データ: 「7/25(土)東京 #ボーマス63 7/26(日)浜松 #マジカルミライ2026 のお品書き」
  // この「東京」はボーマスの開催地であって、マジミラ東京ではない。
  const r = attributeFromText({
    text: '7/25（土）東京 #ボーマス63 7/26（日）浜松 #マジカルミライ2026 サークル参加のお品書きです！',
    handle: 'x',
    official: official({ hamamatsu: 'C-6', osaka: 'F-11', tokyo: 'C-12' }),
  });
  assert.deepEqual(r.provenVenues, [], `evidence=${r.evidence.join(' / ')}`);
  assert.ok(r.evidence.some((e) => e.includes('他イベント')));
});

test('お礼の投稿は会場が確定しても、お品書きでないので掲載されない', () => {
  // 会場名としては拾われるが、掲載可否は curation の isOshinagakiPost が持つ。
  // ここでは「会場の判定」と「お品書きかの判定」を分けていることを確認する。
  const r = attributeFromText({
    text: 'マジミラ浜松ありがとうございました！ 次は大阪でお待ちしてます',
    handle: 'x',
    official: official({ hamamatsu: 'A-1', osaka: 'D-3' }),
  });
  // 会場としては大阪が立つ
  assert.deepEqual(r.provenVenues, ['osaka']);
  // 浜松は他会場として記録される
  assert.ok(r.otherVenues.includes('hamamatsu'));
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

test('浜松に触れていたら、公式に大阪しか記録が無くても確定しない', () => {
  // 以前はここで大阪と確定させていた。「その作者は大阪にしか出ていないの
  // だから、浜松への言及は過去の話にすぎない」という理屈だった。
  //
  // これは公式データが完全であることに依存していて、実際は完全ではない。
  // 浜松のページで X リンクが載っているのは111件中76件しかない。
  // 浜松にも出ていたのに X リンクが無いサークルは、こちらから見ると
  // 「大阪にしか出ていない」に見える。そこへ消去法を当てると、
  // 浜松のお品書きを大阪のページに載せてしまう。
  //
  // 大阪のお品書きなら本文に「大阪」と書かれるか、後日そう書いた投稿が来る。
  // 推論で埋めない。
  const r = attributeFromText({
    text: '浜松ではお世話になりました。お品書きです',
    handle: 'x',
    official: official({ osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('浜松に礼を言いつつ大阪を名指ししていれば大阪と確定する', () => {
  // 上を厳しくしても、実際に多いこの形は拾える。
  const r = attributeFromText({
    text: '浜松ありがとうございました！次は大阪です。お品書きはこちら',
    handle: 'x',
    official: official({ hamamatsu: 'A-13', osaka: 'D-3' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka']);
});

test('浜松に言及していれば全会場には広げない', () => {
  // 「浜松限定」「浜松のお品書き」といった例外パターンを並べる方式は
  // 破綻した（下の4件はどれもすり抜けて大阪・東京の両ページに出ていた）。
  // 会場名を一つでも書いているなら全体告知ではない、が唯一の規則。
  for (const text of [
    '#マジカルミライ2026 浜松 お品書きです！', // 浜松とお品書きが結びついている
    'マジカルミライ2026 浜松 A-13 で頒布します', // 浜松のブース番号がある
    // 実データ: 「浜松限定グラスクロス」が大阪・東京に出ていた
    '【マジカルミライ2026グッズ情報】浜松限定グラスクロス👓 価格：1,100円（税込）',
    // 実データ: 会期中の実況が大阪・東京に出ていた
    '＼ #マジカルミライ2026 HAMAMATSU 販売情報／ 肩乗りぬいぐるみショルダーパッド 初音ミク',
    // 以下4件は実データ。verify-attribution が担保違反として検出した
    // 「浜松会場限定」— 会場 が挟まるので /浜松\s*限定/ に当たらなかった
    '#初音ミク「#マジカルミライ2026」和真パレットブースのお品書きを公開！' +
      ' 新商品 PCメガネ「MIKU-010」 グラスクロスは浜松会場限定イラストをご用意！',
    '／ #初音ミク「#マジカルミライ 2026」HAMAMATSU 追加情報📢 ＼' +
      ' 1⃣物販に先行販売アイテムが追加！ 2⃣ブース内で会場限定キャンペーンを実施！',
    'マジミラ浜松最終日のある朝 やみくろさんはズマケにいます お品書き詳細は固定ポストをご確認下さい！',
    // 「3会場すべての新譜情報」とも読めるが、読めるだけで証明はできない
    '【鬱P新譜情報】マジカルミライクリエイターズマーケットにて2年ぶりの新譜カセットテープ' +
      '「H.M.1996」を頒布します。1000円です。🚨浜松は26日(日)のみなので要注意！',
  ]) {
    const r = attributeFromText({
      text,
      handle: 'x',
      official: official({ hamamatsu: 'A-13', osaka: 'D-3', tokyo: 'C-5' }),
    });
    assert.deepEqual(r.provenVenues, [], `全会場に広げてしまっている: ${text}`);
  }
});

test('別ツアーの公演地リストの中の地名は会場と読まない', () => {
  // 実データ: 浜松のブースからの実況。「東京」は初音ミクシンフォニーの
  // 公演地であって、マジカルミライ東京会場ではない。
  // これを会場と読んだせいで、浜松の投稿が東京のページに出ていた。
  const r = attributeFromText({
    text:
      '「マジカルミライ 2026」浜松最終日 初音ミクシンフォニーブース出展中' +
      ' 初音ミクシンフォニー2026札幌、東京公演公式グッズを販売',
    handle: 'x',
    official: official({ hamamatsu: 'A-5', osaka: 'B-6', tokyo: 'A-7' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('ホール名に続く地名は会場と読まない', () => {
  // 実データ: CDのタイトルがそのまま本文に入っている。
  //   『初音ミクシンフォニー2026 at Concert Hall Kitara, Sapporo & Suntory Hall, Tokyo』
  // この Tokyo はサントリーホールの所在地。浜松のブースからの実況が
  // 東京のページに出ていた原因。
  const r = attributeFromText({
    text:
      '「マジカルミライ 2026」本日浜松1日目 初音ミクシンフォニーブース出展しています' +
      ' 2026.10.7(wed)Release‼︎『初音ミクシンフォニー2026 at Concert Hall Kitara,' +
      ' Sapporo & Suntory Hall, Tokyo』ご予約いただいた方には特典をプレゼント',
    handle: 'x',
    official: official({ hamamatsu: 'A-5', osaka: 'B-6', tokyo: 'A-7' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('マジカルミライだけの文脈なら会場名はそのまま読む', () => {
  // 上の対策で普通の書き方まで落とさないこと
  const r = attributeFromText({
    text: 'マジカルミライ2026 東京会場 A-7 でお待ちしています',
    handle: 'x',
    official: official({ tokyo: 'A-7' }),
  });
  assert.deepEqual(r.provenVenues, ['tokyo']);
});

test('浜松にしか出ていない作者は確定しない（対象外）', () => {
  const r = attributeFromText({
    text: 'クリエイターズマーケットのお品書きです',
    handle: 'x',
    official: official({ hamamatsu: 'A-1' }),
  });
  assert.deepEqual(r.provenVenues, []);
});

test('会場を限定していないイベント全体の告知は、出展する全会場に適用する', () => {
  // 実データ:
  //   「【鬱P新譜情報】マジカルミライクリエイターズマーケットにて新譜カセット
  //     テープ「H.M.1996」を頒布します。1000円です。」
  // 「マジカルミライで頒布します」としか言っておらず会場を限定していない。
  // 限定していない以上、その作者が出展する全会場に並ぶ。
  const r = attributeFromText({
    text: 'Mini Album 「Special Tea」 マジカルミライ2026クリエイターズマーケットで頒布します',
    handle: 'shinra_logic',
    official: official({ osaka: 'B-5', tokyo: 'C-9' }),
  });
  assert.deepEqual(r.provenVenues, ['osaka', 'tokyo']);
  assert.equal(r.source, 'event-wide');
});

test('ブース番号を書いているなら全体告知とは見なさない', () => {
  // 番号を書いているのは特定のブースの話。C-8 が複数会場にあるとき、
  // 全会場に広げるのは誤りで、「どの会場か分からない」が正しい。
  const r = attributeFromText({
    text: 'お品書きです。C-8 でお待ちしています',
    handle: 'x',
    official: official({ hamamatsu: 'C-8', osaka: 'C-8' }),
  });
  assert.deepEqual(r.provenVenues, []);
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
