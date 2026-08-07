import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  daysForPost,
  isMagimiraPost,
  isOshinagakiPost,
  isProductPost,
  selectPostsForVenue,
  selectReferencePostsForVenue,
  selectReviewCandidates,
} from './curation';
import { mediaKey } from './media-key';
import type { Curation, Post, Venue, VenueAttribution } from './types';

function attribution(over: Partial<VenueAttribution> = {}): VenueAttribution {
  return {
    provenVenues: [],
    daysByVenue: {},
    otherVenues: [],
    source: 'unresolved',
    evidence: [],
    ...over,
  };
}

/** お品書き画像を1枚持つ体裁。掲載条件のひとつ */
function photo(): Post['media'] {
  return [
    {
      baseUrl: 'https://pbs.twimg.com/media/G1',
      kind: 'photo',
      thumbUrl: 'https://pbs.twimg.com/media/G1?format=jpg&name=small',
      largeUrl: 'https://pbs.twimg.com/media/G1?format=jpg&name=large',
      origUrl: 'https://pbs.twimg.com/media/G1?format=jpg&name=orig',
      apiUrl: 'https://pbs.twimg.com/media/G1?format=jpg&name=4096x4096',
      altText: null,
      width: 1200,
      height: 1600,
      videoUrl: null,
    },
  ];
}

function post(over: Partial<Post> & { id: string }): Post {
  return {
    handle: 'someone',
    url: `https://x.com/someone/status/${over.id}`,
    // 既定でお品書きの体裁を満たす（掲載条件の検証に集中するため）
    text: 'マジカルミライのお品書きです',
    createdAt: '2026-08-01T00:00:00.000Z',
    media: photo(),
    isPinned: false,
    isReply: false,
    isRetweet: false,
    score: 80,
    matchedSignals: [],
    attribution: null,
    isManual: false,
    source: 'search',
    ...over,
  };
}

function curation(over: Partial<Curation> = {}): Curation {
  return { verdicts: {}, excludedHandles: [], updatedAt: '', ...over };
}

const ids = (ps: Post[]) => ps.map((p) => p.id);

// ---------------------------------------------------------------------------
// 掲載の可否 — サイトの正しさの要
// ---------------------------------------------------------------------------

test('会場が証明された投稿だけをその会場に載せる', () => {
  const posts = [
    post({ id: 'osaka', attribution: attribution({ provenVenues: ['osaka'] }) }),
    post({ id: 'tokyo', attribution: attribution({ provenVenues: ['tokyo'] }) }),
    post({ id: 'both', attribution: attribution({ provenVenues: ['osaka', 'tokyo'] }) }),
  ];
  assert.deepEqual(ids(selectPostsForVenue(posts, curation(), 'osaka')), ['osaka', 'both']);
  assert.deepEqual(ids(selectPostsForVenue(posts, curation(), 'tokyo')), ['tokyo', 'both']);
});

test('会場が未確定の投稿はどの会場にも載せない', () => {
  // 「たぶん大阪だろう」で載せない。ここが担保の中心。
  const posts = [
    post({ id: 'unresolved', score: 100, attribution: attribution() }),
    post({ id: 'noattr', score: 100, attribution: null }),
  ];
  for (const v of ['osaka', 'tokyo'] as Venue[]) {
    assert.deepEqual(selectPostsForVenue(posts, curation(), v), [], `${v} に漏れている`);
  }
});

test('スコアが高くても会場が未確定なら載せない', () => {
  const posts = [post({ id: '1', score: 100, attribution: attribution() })];
  assert.deepEqual(selectPostsForVenue(posts, curation(), 'osaka'), []);
});

test('東京専用のお品書きは大阪には出ない', () => {
  // 実データで起きていた誤り
  const posts = [
    post({
      id: 't',
      text: 'マジカルミライ2026 東京【B-27】お品書き（第1弾）',
      attribution: attribution({ provenVenues: ['tokyo'], source: 'text-booth' }),
    }),
  ];
  assert.deepEqual(selectPostsForVenue(posts, curation(), 'osaka'), []);
  assert.deepEqual(ids(selectPostsForVenue(posts, curation(), 'tokyo')), ['t']);
});

test('浜松だけのお品書きはどこにも出ない', () => {
  const posts = [
    post({
      id: 'h',
      text: '浜松のお品書き',
      score: 100,
      attribution: attribution({ otherVenues: ['hamamatsu'] }),
    }),
  ];
  assert.deepEqual(selectPostsForVenue(posts, curation(), 'osaka'), []);
  assert.deepEqual(selectPostsForVenue(posts, curation(), 'tokyo'), []);
});

test('人手で却下した投稿は証明済みでも載せない', () => {
  const posts = [post({ id: '1', attribution: attribution({ provenVenues: ['osaka'] }) })];
  const c = curation({ verdicts: { '1': 'rejected' } });
  assert.deepEqual(selectPostsForVenue(posts, c, 'osaka'), []);
});

test('人手で会場を指定すれば未確定でも載せられる', () => {
  // 自動判別できなかったものを公開する唯一の経路
  const posts = [post({ id: '1', score: 0, attribution: attribution() })];
  const c = curation({ manualVenues: { '1': ['tokyo'] } });
  assert.deepEqual(selectPostsForVenue(posts, c, 'osaka'), []);
  assert.deepEqual(ids(selectPostsForVenue(posts, c, 'tokyo')), ['1']);
});

test('人手の会場指定より却下が優先される', () => {
  const posts = [post({ id: '1', attribution: attribution({ provenVenues: ['osaka'] }) })];
  const c = curation({ verdicts: { '1': 'rejected' }, manualVenues: { '1': ['osaka'] } });
  assert.deepEqual(selectPostsForVenue(posts, c, 'osaka'), []);
});

test('掲載除外ハンドルは証明済み・人手指定でも落とす（削除依頼が最優先）', () => {
  const posts = [
    post({ id: '1', handle: 'gone', attribution: attribution({ provenVenues: ['osaka'] }) }),
    post({ id: '2', handle: 'gone', attribution: attribution({ provenVenues: ['osaka'] }) }),
    post({ id: '3', handle: 'stay', attribution: attribution({ provenVenues: ['osaka'] }) }),
  ];
  const c = curation({ excludedHandles: ['GONE'], manualVenues: { '2': ['osaka'] } });
  assert.deepEqual(ids(selectPostsForVenue(posts, c, 'osaka')), ['3']);
});

test('お礼・撤収の投稿は会場が確定していても載せない', () => {
  // 実データで担保が破れていた具体例。
  // 「次は大阪でお待ちしてます」は未来の予定であって、大阪のお品書きではない。
  const cases = [
    'マジミラ浜松ありがとうございました！ 次は大阪でお待ちしてます',
    'マジミラ浜松 3日目撤収しました。新譜は売り切れました。大阪・東京では増産します',
    '#マジミラ浜松 クリエイターズマーケット ありがとうございました！ 次のマジミラは東京3日目に参戦します',
  ];
  for (const text of cases) {
    const p = post({
      id: 'x',
      text,
      // 会場は確定している状態にしても、お品書き本体でなければ載せない
      attribution: attribution({ provenVenues: ['osaka', 'tokyo'], source: 'text-booth' }),
    });
    assert.equal(isOshinagakiPost(p), false, `お品書き扱いされている: ${text}`);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), [], text);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'tokyo'), [], text);
  }
});

test('他イベントのお品書きは載せない', () => {
  // 実データ。どれも「大阪」「東京」やブース番号らしき文字列を含むので、
  // 会場判定だけでは弾けない。
  const cases = [
    '【プロセカお品書き】あす明後日土日 プロセカクリエイターズマーケット 駄菓子O型はB-27におります！',
    '✯ 音けっと 第10楽章 お品書き ✯ 2026.6.14 難波御堂筋ホール7F [ E-9,10 ]',
    '🌈 #COMITIA156お品書き 週末のコミティアのお品書きになります！ 東京ビッグサイト 東7ホール【L47b】',
    '【おしながき公開】 7/25(土)開催のボーマス63おしながきです。',
    '*お品書きのお知らせ* ガタケット184 【E-07b】ぐちりずむ',
  ];
  for (const text of cases) {
    const p = post({
      id: 'x',
      text,
      attribution: attribution({ provenVenues: ['osaka', 'tokyo'], source: 'text-booth' }),
    });
    assert.equal(isMagimiraPost(p), false, `マジミラ扱いされている: ${text}`);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), [], text);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'tokyo'), [], text);
  }
});

test('別イベントに触れていてもマジミラの話なら載せる', () => {
  // 「7/25はボーマス、8/14〜16はマジミラ大阪」のような投稿は正当
  const p = post({
    id: '1',
    text: '#マジカルミライ2026 クリエイターズマーケットのお品書きです 大阪 F-11 ※7/25は東京の「ボーマス63」に出ます',
    attribution: attribution({ provenVenues: ['osaka'], source: 'text-booth' }),
  });
  assert.equal(isMagimiraPost(p), true);
  assert.deepEqual(ids(selectPostsForVenue([p], curation(), 'osaka')), ['1']);
});

test('「お品書きは後日」の予告は載せない（まだ出ていない）', () => {
  // 実データ。どちらも「お品書き」の語を含むので、語だけを見ていると通ってしまう。
  const cases = [
    '≫≫ お知らせ ≪≪ マジミラクリエイターズマーケット 大阪&東京にて出展します！お品書きはまた後日投稿します＞＜',
    'ズマケのお品書き明日公開します🙌 頒布予定のグッズが届いたので少しチラ見せ👀 #マジカルミライ2026',
    '【予告】明日の夜、クリエイターズマーケット浜松のおしながきを発表予定です。#マジカルミライ2026',
  ];
  for (const text of cases) {
    const p = post({
      id: 'x',
      text,
      attribution: attribution({ provenVenues: ['osaka', 'tokyo'], source: 'text-venue' }),
    });
    assert.equal(isOshinagakiPost(p), false, `お品書き扱いされている: ${text}`);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), [], text);
  }
});

test('画像が無い投稿は載せない（お品書きは画像で示される）', () => {
  const p = post({
    id: '1',
    text: 'お品書きは後で貼ります',
    media: [],
    attribution: attribution({ provenVenues: ['osaka'] }),
  });
  assert.equal(isOshinagakiPost(p), false);
  assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), []);
});

test('代替テキストにお品書きの記載があれば認める', () => {
  const media = photo();
  media[0]!.altText = 'マジカルミライ2026 大阪 D-6 のお品書き';
  const p = post({
    id: '1',
    text: 'よろしくお願いします',
    media,
    attribution: attribution({ provenVenues: ['osaka'] }),
  });
  assert.equal(isOshinagakiPost(p), true);
  assert.deepEqual(ids(selectPostsForVenue([p], curation(), 'osaka')), ['1']);
});

test('お品書きではない投稿は、会場・ブースが正しくても載せない', () => {
  // 実データ。どれも会場は正しく確定していたが、お品書きではなかった。
  const cases = [
    '頒布用CDのC1/C2エラー試験中 メディアは太陽誘電系、焼成用にデュプリケーター用のドライブを購入！',
    '事件です。届いたトレカ……角が……丸くない……人力角丸カッター職人・百華が爆誕✂️ マジカルミライ2026 大阪 B-8',
    'マジミラにて頒布のしゃいとさんの1st. EPにて、ジャケットほかアートワークを担当させていただきました！',
    '特別な新譜が完成しました🥳 マジカルミライ東京で頒布します！！ 詳細は後日🚢',
    'マジミラに向けて今のタスク💦 ・CD制作（2枚）・音源の詰め ・グッズ系（アクキー・カード・ステッカーなど）',
  ];
  for (const text of cases) {
    const p = post({
      id: 'x',
      text,
      attribution: attribution({ provenVenues: ['osaka', 'tokyo'], source: 'text-booth' }),
    });
    assert.equal(isOshinagakiPost(p), false, `お品書き扱いされている: ${text}`);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), [], text);
  }
});

test('画像判別でお品書きと確認できていれば本文の語は不要', () => {
  const p = post({
    id: '1',
    text: '新譜を出します',
    imageIsOshinagaki: true,
    attribution: attribution({ provenVenues: ['osaka'], source: 'image' }),
  });
  assert.equal(isOshinagakiPost(p), true);
  assert.deepEqual(ids(selectPostsForVenue([p], curation(), 'osaka')), ['1']);
});

test('画像がお品書きでないと分かれば、本文に「お品書き」とあっても載せない', () => {
  // 「ズマケのお品書き明日公開します🙌 頒布予定のグッズが届いたので少しチラ見せ」
  // — 本文に「お品書き」とあるが、画像は箱詰めの写真
  const p = post({
    id: '1',
    text: 'ズマケのお品書き明日公開します🙌 頒布予定のグッズが届いたので少しチラ見せ👀',
    imageIsOshinagaki: false,
    attribution: attribution({ provenVenues: ['osaka'], source: 'text-booth' }),
  });
  assert.equal(isOshinagakiPost(p), false);
  assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), []);
});

test('人手で会場を指定した場合はお品書き判定を課さない（人が中身を見ている）', () => {
  const p = post({ id: '1', text: 'ありがとうございました', score: 0, attribution: attribution() });
  const c = curation({ manualVenues: { '1': ['osaka'] } });
  assert.deepEqual(ids(selectPostsForVenue([p], c, 'osaka')), ['1']);
});

test('お品書きらしさが閾値未満の投稿は載せない', () => {
  const posts = [post({ id: '1', score: 49, attribution: attribution({ provenVenues: ['osaka'] }) })];
  assert.deepEqual(selectPostsForVenue(posts, curation(), 'osaka'), []);
  // 境界は含む
  const ok = [post({ id: '2', score: 50, attribution: attribution({ provenVenues: ['osaka'] }) })];
  assert.deepEqual(ids(selectPostsForVenue(ok, curation(), 'osaka')), ['2']);
});

// ---------------------------------------------------------------------------
// 個別商品の紹介
// ---------------------------------------------------------------------------

test('価格つきの商品紹介は載せる（企業ブースは一覧を出さないことが多い）', () => {
  const cases = [
    '🌻 マジカルミライ2026 新商品紹介 🌊 【初音ミク ピンバッジ】 販売価格：1,800円',
    '【NEWS】初音ミク × GRAPHT コラボグッズ 「マジカルミライ2026」アウリンブースにて先行販売決定。全商品ラインアップを公開！',
    '再入荷のお知らせ 「マジカルミライ2026」会場でも販売いたします 人気の A4クリアファイルが再入荷しました',
  ];
  for (const text of cases) {
    const p = post({
      id: 'x',
      text,
      attribution: attribution({ provenVenues: ['osaka'], source: 'text-venue' }),
    });
    assert.equal(isProductPost(p), true, `商品紹介と判定されない: ${text}`);
    assert.deepEqual(ids(selectPostsForVenue([p], curation(), 'osaka')), ['x'], text);
  }
});

test('予告や近況は商品紹介として載せない', () => {
  const cases = [
    '特別な新譜が完成しました🥳 マジカルミライ東京で頒布します！！ 詳細は後日🚢',
    'マジミラに向けて今のタスク💦 ・CD制作（2枚） ・音源の詰め ・グッズ系（アクキー・カード・ステッカーなど）',
    '事件です。届いたトレカ……角が……丸くない……😇 人力角丸カッター職人・百華が爆誕✂️',
    '頒布用CDのC1/C2エラー試験中 メディアは太陽誘電系、焼成用にデュプリケーター用のドライブを購入！',
  ];
  for (const text of cases) {
    const p = post({
      id: 'x',
      text,
      attribution: attribution({ provenVenues: ['osaka'], source: 'text-venue' }),
    });
    assert.equal(isProductPost(p), false, `商品紹介扱いされている: ${text}`);
    assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), [], text);
  }
});

test('お品書き（一覧）を個別商品より先に並べる', () => {
  const list = post({
    id: 'list',
    text: 'マジカルミライ2026 大阪のお品書きです',
    createdAt: '2026-08-01T00:00:00.000Z',
    attribution: attribution({ provenVenues: ['osaka'], source: 'text-venue' }),
  });
  const item = post({
    id: 'item',
    text: '新商品紹介【初音ミク ピンバッジ】販売価格：1,800円 マジカルミライ2026 大阪',
    createdAt: '2026-08-05T00:00:00.000Z', // 一覧より新しくても後ろ
    attribution: attribution({ provenVenues: ['osaka'], source: 'text-venue' }),
  });
  assert.deepEqual(ids(selectPostsForVenue([item, list], curation(), 'osaka')), ['list', 'item']);
});

// ---------------------------------------------------------------------------
// 参考枠（浜松のお品書き）
// ---------------------------------------------------------------------------

const atVenue = () => true;

test('浜松のお品書きは参考枠に入る（確定枠には入らない）', () => {
  const p = post({
    id: '1',
    text: '【#マジカルミライ2026 浜松 お品書き】新作グッズは缶バッジです！',
    attribution: attribution({ otherVenues: ['hamamatsu'] }),
  });
  // 確定枠には入らない
  assert.deepEqual(selectPostsForVenue([p], curation(), 'osaka'), []);
  // 参考枠には入る
  assert.deepEqual(
    ids(selectReferencePostsForVenue([p], curation(), 'osaka', atVenue)),
    ['1'],
  );
});

test('その会場のお品書きが既にあるサークルには参考を出さない', () => {
  const confirmed = post({
    id: 'ok',
    handle: 'same',
    text: 'マジカルミライ2026 大阪 D-6 のお品書きです',
    attribution: attribution({ provenVenues: ['osaka'], source: 'text-booth' }),
  });
  const hama = post({
    id: 'ref',
    handle: 'same',
    text: '【#マジカルミライ2026 浜松 お品書き】',
    attribution: attribution({ otherVenues: ['hamamatsu'] }),
  });
  assert.deepEqual(
    selectReferencePostsForVenue([confirmed, hama], curation(), 'osaka', atVenue),
    [],
  );
});

test('その会場に出展していないサークルには参考を出さない', () => {
  const p = post({
    id: '1',
    text: '【#マジカルミライ2026 浜松 お品書き】',
    attribution: attribution({ otherVenues: ['hamamatsu'] }),
  });
  assert.deepEqual(selectReferencePostsForVenue([p], curation(), 'osaka', () => false), []);
});

test('浜松に言及しただけの近況報告は参考枠に入れない', () => {
  // 「本日はマジミラ浜松のB02！…お品書きのうち She is Sea は…」のような投稿。
  // 会場名と「お品書き」が離れているので紐づけと見なさない。
  const p = post({
    id: '1',
    text: '本日はマジミラ浜松のB02！ 新譜間に合わずで旧譜のみ取り扱いです🙇‍♂️！ お品書きのうち「She is Sea」は完売しました',
    attribution: attribution({ otherVenues: ['hamamatsu'] }),
  });
  assert.deepEqual(selectReferencePostsForVenue([p], curation(), 'osaka', atVenue), []);
});

test('他イベントのお品書きは参考枠にも入れない', () => {
  const p = post({
    id: '1',
    text: '【おしながき公開】 7/25(土)開催のボーマス63おしながきです',
    attribution: attribution({ otherVenues: ['hamamatsu'] }),
  });
  assert.deepEqual(selectReferencePostsForVenue([p], curation(), 'osaka', atVenue), []);
});

test('掲載除外ハンドルは参考枠にも出さない', () => {
  const p = post({
    id: '1',
    handle: 'gone',
    text: '【#マジカルミライ2026 浜松 お品書き】',
    attribution: attribution({ otherVenues: ['hamamatsu'] }),
  });
  const c = curation({ excludedHandles: ['GONE'] });
  assert.deepEqual(selectReferencePostsForVenue([p], c, 'osaka', atVenue), []);
});

// ---------------------------------------------------------------------------
// 適用日
// ---------------------------------------------------------------------------

const OSAKA_DAYS = ['2026-08-14', '2026-08-15', '2026-08-16'];

test('本文で日付が絞られていればその日を使う', () => {
  const p = post({
    id: '1',
    attribution: attribution({
      provenVenues: ['osaka'],
      daysByVenue: { osaka: ['2026-08-15', '2026-08-16'] },
    }),
  });
  assert.deepEqual(daysForPost(p, 'osaka', OSAKA_DAYS), ['2026-08-15', '2026-08-16']);
});

test('日付の指定が無ければサークルの参加日をそのまま使う', () => {
  const p = post({ id: '1', attribution: attribution({ provenVenues: ['osaka'] }) });
  assert.deepEqual(daysForPost(p, 'osaka', OSAKA_DAYS), OSAKA_DAYS);
});

test('サークルが参加しない日は採用しない（本文の書き間違いを通さない）', () => {
  // 本文が 8/14 と言っていても、そのサークルが 8/15・16 しか出ないなら 8/14 は出さない
  const p = post({
    id: '1',
    attribution: attribution({
      provenVenues: ['osaka'],
      daysByVenue: { osaka: ['2026-08-14'] },
    }),
  });
  assert.deepEqual(daysForPost(p, 'osaka', ['2026-08-15', '2026-08-16']), [
    '2026-08-15',
    '2026-08-16',
  ]);
});

// ---------------------------------------------------------------------------
// レビュー候補
// ---------------------------------------------------------------------------

test('レビュー候補には未確定の投稿も含む（人が会場を指定するため）', () => {
  const posts = [
    post({ id: 'proven', attribution: attribution({ provenVenues: ['osaka'] }) }),
    post({ id: 'unresolved', attribution: attribution() }),
    post({ id: 'lowscore', score: 10, attribution: attribution() }),
  ];
  assert.deepEqual(ids(selectReviewCandidates(posts, curation())), ['proven', 'unresolved']);
});

test('レビュー候補でも掲載除外ハンドルは出さない', () => {
  const posts = [post({ id: '1', handle: 'gone', attribution: attribution() })];
  const c = curation({ excludedHandles: ['gone'] });
  assert.deepEqual(selectReviewCandidates(posts, c), []);
});

test('mediaKey は同じ URL に同じキーを返し、違う URL では衝突しない', () => {
  const a = 'https://pbs.twimg.com/media/Gabc123';
  const b = 'https://pbs.twimg.com/media/Gxyz789';
  assert.equal(mediaKey(a), mediaKey(a));
  assert.notEqual(mediaKey(a), mediaKey(b));
  assert.equal(mediaKey(a).length, 16);
});
