import type { Curation, Post, Venue } from './types';
import { imageBoundVenues } from './venue-attribution';

/** 候補として提示する下限スコア（レビュー画面に出すかどうかの閾値） */
export const ADOPT_SCORE_THRESHOLD = 50;

/** 「お品書き」の明示 */
const OSHINAGAKI_RE = /お品書き|おしながき|オシナガキ|品書き|お品書|品書/;

/**
 * 終わったイベントの振り返り。
 * 「ありがとうございました」「撤収しました」「売り切れました」など、
 * これから買える情報ではなく過去の報告。
 */
const RETROSPECTIVE_RE =
  /ありがとうございまし|ありがとうございます|撤収|お疲れ様|おつかれさま|売り切れ|完売しました|終了しました|終わりました/;

/**
 * 「この投稿は頒布物の一覧（お品書き）そのものか」。
 *
 * 会場が確定していても、それだけでは足りない。実データで、
 * 会場もブース番号も正しいのにお品書きではない投稿が公開されていた:
 *   「頒布用CDのC1/C2エラー試験中」（制作の進捗報告）
 *   「届いたトレカの角が丸くない……人力角丸カッター職人が爆誕」（制作こぼれ話）
 *   「◯◯さんのEPのジャケットを担当しました」（他人の頒布物）
 *   「特別な新譜が完成しました！詳細は後日」（予告）
 * どれも「その会場のお品書き」ではない。
 *
 * 「頒布」「新譜」といった語で広く拾うと上のような投稿が全部通ってしまう。
 * かといって「お品書き」の語だけを条件にすると、
 * **本文に何も書かずお品書き画像だけを貼るサークルが構造的に拾えない**。
 * 実測で、語が無いのに本文のブース番号が公式と一致する投稿が35件あった。
 *
 * そこで根拠を複数用意し、どれか1つでも立てば認める。
 * どの経路も「その投稿が頒布物の一覧である」ことの実際の証拠になっている。
 *
 *   1. 画像を読んでお品書きだと確認できた（画像判別 / OCR）
 *   2. 本文または代替テキストに「お品書き」の明示がある
 *
 * 逆に、画像を読んで「お品書きではない」と分かったものは、
 * 本文に「お品書き」とあっても載せない（「お品書きは明日公開します」＋箱の写真、など）。
 */
export function isOshinagakiPost(post: Post): boolean {
  const hasPhoto = post.media.some((m) => m.kind === 'photo');
  if (!hasPhoto) return false;
  // 1. 画像を読んだ結果。本文の語より確かなので最優先で従う
  if (post.imageIsOshinagaki === true) return true;
  if (post.imageIsOshinagaki === false) return false;

  // 2. 本文の明示
  const text = [post.text, ...post.media.map((m) => m.altText ?? '')].join('\n');
  if (!OSHINAGAKI_RE.test(text)) return false;
  // 「お品書きありがとうございました」のような終了報告は除く
  return !RETROSPECTIVE_RE.test(text);
}

/**
 * 「この投稿はマジカルミライの話か」。
 *
 * クリエイターは他の即売会にも出るので、収集した投稿には
 * 別イベントのお品書きが多数混ざる:
 *   「プロセカクリエイターズマーケット 駄菓子O型はB-27におります」
 *   「音けっと 第10楽章 お品書き 難波御堂筋ホール7F [E-9,10]」
 *   「#COMITIA156お品書き 東京ビッグサイト 東7ホール【L47b】」
 *   「ボーマス63 設営完了です！ C31」
 * どれも「大阪」「東京」やブース番号らしき文字列を含むので、
 * 会場判定だけでは弾けない。イベント名で切る。
 *
 * 「クリエイターズマーケット」はプロセカにも同名のものがあるため
 * 手掛かりにしない。マジカルミライそのものの名前を要求する。
 */
const MAGIMIRA_RE = /マジカルミライ|マジミラ|magicalmirai|Magical\s*Mirai/i;

export function isMagimiraPost(post: Post): boolean {
  // 画像から会場が確定したものは、公式のブース番号と照合済みなので足りる
  if (post.attribution?.source === 'image') return true;
  const text = [post.text, ...post.media.map((m) => m.altText ?? '')].join('\n');
  return MAGIMIRA_RE.test(text);
}

/**
 * 「この投稿をこの会場のページに載せてよいか」を判定する。
 *
 * ここが本サイトの正しさの要。掲載条件は次のどちらかだけ:
 *   A. 会場帰属の自動判別が、その会場だと**証明**した
 *   B. 人手でその会場だと**明示的に指定**した
 *
 * 「たぶんこの会場だろう」は載せない。推測を許すと、
 * 終了済みの浜松や別会場のお品書きが混ざり、閲覧者は
 * 実際には売っていない品揃えを見て会場へ行くことになる。
 *
 * この関数を通ったものだけが公開されるので、
 * 「公開中の全件が当該会場のものである」ことがこの1関数で担保される。
 */
export function selectPostsForVenue(
  posts: Post[],
  curation: Curation,
  venue: Venue,
): Post[] {
  const excluded = new Set(curation.excludedHandles.map((h) => h.toLowerCase()));
  const manual = curation.manualVenues ?? {};

  return posts.filter((p) => {
    // 掲載停止の依頼は何より優先する
    if (excluded.has(p.handle.toLowerCase())) return false;
    // 人手で却下されたものは載せない
    if (curation.verdicts[p.id] === 'rejected') return false;
    // A. 人手による会場指定。人が中身を見て判断しているので他の条件は課さない
    if (manual[p.id]?.includes(venue)) return true;

    // お品書きらしさが閾値未満のものは、そもそも候補ではない
    if (p.score < ADOPT_SCORE_THRESHOLD) return false;
    // マジカルミライの話であること（他イベントのお品書きを排除する）
    if (!isMagimiraPost(p)) return false;
    // 頒布物の一覧そのものであること（お礼・近況報告を排除する）
    if (!isOshinagakiPost(p)) return false;

    // B. 自動判別による証明
    return p.attribution?.provenVenues.includes(venue) === true;
  });
}

/**
 * 「参考として見せる、浜松で頒布されたお品書き」を選ぶ。
 *
 * 浜松（7/24〜26）は終了済み。多くのサークルは3会場すべてに出るが、
 * 大阪・東京のお品書きをまだ投稿していないことが多い。実測で、浜松の
 * お品書きを投稿した56人のうち44人が大阪、53人が東京にも出展している。
 *
 * その浜松のお品書きは「大阪のお品書き」ではない。売り切れた物も、
 * 大阪から増える物もある。だから `selectPostsForVenue` には**入れない**
 * ——「載っているものは全部その会場のお品書き」という担保はそのまま保つ。
 *
 * かわりに画面上の別枠として、
 * 「参考：浜松で頒布されたお品書きです。大阪でも同じ内容とは限りません」
 * と明記したうえで見せる。何を見ているかが閲覧者に分かる形にする。
 *
 * その会場のお品書きが確定した投稿が既にあるサークルには出さない
 * （本物があるのに参考を並べる意味がない）。
 */
export function selectReferencePostsForVenue(
  posts: Post[],
  curation: Curation,
  venue: Venue,
  /** そのサークルがこの会場に出展しているか。ハンドルは小文字で渡す */
  exhibitsAtVenue: (handle: string) => boolean,
): Post[] {
  const excluded = new Set(curation.excludedHandles.map((h) => h.toLowerCase()));
  const confirmed = new Set(
    selectPostsForVenue(posts, curation, venue).map((p) => p.handle.toLowerCase()),
  );

  return posts.filter((p) => {
    const h = p.handle.toLowerCase();
    if (excluded.has(h)) return false;
    if (curation.verdicts[p.id] === 'rejected') return false;
    // その会場の本物のお品書きが既にあるなら参考は要らない
    if (confirmed.has(h)) return false;
    // この会場に出展していないサークルには出さない
    if (!exhibitsAtVenue(h)) return false;

    if (p.isRetweet || p.isReply) return false;
    if (!isMagimiraPost(p)) return false;
    if (!isOshinagakiPost(p)) return false;
    // 対象会場のお品書きだと確定しているならそちらで載る
    if ((p.attribution?.provenVenues.length ?? 0) > 0) return false;

    // 「浜松のお品書き」と本文が明示しているものだけ。
    // 単に浜松に言及しているだけの投稿（「本日はマジミラ浜松のB02！…お品書きの
    // うち She is Sea は…」のような近況報告）を拾わないため、
    // 会場名と「お品書き」が結びついていることを条件にする。
    const text = [p.text, ...p.media.map((m) => m.altText ?? '')].join('\n');
    return imageBoundVenues(text).includes('hamamatsu');
  });
}

/**
 * その投稿がその会場で「どの日」に該当するか。
 * 本文で日付が絞られていればそれを、無ければサークルの公式参加日を使う。
 */
export function daysForPost(post: Post, venue: Venue, creatorDays: string[]): string[] {
  const narrowed = post.attribution?.daysByVenue?.[venue];
  if (!narrowed || narrowed.length === 0) return creatorDays;
  // 公式参加日に含まれる日だけを残す（本文の書き間違いを通さない）
  const set = new Set(creatorDays);
  const hit = narrowed.filter((d) => set.has(d));
  return hit.length > 0 ? hit : creatorDays;
}

/** レビュー画面に出す候補（公開可否とは別。未確定のものも含む） */
export function selectReviewCandidates(posts: Post[], curation: Curation): Post[] {
  const excluded = new Set(curation.excludedHandles.map((h) => h.toLowerCase()));
  return posts.filter((p) => {
    if (excluded.has(p.handle.toLowerCase())) return false;
    return p.score >= ADOPT_SCORE_THRESHOLD || Boolean(curation.manualVenues?.[p.id]);
  });
}
