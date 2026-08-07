import type { Curation, Post, Venue } from './types';

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
  /ありがとうございまし|ありがとうございます|撤収|お疲れ様|おつかれさま|売り切れ|完売|終了しました|終わりました|設営完了|在庫状況/;

/**
 * 「お品書きはこれから出す」という予告。まだ出ていないので載せない。
 *
 * 実データ:
 *   「大阪&東京にて出展します！お品書きはまた後日投稿します＞＜」
 *   「ズマケのお品書き明日公開します🙌 頒布予定のグッズが届いたので少しチラ見せ」
 * どちらも「お品書き」の語を含むので、語だけを見ていると通ってしまう。
 */
const FORTHCOMING_RE =
  /(お品書き|おしながき|品書き)[^。\n]{0,12}(後日|明日|近日|のちほど|後ほど|そのうち|追って)[^。\n]{0,8}(公開|投稿|上げ|あげ|出し|お知らせ)|【予告】|発表予定/;

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
  if (RETROSPECTIVE_RE.test(text)) return false;
  // 「お品書きはまた後日投稿します」のような予告は、まだ出ていないので除く
  return !FORTHCOMING_RE.test(text);
}

/**
 * 「そのブースで買える個別の商品を紹介している投稿か」。
 *
 * お品書き（一覧）とは別物として扱う。企業ブースは一覧を出さず、
 * 商品を1点ずつ紹介することが多い:
 *   「マジカルミライ2026 新商品紹介【初音ミク ガジェットポーチ M V2】販売価格：4,400円」
 *   「マジカルミライ2026 OSAKA・TOKYO会場にて先行販売する新商品を公開」
 * これらは一覧ではないが、そのブースの品揃えを知る手がかりにはなる。
 *
 * 一覧を優先して見せたうえで、こちらも併せて出す（表示側で区別する）。
 *
 * 制作の進捗報告や近況（「トレカの角が丸くない」「打ち合わせしてきた」）を
 * 拾わないよう、**商品名らしきものと価格または販売の明示**を条件にする。
 */
const PRODUCT_RE =
  /新商品|新作|新譜|新刊|先行販売|販売価格|頒布価格|価格[:：]|受注|グッズ(情報|紹介|化)|ラインアップ|ラインナップ|入荷/;

/** 具体的な価格、または「売る」ことの明示 */
const PRICE_RE = /[¥￥][\d,]{2,7}|[\d,]{2,7}\s*円|販売価格|頒布価格/;
const ON_SALE_RE = /先行販売|販売決定|販売いたします|販売します|頒布します|頒布いたします|受注/;

/**
 * 「まだ出していない」ことを示す言い回し。
 * 実データ: 「特別な新譜が完成しました🥳 マジカルミライ東京で頒布します！！ 詳細は後日🚢」
 * 「新譜」「頒布します」が揃うので、これが無いと予告まで商品として通ってしまう。
 */
const TEASER_RE =
  /詳細は(後日|また|追って)|後日(公開|発表|お知らせ|投稿)|お楽しみに|続報|準備中|制作中|近日公開|情報解禁/;

export function isProductPost(post: Post): boolean {
  const hasPhoto = post.media.some((m) => m.kind === 'photo');
  if (!hasPhoto) return false;
  if (isOshinagakiPost(post)) return false; // 一覧はそちらで扱う

  const text = [post.text, ...post.media.map((m) => m.altText ?? '')].join('\n');
  if (RETROSPECTIVE_RE.test(text)) return false;
  if (TEASER_RE.test(text)) return false;
  if (!PRODUCT_RE.test(text)) return false;
  // 具体的な価格か、売ることの明示が要る。
  // 「新譜が完成しました！」だけでは、何がいくらで買えるのか分からない。
  return PRICE_RE.test(text) || ON_SALE_RE.test(text);
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

/** 浜松会場（7/24〜26・終了済み）への言及 */
const HAMAMATSU_RE = /浜松|HAMAMATSU|hamamatsu|Hamamatsu|アクトシティ/;

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
    // 頒布物の一覧、または個別商品の紹介であること。
    // お礼・近況報告・制作の進捗は排除する。
    if (!isOshinagakiPost(p) && !isProductPost(p)) return false;

    // B. 自動判別による証明
    return p.attribution?.provenVenues.includes(venue) === true;
  }).sort((a, b) => {
    // 一覧（お品書き）を先に見せる。個別商品はその後ろ。
    // 品揃えを一望できるほうが下調べには役に立つ。
    const ao = isOshinagakiPost(a) ? 0 : 1;
    const bo = isOshinagakiPost(b) ? 0 : 1;
    if (ao !== bo) return ao - bo;
    // 同時刻なら 0 を返す。-1 を返すと比較関数として矛盾し、並びが壊れる
    if (a.createdAt === b.createdAt) return 0;
    return a.createdAt < b.createdAt ? 1 : -1;
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
    // 確定枠（selectPostsForVenue）と同じ条件にする。
    //
    // ここが isOshinagakiPost だけだった間、新商品紹介の投稿は
    // 確定枠から外れると参考枠にも入れず、そのまま消えていた。実データ:
    //   「【鬱P新譜情報】…新譜カセットテープ「H.M.1996」を頒布します。
    //     1000円です。…浜松は26日(日)のみなので要注意！」
    //   「#マジカルミライ2026 HAMAMATSU 追加情報 物販に先行販売アイテムが
    //     追加！」（グッスマ）
    // どちらも「お品書き」の語が無いため落ちていた。
    // 浜松のものでも参考として見せる運用なのだから、見せずに捨てない。
    if (!isOshinagakiPost(p) && !isProductPost(p)) return false;
    // 対象会場のお品書きだと確定しているならそちらで載る
    if ((p.attribution?.provenVenues.length ?? 0) > 0) return false;

    // 浜松に言及しているお品書きであること。
    //
    // 当初は「浜松のお品書き」と会場名が直結している場合だけに絞っていたが、
    // 実データの書き方はもっとばらける:
    //   「【お品書き】書店太郎 と申します #マジカルミライ2026浜松 【A-10】」（語順が逆）
    //   「マジカルミライ2026お品書きです✨ … 7/24〜26 アクトシティ浜松」（離れている）
    //   「🥟お知らせ🥟 マジカルミライ2026 in HAMAMATSU … E-4「ピノキオ定食」」
    // 実測でこの条件だけで18件中17件を取りこぼしていた。
    //
    // お礼・設営完了・完売の実況は isOshinagakiPost が、
    // 他イベントは isMagimiraPost が既に落としているので、
    // ここは「浜松の話か」だけを見れば足りる。
    const text = [p.text, ...p.media.map((m) => m.altText ?? '')].join('\n');
    return HAMAMATSU_RE.test(text);
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
