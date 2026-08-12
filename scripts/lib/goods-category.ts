/**
 * お品書きに載っている頒布物の種類を、本文と画像のOCRから推定する。
 *
 * グッズのページが一覧ページの劣化版になっていたので、
 * 「アクキーだけ見たい」「CDだけ見たい」で絞れるようにするための分類。
 *
 * 完全な商品抽出（items.json）は API キーが要るので、それが無くても
 * 使えるように**語の有無だけ**で分類する。1枚のお品書きに複数の種類が
 * 載るのが普通なので、1つに決めず当たったものを全部返す。
 *
 * 誤って付けても害は小さい（絞り込みの候補に出るだけ）が、
 * 付け漏れは「絞ると消える」ので体験が悪い。**広めに取る**方針。
 */

export type GoodsCategory =
  | 'cd'
  | 'acrylic'
  | 'badge'
  | 'sticker'
  | 'plush'
  | 'apparel'
  | 'bag'
  | 'book'
  | 'stationery'
  | 'accessory'
  | 'card'
  | 'food'
  | 'other';

export const GOODS_CATEGORY_LABEL: Record<GoodsCategory, string> = {
  cd: 'CD・音源',
  acrylic: 'アクスタ・アクキー',
  badge: '缶バッジ',
  sticker: 'ステッカー',
  plush: 'ぬいぐるみ',
  apparel: '衣類',
  bag: 'バッグ・ポーチ',
  book: '本・冊子',
  stationery: '文具',
  accessory: 'アクセサリー',
  card: 'カード類',
  food: '食品',
  other: 'その他',
};

/**
 * 表記ゆれをまとめて拾う。実データから採った:
 *   アクキー / アクリルキーホルダー / アクスタ / アクリルスタンド
 *   缶バッジ / 罐バッジ / カンバッジ
 *   CD / アルバム / 新譜 / EP / 音源 / SONOCA
 */
const RULES: { category: GoodsCategory; re: RegExp }[] = [
  {
    category: 'cd',
    re: /CD|ＣＤ|アルバム|新譜|旧譜|EP\b|ミニアルバム|シングル|音源|SONOCA|ソノカ|カセット|フルアルバム|コンピ/i,
  },
  {
    category: 'acrylic',
    re: /アク(?:キー|スタ|リル)|アクリルキーホルダー|アクリルスタンド|アクリルブロック|アクリルチャーム|アクリルフィギュア/,
  },
  { category: 'badge', re: /[缶罐]バッジ|カンバッジ|バッヂ|ピンバッジ|ピンバッチ/ },
  { category: 'sticker', re: /ステッカー|シール|デカール|ステッカーセット/ },
  { category: 'plush', re: /ぬいぐるみ|ぬい活|肩乗りぬい|マスコット|プラッシュ|ねんどろいど|フィギュア/ },
  {
    category: 'apparel',
    re: /T\s?シャツ|Tシャツ|ティーシャツ|パーカー|フーディ|スウェット|ハッピ|はっぴ|法被|ウェア|ジャージ|靴下|ソックス|タオル|手ぬぐい/i,
  },
  { category: 'bag', re: /トートバッグ|バッグ|ポーチ|サコッシュ|巾着|リュック|キャリーバッグ|エコバッグ/ },
  { category: 'book', re: /小説|同人誌|冊子|画集|楽譜|ZINE|パンフレット|新刊|既刊|本文/i },
  {
    category: 'stationery',
    re: /クリアファイル|ノート|下敷き|ボールペン|シャープペン|付箋|メモ帳|マスキングテープ|マステ|定規/,
  },
  {
    // 企業ブースは英語表記も混ざる（HELLO! GOOD SMILE Charm など）
    category: 'accessory',
    re: /ピアス|イヤリング|ネックレス|ブレスレット|キーホルダー|ストラップ|チャーム|リング|ヘアゴム|刺繍ワッペン|ワッペン|Charm|Keychain|Key\s?Holder|Strap/i,
  },
  { category: 'card', re: /トレカ|トレーディングカード|ブロマイド|ポストカード|色紙|カードウォレット|クリアカード/ },
  { category: 'food', re: /チュロス|お菓子|クッキー|飴|スパイス|カレー|ドリンク|コーヒー|チョコ|駄菓子|おかき/ },
];

/**
 * 本文・代替テキスト・OCR結果をまとめて渡す。
 * どれも無いときは 'other' だけを返す（絞り込みから消えないように）。
 */
export function detectGoodsCategories(...texts: (string | null | undefined)[]): GoodsCategory[] {
  const text = texts.filter(Boolean).join('\n');
  if (!text.trim()) return ['other'];
  const found = RULES.filter((r) => r.re.test(text)).map((r) => r.category);
  return found.length > 0 ? [...new Set(found)] : ['other'];
}
