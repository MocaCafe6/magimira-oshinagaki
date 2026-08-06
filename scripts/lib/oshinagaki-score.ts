/**
 * 「この投稿はお品書きか」のスコアリング。
 *
 * 完璧な自動判定は狙わない。候補を人間が採用/却下し、その判断を
 * data/curation.json に永続化する前提の、候補を絞るためのふるい。
 * 純関数なのでテストしやすく、閾値の調整も安全にできる。
 */

export type ScoreInput = {
  text: string;
  /** 添付画像・動画の枚数 */
  mediaCount: number;
  isPinned: boolean;
  isReply: boolean;
  isRetweet: boolean;
  /** ISO 8601 */
  createdAt: string;
  /** この投稿主に紐づくブースID（"A-1" 等）。本文との一致を見る */
  boothIds?: string[];
};

export type ScoreResult = {
  score: number;
  /** 何が効いたか。レビューUIで判断根拠として見せる */
  signals: string[];
};

/** イベント開始よりこれ以降の投稿を「今年のもの」と扱う */
export const RECENT_SINCE = '2026-07-01T00:00:00Z';

/** クロール時の検索クエリに使うキーワード（X の検索構文にそのまま入る） */
export const SEARCH_KEYWORDS = [
  'お品書き',
  'おしながき',
  '品書き',
  '頒布',
  '新刊',
  'マジミラ',
  'マジカルミライ',
] as const;

/** 候補として提示する下限スコア */
export const CANDIDATE_THRESHOLD = 50;

/** 対象会場（大阪・東京）への言及 */
const TARGET_VENUE_RE = /大阪|OSAKA|東京|TOKYO|幕張|インテックス/i;

/**
 * 無条件で対象外にする条件。
 *
 * 加点の合計が大きいと減点では打ち消せない。実データでは
 * 「先駆けてマジカルミライ2026浜松のお品書きうpしておきます … C-1」が
 * -45 の減点をしてもなお 85点に達し、大阪のページに表示されてしまった。
 * 別イベントのお品書きは「点数が低い」のではなく「対象ではない」ので、
 * 重み付けではなく足切りで扱う。
 */
const DISQUALIFIERS: { id: string; test: (i: ScoreInput) => boolean }[] = [
  {
    // 浜松（2026/7/24-26）は終了済みで本サイトの対象外。
    // 同じクリエイターが多数出ているため浜松のお品書きが大量に混ざる。
    // 大阪・東京にも触れている投稿（「浜松の残りを大阪へ」等）は除外しない。
    id: '浜松のみ（対象外・終了済み）',
    test: (i) => /浜松|HAMAMATSU|アクトシティ/i.test(i.text) && !TARGET_VENUE_RE.test(i.text),
  },
];

const RULES: { id: string; weight: number; test: (i: ScoreInput) => boolean }[] = [
  {
    id: 'お品書き表記',
    weight: 40,
    test: (i) => /お品書き|おしながき|オシナガキ/.test(i.text),
  },
  {
    id: '品書き表記',
    weight: 25,
    test: (i) => /品書き/.test(i.text) && !/お品書き|おしながき/.test(i.text),
  },
  {
    id: '頒布・新刊・グッズ',
    weight: 15,
    test: (i) => /頒布|新刊|グッズ|物販|通販|BOOTH|booth\.pm/.test(i.text),
  },
  {
    id: 'イベント名',
    weight: 20,
    test: (i) => /マジミラ|マジカルミライ|MAGICAL\s*MIRAI/i.test(i.text),
  },
  {
    // 対象会場への言及は強い関連シグナル
    id: '対象会場',
    weight: 15,
    test: (i) => TARGET_VENUE_RE.test(i.text),
  },
  {
    id: 'ブース番号',
    weight: 25,
    test: (i) => {
      // 自分のブース番号が本文にあれば強い信号
      if (i.boothIds?.length) {
        for (const b of i.boothIds) {
          if (!b) continue;
          const norm = b.replace('-', '[-‐−ー]?');
          if (new RegExp(norm, 'i').test(i.text)) return true;
        }
      }
      // 一般的なブース番号表記
      return /(?:^|[^A-Za-z])[A-G][-‐−ー]?\d{1,2}(?:$|[^0-9])/.test(i.text);
    },
  },
  {
    id: '価格表記',
    weight: 10,
    test: (i) => /[0-9０-９]{3,5}\s*円|¥\s*[0-9０-９]{3,5}/.test(i.text),
  },
  {
    id: '画像あり',
    weight: 20,
    test: (i) => i.mediaCount > 0,
  },
  {
    id: '固定ツイート',
    weight: 15,
    test: (i) => i.isPinned,
  },
  {
    id: '直近の投稿',
    weight: 10,
    test: (i) => i.createdAt >= RECENT_SINCE,
  },
  {
    // 頒布物に触れていない投稿を落とす。
    // 実データで「マジカルミライ2026浜松 クリエイターズマーケット撤収しました！」
    // のような報告投稿が、イベント名＋画像＋直近だけで 65点に達していた。
    // お品書きの語も価格も無い投稿は、画像があっても頒布内容ではない。
    id: '頒布内容の言及なし',
    weight: -25,
    test: (i) =>
      !/お品書き|おしながき|オシナガキ|品書き/.test(i.text) &&
      !/頒布|新刊|グッズ|物販|通販|BOOTH|booth\.pm/.test(i.text) &&
      !/[0-9０-９]{3,5}\s*円|¥\s*[0-9０-９]{3,5}/.test(i.text),
  },
  {
    id: 'リプライ',
    weight: -30,
    test: (i) => i.isReply,
  },
  {
    id: 'リツイート',
    weight: -30,
    test: (i) => i.isRetweet,
  },
];

export function scoreOshinagaki(input: ScoreInput): ScoreResult {
  // 足切りが先。加点をいくら積んでも対象外は対象外。
  for (const d of DISQUALIFIERS) {
    if (d.test(input)) return { score: 0, signals: [`除外: ${d.id}`] };
  }

  const signals: string[] = [];
  let positive = 0;
  let penalty = 0;

  for (const rule of RULES) {
    if (!rule.test(input)) continue;
    if (rule.weight >= 0) {
      positive += rule.weight;
      signals.push(`+${rule.weight} ${rule.id}`);
    } else {
      penalty += -rule.weight;
      signals.push(`${rule.weight} ${rule.id}`);
    }
  }

  // 加点を先に 100 で丸め、そのあとで減点する。
  // 逆順にすると素点が高い投稿でリプライ減点がクランプに吸収され、
  // 元投稿とリプライが同じ 100 点になってしまう。
  const score = Math.max(0, Math.min(100, positive) - penalty);
  return { score, signals };
}

export function isCandidate(result: ScoreResult, threshold = CANDIDATE_THRESHOLD): boolean {
  return result.score >= threshold;
}

/**
 * X の検索クエリを組む。
 * from: で投稿主を絞り、キーワードOR・日付下限をつけて件数を抑える。
 */
export function buildSearchQuery(handle: string, since = '2026-06-01'): string {
  const kw = SEARCH_KEYWORDS.join(' OR ');
  return `from:${handle} (${kw}) since:${since}`;
}
