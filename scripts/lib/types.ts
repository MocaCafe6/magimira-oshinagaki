/**
 * クローラー（scripts/）と Web UI（src/）が共有するデータ契約。
 * data/*.json のスキーマはすべてここで定義する。
 */

/** サイトに表示する会場 */
export type Venue = 'osaka' | 'tokyo';

export const VENUES: readonly Venue[] = ['osaka', 'tokyo'];

/**
 * 会場帰属の判定に使う会場。浜松（2026/7/24-26）は終了済みで
 * サイトには表示しないが、「この投稿は浜松のものだ」と積極的に
 * 判定するため、および「この作者は浜松に出ていないので
 * 消去法で大阪だと確定できる」と推論するために公式データを持つ。
 */
export type RefVenue = Venue | 'hamamatsu';

export const REF_VENUES: readonly RefVenue[] = ['hamamatsu', 'osaka', 'tokyo'];

/** 判定用に持つ会場情報（浜松を含む） */
export type RefVenueMeta = {
  venue: RefVenue;
  label: string;
  days: string[];
  exmarketUrl: string;
  /**
   * 企業・団体の出展ブース一覧。
   *
   * 浜松の分も必ず持つこと。無いと「浜松 B-3」と書いた企業の投稿が
   * ブース照合に失敗し、その企業が大阪・東京にも出ている場合に
   * 消去法や event-wide 規則で大阪・東京へ誤って割り当てられる。
   */
  sponsorUrl: string;
  /** 本文中でこの会場を指す語。判定に使う */
  aliases: string[];
};

export const REF_VENUE_META: Record<RefVenue, RefVenueMeta> = {
  hamamatsu: {
    venue: 'hamamatsu',
    label: '浜松',
    days: ['2026-07-24', '2026-07-25', '2026-07-26'],
    exmarketUrl: 'https://magicalmirai.com/2026/hamamatsu_exmarket.html',
    sponsorUrl: 'https://magicalmirai.com/2026/hamamatsu_sponsor.html',
    aliases: ['浜松', 'HAMAMATSU', 'hamamatsu', 'Hamamatsu', 'アクトシティ'],
  },
  osaka: {
    venue: 'osaka',
    label: '大阪',
    days: ['2026-08-14', '2026-08-15', '2026-08-16'],
    exmarketUrl: 'https://magicalmirai.com/2026/osaka_exmarket.html',
    sponsorUrl: 'https://magicalmirai.com/2026/osaka_sponsor.html',
    aliases: ['大阪', 'OSAKA', 'osaka', 'Osaka', 'インテックス'],
  },
  tokyo: {
    venue: 'tokyo',
    label: '東京',
    days: ['2026-08-28', '2026-08-29', '2026-08-30'],
    exmarketUrl: 'https://magicalmirai.com/2026/tokyo_exmarket.html',
    sponsorUrl: 'https://magicalmirai.com/2026/tokyo_sponsor.html',
    aliases: ['東京', 'TOKYO', 'tokyo', 'Tokyo', '幕張'],
  },
};

/** 会場ごとの静的メタ情報。公式サイトから確認済み。 */
export type VenueMeta = {
  venue: Venue;
  label: string;
  hall: string;
  /** 開催日（ISO 日付）。参加日フィルタとルート機能の基準になる */
  days: string[];
  exmarketUrl: string;
  sponsorUrl: string;
  /** クリエイターズマーケットのブース列（A, B, ...） */
  lines: string[];
  /**
   * 周回の既定順。公式マップ画像の入口・出口の位置から決めている。
   * 会場によって入口の位置が逆なので、共通の既定値にはできない。
   */
  route: {
    /** 入口の位置（マップ画像上） */
    entrance: 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';
    /** 列を回る順序 */
    lineOrder: string[];
    /**
     * 最初の列を右（番号の大きい方）から回るか。
     * マップ上ではブース番号は左→右に増える。
     */
    startFromRight: boolean;
  };
};

export const VENUE_META: Record<Venue, VenueMeta> = {
  osaka: {
    venue: 'osaka',
    label: '大阪',
    hall: 'インテックス大阪 3・4号館',
    days: ['2026-08-14', '2026-08-15', '2026-08-16'],
    exmarketUrl: 'https://magicalmirai.com/2026/osaka_exmarket.html',
    sponsorUrl: 'https://magicalmirai.com/2026/osaka_sponsor.html',
    lines: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    // 大阪は入口が右下（G列側）、出口が左上（A列側）
    route: {
      entrance: 'bottom-right',
      lineOrder: ['G', 'F', 'E', 'D', 'C', 'B', 'A'],
      startFromRight: true,
    },
  },
  tokyo: {
    venue: 'tokyo',
    label: '東京',
    hall: '幕張メッセ 国際展示場 1・2・3ホール',
    days: ['2026-08-28', '2026-08-29', '2026-08-30'],
    exmarketUrl: 'https://magicalmirai.com/2026/tokyo_exmarket.html',
    sponsorUrl: 'https://magicalmirai.com/2026/tokyo_sponsor.html',
    lines: ['A', 'B', 'C', 'D'],
    // 東京は入口が右上（A列側）、出口が左下（D列側）。大阪と逆。
    route: {
      entrance: 'top-right',
      lineOrder: ['A', 'B', 'C', 'D'],
      startFromRight: true,
    },
  },
};

// ---------------------------------------------------------------------------
// 公式出店者一覧
// ---------------------------------------------------------------------------

export type LinkKind = 'x' | 'karent' | 'youtube' | 'web';

export type MemberLink = {
  kind: LinkKind;
  url: string;
  /** リンクの表示ラベル（公式サイト上のアンカーテキスト） */
  label: string;
};

export type Member = {
  name: string;
  links: MemberLink[];
};

export type CreatorKind = 'creators-market' | 'sponsor';

export type Creator = {
  /** `${venue}-${boothId}` 例: "osaka-A-1"。sponsor は `${venue}-sponsor-${slug}` */
  id: string;
  venue: Venue;
  kind: CreatorKind;
  /** "A-1"。sponsor でブース番号が無い場合は null */
  boothId: string | null;
  /** "A"。ソートとマップの列判定に使う */
  line: string | null;
  boothNo: number | null;
  circleName: string;
  /** 公式サイト上のロゴ画像（絶対URL） */
  logoUrl: string | null;
  /** 参加日（ISO 日付）。日別アイコンから導出。取得できなければ会場の全日 */
  days: string[];
  members: Member[];
  /** 正規化済み X ハンドル（@なし・小文字化しない＝X は大小を保持する） */
  xHandles: string[];
  /** 公式サイト上の補足テキスト（sponsor の説明文など） */
  note: string | null;
};

// ---------------------------------------------------------------------------
// X の投稿
// ---------------------------------------------------------------------------

export type MediaKind = 'photo' | 'video' | 'animated_gif';

export type PostMedia = {
  /** pbs.twimg.com のベースURL（?format= 以降を含まない） */
  baseUrl: string;
  kind: MediaKind;
  /** サムネイル用 (name=small) */
  thumbUrl: string;
  /** 一覧・オフライン用 (name=large) */
  largeUrl: string;
  /** 原寸表示用 (name=orig) */
  origUrl: string;
  /** Claude API 入力用 (name=4096x4096)。orig は稀に API 上限を超える */
  apiUrl: string;
  altText: string | null;
  width: number;
  height: number;
  /** 動画の場合の再生ページ（= 投稿URL） */
  videoUrl: string | null;
};

/** 会場帰属をどうやって確定したか */
export type AttributionSource =
  /** 本文中の会場名 + 公式ブース番号の一致 */
  | 'text-booth'
  /** 本文中の会場名の明示（ブース番号なし） */
  | 'text-venue'
  /** 作者の出展会場が1つしかないので消去法で確定 */
  | 'sole-venue'
  /** イベント全体への告知で会場を限定していないので、出展する全会場に適用 */
  | 'event-wide'
  /** お品書き画像から読み取り */
  | 'image'
  /** 人手で指定 */
  | 'manual'
  /** 確定できなかった */
  | 'unresolved';

/**
 * この投稿がどの会場・どの日のお品書きかの判定結果。
 *
 * 「証明できたものだけ載せる」ための土台。provenVenues に入っていない
 * 会場のページには絶対に表示しない。推測で載せると、閲覧者は
 * 別会場・終了済みイベントの品揃えを見て会場へ行くことになる。
 */
export type VenueAttribution = {
  /** 掲載してよいと確定した会場 */
  provenVenues: Venue[];
  /** 会場ごとの適用日。未指定ならその会場の公式参加日すべて */
  daysByVenue: Partial<Record<Venue, string[]>>;
  /** 対象外と判定した会場（浜松など）。レビューでの判断材料 */
  otherVenues: RefVenue[];
  source: AttributionSource;
  /** なぜそう判定したかの根拠。レビュー画面に出す */
  evidence: string[];
};

export type Post = {
  /** ツイート ID（snowflake, 文字列で扱う） */
  id: string;
  handle: string;
  url: string;
  text: string;
  /** ISO 8601 */
  createdAt: string;
  media: PostMedia[];
  isPinned: boolean;
  isReply: boolean;
  isRetweet: boolean;
  /** お品書きらしさ 0-100 */
  score: number;
  matchedSignals: string[];
  /** どの会場・どの日のお品書きか。未判定なら null */
  attribution: VenueAttribution | null;
  /**
   * 添付画像が頒布物の一覧（お品書き）だったか。画像を読んで判定した結果。
   * 未判定なら null。会場の確定（attribution）とは独立して持つ。
   * 「お品書きだが会場が読めない」「会場は本文で確定済みだが画像はお品書きでない」
   * のどちらも起きるので、片方の結果でもう片方を潰さないため。
   */
  imageIsOshinagaki?: boolean | null;
  /** 手動追加された投稿か（manual-posts.json 由来） */
  isManual: boolean;
  /** 取得元: 検索 or プロフィールタイムライン */
  source: 'search' | 'timeline' | 'manual';
};

// ---------------------------------------------------------------------------
// AI 抽出した商品情報
// ---------------------------------------------------------------------------

export const ITEM_CATEGORIES = [
  'アクリルスタンド',
  'アクリルキーホルダー',
  '缶バッジ',
  'CD・音楽',
  '書籍・同人誌',
  '布製品',
  '文具',
  'ステッカー',
  'その他',
] as const;

export type ItemCategory = (typeof ITEM_CATEGORIES)[number] | string;

export type ExtractedItem = {
  postId: string;
  mediaIndex: number;
  name: string;
  /** 円。読み取れなければ null */
  price: number | null;
  /** "税込" "2点セット" など価格の補足 */
  priceNote: string | null;
  category: ItemCategory;
  note: string | null;
  confidence: 'high' | 'medium' | 'low';
};

/** 1画像あたりの抽出結果。API 再課金を防ぐキャッシュ単位 */
export type ExtractionRecord = {
  postId: string;
  mediaIndex: number;
  /** baseUrl のハッシュ。これが一致したら再抽出しない */
  mediaKey: string;
  /** お品書き画像として認識できたか */
  isOshinagaki: boolean;
  items: ExtractedItem[];
  /** 抽出失敗・拒否された場合の理由 */
  error: string | null;
  extractedAt: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number } | null;
};

// ---------------------------------------------------------------------------
// キュレーション（人間の判断を永続化する）
// ---------------------------------------------------------------------------

export type CurationVerdict = 'adopted' | 'rejected';

export type Curation = {
  /** postId -> 判断。次回クロールでも保持される */
  verdicts: Record<string, CurationVerdict>;
  /**
   * 人手で会場を指定した投稿。postId -> 会場。
   *
   * 自動判別できなかった投稿を公開したい場合の唯一の経路。
   * 「採用」だけでは会場が決まらないので、必ず会場まで指定させる。
   * これにより「公開されている投稿は必ず会場が確定している」が保たれる。
   */
  manualVenues?: Record<string, Venue[]>;
  /** 除外する X ハンドル（削除依頼など） */
  excludedHandles: string[];
  updatedAt: string;
};

/** 手動で追加したい投稿。スコアリングの取り逃しを補う */
export type ManualPost = {
  url: string;
  /** 紐付ける creator id。省略時は URL のハンドルから自動解決 */
  creatorId?: string;
  memo?: string;
};

// ---------------------------------------------------------------------------
// 会場マップ（第2弾）
// ---------------------------------------------------------------------------

export type BoothCoord = {
  boothId: string;
  /** マップ画像に対する正規化座標 0..1 */
  x: number;
  y: number;
  /** AI 下書きのままか、人間が確認済みか */
  verified: boolean;
};

export type VenueMap = {
  venue: Venue;
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /**
   * ブースが実際にある領域（正規化 0..1）。
   * 公式マップ画像には「撮影禁止」の告知や余白が広く入っているため、
   * スマホでは本当に必要な部分だけを切り出して画面幅に収める。
   */
  boothArea: { x0: number; y0: number; x1: number; y1: number };
  coords: BoothCoord[];
};

// ---------------------------------------------------------------------------
// クロール状態（中断・再開用）
// ---------------------------------------------------------------------------

export type CrawlState = {
  startedAt: string;
  updatedAt: string;
  /** 処理済みハンドル -> 取得件数 */
  done: Record<string, number>;
  /** 失敗したハンドルと理由。再実行時に再挑戦する */
  failed: Record<string, string>;
  /**
   * ハンドル -> 最後に巡回した時刻(ISO)。
   * 定期実行で「前回から N 時間経ったものだけ」を対象にするために使う。
   * 3時間おきに全163アカウントを回すとアクセスが過剰になり凍結を招く。
   */
  lastCrawledAt?: Record<string, string>;
};
