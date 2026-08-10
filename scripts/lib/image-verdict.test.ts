import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyImageRead, type ImageRead } from './image-verdict';
import type { OfficialEntry } from './venue-attribution';

const OSAKA_DAYS = ['2026-08-14', '2026-08-15', '2026-08-16'];
const TOKYO_DAYS = ['2026-08-28', '2026-08-29', '2026-08-30'];
const HAMA_DAYS = ['2026-07-24', '2026-07-25', '2026-07-26'];

const official: OfficialEntry[] = [
  { venue: 'hamamatsu', boothId: 'A-5', days: HAMA_DAYS },
  { venue: 'osaka', boothId: 'D-6', days: OSAKA_DAYS },
  { venue: 'tokyo', boothId: 'C-18', days: TOKYO_DAYS },
];

function read(over: Partial<ImageRead> = {}): ImageRead {
  return { isOshinagaki: true, venues: [], notes: null, ...over };
}

test('画像のブース番号が公式と一致すれば確定する', () => {
  const { attribution } = verifyImageRead(
    read({ venues: [{ venue: 'osaka', boothId: 'D-06', dates: [] }] }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, ['osaka']);
  assert.equal(attribution.source, 'image');
});

test('画像のブース番号が公式と食い違えば確定しない', () => {
  const { attribution, mismatched } = verifyImageRead(
    read({ venues: [{ venue: 'osaka', boothId: 'B-99', dates: [] }] }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, []);
  assert.equal(mismatched, true);
});

test('会場名を書き間違えていても、番号が別会場の公式番号と一意に一致すれば直す', () => {
  // 実データ: Re:nG のお品書きの見出しは
  //   「C-10（浜松）/ B-06（東京）/ B-03（東京）」
  // と東京を2回書いている。公式では B-6 が大阪、B-3 が東京。作者の誤記。
  // 「一致しない」で捨てていたため大阪のお品書きを丸ごと落としていた。
  const off: OfficialEntry[] = [
    { venue: 'hamamatsu', boothId: 'C-10', days: HAMA_DAYS },
    { venue: 'osaka', boothId: 'B-6', days: OSAKA_DAYS },
    { venue: 'tokyo', boothId: 'B-3', days: TOKYO_DAYS },
  ];
  const { attribution } = verifyImageRead(
    read({
      venues: [
        { venue: 'hamamatsu', boothId: 'C-10', dates: [] },
        { venue: 'tokyo', boothId: 'B-06', dates: [] },
        { venue: 'tokyo', boothId: 'B-03', dates: [] },
      ],
    }),
    off,
  );
  assert.deepEqual([...attribution.provenVenues].sort(), ['osaka', 'tokyo']);
});

test('番号が複数会場で重複していれば書き間違いとして直さない', () => {
  // どちらの会場か決められないので、推測で埋めない
  const off: OfficialEntry[] = [
    { venue: 'osaka', boothId: 'B-6', days: OSAKA_DAYS },
    { venue: 'tokyo', boothId: 'B-6', days: TOKYO_DAYS },
  ];
  const { attribution, mismatched } = verifyImageRead(
    read({ venues: [{ venue: 'osaka', boothId: 'B-7', dates: [] }] }),
    off,
  );
  assert.deepEqual(attribution.provenVenues, []);
  assert.equal(mismatched, true);
});

test('ブース番号が読めなくても、会場名と公式の出展記録が揃えば確定する', () => {
  const { attribution } = verifyImageRead(
    read({ venues: [{ venue: 'tokyo', boothId: null, dates: [] }] }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, ['tokyo']);
});

test('お品書きでない画像は、会場が読めても確定しない', () => {
  // 会場写真や告知バナー。source:'image' は curation の
  // お品書き判定を素通りするので、ここで止めないと素通しになる。
  const { attribution } = verifyImageRead(
    read({ isOshinagaki: false, venues: [{ venue: 'osaka', boothId: 'D-6', dates: [] }] }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, []);
  assert.equal(attribution.source, 'unresolved');
});

test('浜松しか読み取れなければ確定せず、他会場として記録する', () => {
  const { attribution } = verifyImageRead(
    read({ venues: [{ venue: 'hamamatsu', boothId: 'A-5', dates: [] }] }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, []);
  assert.deepEqual(attribution.otherVenues, ['hamamatsu']);
});

test('公式に出展記録が無い会場は確定しない', () => {
  const { attribution } = verifyImageRead(
    read({ venues: [{ venue: 'tokyo', boothId: null, dates: [] }] }),
    [{ venue: 'osaka', boothId: 'D-6', days: OSAKA_DAYS }],
  );
  assert.deepEqual(attribution.provenVenues, []);
});

test('日付は会場の開催日に含まれるものだけ採用する', () => {
  const { attribution } = verifyImageRead(
    read({
      venues: [
        { venue: 'osaka', boothId: 'D-6', dates: ['2026-08-15', '2026-07-26', '2026-08-29'] },
      ],
    }),
    official,
  );
  assert.deepEqual(attribution.daysByVenue.osaka, ['2026-08-15']);
});

test('会場を限定していないマジミラのお品書きは、出展する全会場に適用する', () => {
  // 実データ: 千本桜15周年の Goods List。マジカルミライ2026のロゴ入りだが
  // 会場名もブース番号も無い。会場を限定していない以上、両会場に並ぶ。
  const { attribution } = verifyImageRead(
    read({ isMagimira: true, venueScope: 'event-wide' }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, ['osaka', 'tokyo']);
  assert.equal(attribution.source, 'image');
  assert.deepEqual(attribution.otherVenues, ['hamamatsu']);
});

test('マジミラだと確認できない会場無指定のお品書きは確定しない', () => {
  // 他イベントのお品書きを全会場に配ってしまわないための歯止め
  const { attribution } = verifyImageRead(
    read({ isMagimira: false, venueScope: 'event-wide' }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, []);
});

test('会場無指定でも、対象会場に出展していなければ確定しない', () => {
  const { attribution } = verifyImageRead(read({ isMagimira: true, venueScope: 'event-wide' }), [
    { venue: 'hamamatsu', boothId: 'A-5', days: HAMA_DAYS },
  ]);
  assert.deepEqual(attribution.provenVenues, []);
});

test('会場無指定でもお品書きでなければ確定しない', () => {
  const { attribution } = verifyImageRead(
    read({ isOshinagaki: false, isMagimira: true, venueScope: 'event-wide' }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, []);
});

test('OCR の陰性は「お品書きではない」として記録しない', () => {
  // tesseract は本物のお品書きをかなり読み落とす（実測 15枚中10枚）。
  // その「読めなかった」を陰性として扱うと、本文の語で正しく載っている
  // 投稿を巻き添えで消す。readBy でどこまで信じるかを分ける。
  const ocr = read({ isOshinagaki: false, readBy: 'ocr' });
  const vision = read({ isOshinagaki: false, readBy: 'vision' });
  assert.equal(ocr.readBy, 'ocr');
  assert.equal(vision.readBy, 'vision');
  // verifyImageRead 自体はどちらも確定しない（会場が読めていないので当然）
  assert.deepEqual(verifyImageRead(ocr, official).attribution.provenVenues, []);
  assert.deepEqual(verifyImageRead(vision, official).attribution.provenVenues, []);
});

test('複数会場が読み取れれば両方に確定する', () => {
  const { attribution } = verifyImageRead(
    read({
      venues: [
        { venue: 'osaka', boothId: 'D-6', dates: [] },
        { venue: 'tokyo', boothId: 'C-18', dates: [] },
        { venue: 'hamamatsu', boothId: 'A-5', dates: [] },
      ],
    }),
    official,
  );
  assert.deepEqual(attribution.provenVenues, ['osaka', 'tokyo']);
  assert.deepEqual(attribution.otherVenues, ['hamamatsu']);
});
