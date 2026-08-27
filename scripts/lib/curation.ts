import type { Curation, Post, Venue } from './types';

/** 候補として提示する下限スコア（レビュー画面に出すかどうかの閾値） */
export const ADOPT_SCORE_THRESHOLD = 50;

/** 「お品書き」の明示 */
const OSHINAGAKI_RE = /お品書き|おしながき|オシナガキ|品書き|お品書|品書/;

/**
 * 終わったイベントの振り返り。これから買える情報ではなく過去の報告。
 *
 * **イベントが終わった話と、品物が売り切れた話を分けて持つ。**
 * 一緒くたにすると、前の会場の完売に触れただけの次の会場のお品書きが
 * 落ちる（isRetrospective の説明を参照）。
 */
/** イベントそのものが終わったことを示す語。これだけで振り返りとみなす */
const EVENT_OVER_RE =
  /ありがとうございまし|ありがとうございます|撤収|お疲れ様|おつかれさま|終了しました|終わりました|設営完了|在庫状況/;

/**
 * 品物が売り切れた話。**これ単体では振り返りにしない。**
 *
 * 「完売」「売り切れ」は**これから起こりうる注意書き**にも使われるので、
 * 語だけで弾いてはいけない。実データ:
 *   「8/14-16、マジカルミライ大阪・クリエイターズマーケットのお品書きです。
 *     新作「革命ノ赤」含む5種（CD3、SONOCA2）の頒布となります。
 *     ※旧譜CDは1-2日目までに完売となる可能性があります。」
 * 本文に「お品書きです」と明記され会場も大阪と確定しているのに、
 * この注意書きだけで振り返り扱いになって落ちていた（mothy_悪ノP 大阪G-11）。
 * 直後に「可能性」「かも」などが続く場合は未来の話なので除く。
 */
const SOLD_OUT_RE =
  /(?:売り切れ|完売)(?!\S{0,10}(?:可能性|かも|恐れ|おそれ|見込|次第|場合|前に|しま(?:せん|す前)))/;

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
/**
 * 「終わった話」ではないと分かる打ち消し。
 *
 * 完売の判定は語の有無だけを見るので、過去の完売に触れつつ
 * これから売る話をしている投稿まで落としてしまう。実データ:
 *   「マジカルミライ大阪のお品書きです！…
 *     星の音も浜松で売り切れてしまったのですが、再入荷しました！あります！」
 * 本文に「大阪のお品書きです」と明記され会場も大阪と確定しているのに、
 * 「売り切れ」の一語で振り返り扱いになって落ちていた（たきだしごはん 大阪D-1）。
 *
 * 打ち消しの語が同じ文にあるなら、その完売は過去の出来事の説明にすぎない。
 */
const RESTOCK_RE = /再入荷|入荷しました|補充|再販|再頒布|追加(?:生産|入荷|分)|持って(?:いき|行き)ます|あります/;

/**
 * 「これはお品書きです」と名乗っている形。
 *
 * 語が出てくるだけでは足りない（「お品書きはまた後日」も語は含む）。
 * 認めるのは次の2つ。
 *
 *   ① 言い切っている  「お品書きです」「お品書きを公開」「お品書きはこちら」
 *   ② 見出しになっている（行末が「お品書き」で、次の行から品目が並ぶ）
 *        「#マジカルミライ2026 東京
 *          木瀬のんブース【C-1】お品書き
 *
 *          ・2nd Album『PIANØISM』…
 *          音街ウナステッカーは売り切れてしまい在庫なしです🙏」
 *      これは東京C-1のお品書きそのものだが、①だけを見ていると
 *      「売り切れ」で振り返り扱いになって落ちていた（のん・木瀬 東京C-1）。
 *
 * 逆に「お品書きの新譜は売り切れました」は、お品書きの後ろに文が続くので
 * どちらにも当たらない。単なる完売報告として落ちる。
 */
const OSHINAGAKI_DECLARATION_RE =
  /(?:お品書き|おしながき|品書き)(?:[はをもの]?[^。\n]{0,8}(?:公開|です|でーす|になります|こちら|作りました|できました|更新しました|載せ|貼)|[ 　]*(?:\n|$))/;

/**
 * **イベントが終わった話と、品物が売り切れた話は別物として扱う。**
 *
 * 前者（お礼・撤収・終了・設営完了）はそれだけで振り返り。
 * 後者（完売・売り切れ）は単体では振り返りにしない。実データ:
 *   「#マジカルミライ2026 TOKYO クリエイターズマーケットのお品書きを公開！
 *     …缶バッジ系がかなり大阪で売り切れてしまったので
 *     わずかな在庫限りとなります！」（ろいどる！ 東京C-17）
 * これは**東京のお品書きそのもの**で、売り切れの話は先週の大阪の説明にすぎない。
 * 会場を渡り歩くイベントでは「前の会場で売り切れた」に触れるお品書きが普通に出る。
 * 大阪が終わってから東京までの間は、この形が最も多い。
 *
 * だから「お品書きを公開」と名乗っている投稿は、完売の語があっても振り返りに
 * しない。お礼や撤収まで書いてあれば①で落ちるので、終わった報告は通らない。
 *
 * どちらも文単位で見る。「浜松ありがとうございました。大阪もあります」のような
 * 投稿で、離れた位置の「あります」が打ち消しに使われないようにするため。
 */
function isRetrospective(text: string): boolean {
  const sentences = text.split(/[。\n！!？?]/);
  // ① イベントが終わった話。お品書きを名乗っていても、これがあれば振り返り
  for (const sentence of sentences) {
    if (!EVENT_OVER_RE.test(sentence)) continue;
    if (RESTOCK_RE.test(sentence)) continue;
    return true;
  }
  // ② 品切れの話。お品書きだと名乗っているなら、これから売る物の案内である
  if (OSHINAGAKI_DECLARATION_RE.test(text)) return false;
  for (const sentence of sentences) {
    if (!SOLD_OUT_RE.test(sentence)) continue;
    if (RESTOCK_RE.test(sentence)) continue;
    return true;
  }
  return false;
}

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
  if (isRetrospective(text)) return false;
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

/**
 * それ自体が「頒布物の案内」だと名乗っている見出し。価格を要求しない。
 *
 * 企業ブースはこの形で出す。実データ:
 *   「【#初音ミク「#マジカルミライ2026」】＼大阪会場(ブース:D10)販売商品情報／」（ETERNO RÉCIT）
 *   「〈初音ミク「マジカルミライ 2026」〉COSPAグッズ情報公開✨」
 *   「【新譜情報】オリジナルEP with 鏡音リン「ASTEROID」できました。」（光収容の倉庫）
 *
 * これらは価格を**画像に**書く。本文に価格を要求していたせいで、
 * 会場もブース番号も確定している企業ブースの商品案内が軒並み落ちていた。
 * 実測で、会場確定済みなのに内容判定で落ちた投稿が130件あった。
 *
 * 「◯◯情報」と名乗っている時点でその投稿は頒布物の案内なので、
 * 価格の有無を重ねて問う必要がない。予告・完売報告は
 * TEASER_RE と振り返り判定が別途落とす。
 */
// 「メニュー」も頒布物の一覧の言い方。実データ:
//   「マジカルミライ2026 OSAKA @インテックス大阪 8/15.16 C-10「お商材屋さん」メニューです」
// 画像はCD3枚とグッズ2点に価格をつけた完全な一覧だった。
const PRODUCT_HEADLINE_RE =
  /販売商品情報|商品情報|商品紹介|グッズ(販売)?情報|新譜情報|新刊情報|新商品情報|頒布情報|物販情報|販売アイテム|取扱商品|品揃え|ラインアップ|ラインナップ|メニューです|メニュー表/;

/** 具体的な価格、または「売る」ことの明示 */
const PRICE_RE = /[¥￥][\d,]{2,7}|[\d,]{2,7}\s*円|販売価格|頒布価格/;
const ON_SALE_RE = /先行販売|販売決定|販売いたします|販売します|頒布します|頒布いたします|受注/;

/**
 * 「その会場に何を持っていくか」を並べている投稿。
 *
 * 個人サークルは見出しを付けず、こう書く。実データ:
 *   「来週8/14-16はマジカルミライ大阪 クリエイターズマーケットA-7にいます
 *     新譜『OTONA DAIGAKU』旧譜各種 缶バッジとステッカーがあります」
 * 価格は無いが、何が買えるかは分かる。お品書きの代わりになる。
 */
// 窓が改行をまたげること。品目は行を分けて並べられる:
//   「新譜『OTONA DAIGAKU』\n 旧譜各種\n 缶バッジとステッカーがあります」
// 以前は [^。\n] にしていたため、この形が一件も拾えていなかった。
// 動詞は実データに合わせて広く取る。「新譜だします」「新刊出します」も
// 何を売るかを言っている。実データ:
//   「◆8/14～16 大阪 A-6 ◆8/28～30 東京 B-18 巡音ルカの新譜だします！」
// 会場もブース番号も公式と一致しているのに、動詞が一覧に無いだけで
// 落ちていた（ヤデュクシチャンネル 大阪A-6 / 東京B-18）。
const BRINGING_RE =
  /(新譜|新刊|新作|新商品|旧譜|既刊|グッズ)[^。]{0,60}(持って(いき|行き)|持参|頒布|販売|(だ|出)し(ます|に行き)|出せ|あります|ございます|お持ちします|用意)/;

/** 「売る／配る」ことの明示。値段と組にして使う */
const DISTRIBUTE_RE = /頒布|販売|お渡し/;

/**
 * 「後日」なのが通販の話だけで、会場で売ること自体は確定している形。
 *
 * 実データ:
 *   「グッズが #マジカルミライ2026 大阪、東京のCRECOブースにて先行販売✨
 *     ぬいぐるみを追加した事後通販（受注販売）の詳細は後日公開予定！」
 * TEASER_RE の「詳細は後日」に当たって落ちていたが、後日なのは通販であって
 * ブースでの販売ではない。これを予告として弾くのは読み違い。
 */
const DEFERRED_CHANNEL_RE =
  /(通販|受注|事後|オンライン|EC)[^。\n]{0,14}詳細は(後日|また|追って)/;

/**
 * 会場からの実況。頒布物の一覧ではないので商品紹介として扱わない。
 *
 * 実データ: 「「マジカルミライ 2026」浜松最終日🔥 初音ミクシンフォニーブース
 *           出展中🎻 …公式グッズを販売‼︎」
 * 「グッズ…販売」が揃うので BRINGING_RE を素通りしてしまう。
 * 中身は「今ここで売っています」という実況で、何が買えるかの一覧ではない。
 * しかも終了済みの浜松からの実況が多く、これを商品紹介として載せると
 * 大阪・東京のページに終わった話が並ぶ。
 */
const LIVE_REPORT_RE =
  /(最終日|初日|\d\s*日目)|開場しました|開幕|設営完了|出展中|開催中|販売中です|やってます/;

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
  if (isRetrospective(text)) return false;
  if (FORTHCOMING_RE.test(text)) return false;

  // ① 見出しが「頒布物の案内」だと名乗っている。価格は画像にある
  if (PRODUCT_HEADLINE_RE.test(text)) return true;

  // ② 具体的な値段が書いてあり、売ることも明示されている。
  //    ここに「新譜」などの語を要求してはいけない。実データ:
  //      「B-2 ツムギ食堂にて『kawaiiはつくれる！！おかわり！！』頒布します！5曲入り1000円！」
  //      「『Episode:Parallel』のアクキー兼アクスタ出すぞ！値段は800円だ！マジミラ大阪から頒布予定！」
  //    どちらも何がいくらで買えるか分かるのに、語彙の一覧に無いだけで落ちていた。
  if (PRICE_RE.test(text) && DISTRIBUTE_RE.test(text)) return true;

  // ③ 予告は落とす。ただし後日なのが通販の話だけなら予告ではない
  if (TEASER_RE.test(text) && !DEFERRED_CHANNEL_RE.test(text)) return false;

  // ④ 何を持っていくかを並べている。ただし会場からの実況は除く
  if (BRINGING_RE.test(text) && !LIVE_REPORT_RE.test(text)) return true;

  // ⑤ 商品名らしきものに価格または販売の明示が伴う（従来の条件）
  if (!PRODUCT_RE.test(text)) return false;
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
