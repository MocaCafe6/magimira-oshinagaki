/**
 * ビルド時に data/*.json を読み込むローダ。
 *
 * サーバコンポーネントからのみ呼ぶ（静的エクスポートではビルド時に走る）。
 * JSON を import せず fs で読むのは、巨大な JSON をクライアントバンドルに
 * 混ぜないため。クライアントへは必要な形に絞って props で渡す。
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type {
  Creator,
  Curation,
  ExtractionRecord,
  Post,
  Venue,
  VenueMap,
} from '@shared/types';
import { VENUES, VENUE_META } from '@shared/types';

// 掲載判定は抽出スクリプトと同じ関数を使う（食い違いを防ぐ）
export { selectPostsForVenue, selectReviewCandidates, daysForPost, selectReferencePostsForVenue } from '@shared/curation';
import { daysForPost, selectPostsForVenue, selectReferencePostsForVenue } from '@shared/curation';

const DATA_DIR = resolve(process.cwd(), 'data');

async function load<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(resolve(DATA_DIR, file), 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// クライアントへ渡す形（一覧では重い項目を落とす）
// ---------------------------------------------------------------------------

/** 一覧に直接出す画像 */
export type ListImage = {
  largeUrl: string;
  origUrl: string;
  altText: string | null;
  width: number;
  height: number;
  postUrl: string;
};

export type CreatorSummary = {
  id: string;
  venue: Venue;
  kind: Creator['kind'];
  boothId: string | null;
  line: string | null;
  boothNo: number | null;
  circleName: string;
  logoUrl: string | null;
  days: string[];
  memberNames: string[];
  xHandles: string[];
  /** 採用済みお品書きの枚数。0 なら「お品書き未確認」 */
  oshinagakiCount: number;
  /** 一覧に出すサムネイル（最初の1枚） */
  thumbUrl: string | null;
  /**
   * 一覧でそのまま読めるように出すお品書き画像。
   * 詳細ページを開かなくても品揃えが分かるようにするため、
   * サムネではなく large を渡す。
   */
  images: ListImage[];
  /**
   * 参考として出す、浜松で頒布されたお品書きの画像。
   * この会場のお品書きがまだ無いサークルにだけ入る。
   * 表示側で必ず「参考・浜松」と分かる形にすること。
   */
  referenceImages: ListImage[];
  /** 検索用に事前連結したテキスト（サークル名・メンバー名・商品名） */
  searchText: string;
};

export type CreatorDetail = CreatorSummary & {
  members: Creator['members'];
  note: string | null;
  posts: Post[];
  items: ExtractionRecord[];
  /**
   * 投稿ごとの「この会場でのお品書き適用日」。
   * 本文に日付が書かれていればそれで絞り、無ければサークルの参加日。
   */
  postDays: Record<string, string[]>;
  /**
   * 参考として見せる、浜松（7/24〜26・終了済み）で頒布されたお品書き。
   * この会場のお品書きがまだ無いサークルにだけ入る。
   * **確定枠（posts）とは別物**。同じ内容が並ぶとは限らない。
   */
  referencePosts: Post[];
};

// ---------------------------------------------------------------------------

export async function loadCreators(venue: Venue): Promise<Creator[]> {
  const [market, sponsors] = await Promise.all([
    load<Creator[]>(`creators.${venue}.json`, []),
    load<Creator[]>(`sponsors.${venue}.json`, []),
  ]);
  return [...market, ...sponsors];
}

export async function loadAllCreators(): Promise<Creator[]> {
  const lists = await Promise.all(VENUES.map((v) => loadCreators(v)));
  return lists.flat();
}

export async function loadPosts(): Promise<Post[]> {
  return await load<Post[]>('posts.json', []);
}

export async function loadCuration(): Promise<Curation> {
  return await load<Curation>('curation.json', {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });
}

export async function loadExtractions(): Promise<ExtractionRecord[]> {
  return await load<ExtractionRecord[]>('items.json', []);
}

export async function loadVenueMap(venue: Venue): Promise<VenueMap | null> {
  return await load<VenueMap | null>(`booth-coords.${venue}.json`, null);
}

// ---------------------------------------------------------------------------
// 組み立て
// ---------------------------------------------------------------------------

/** 投稿の写真を、一覧にそのまま出せる形にする */
function toListImages(posts: Post[]): ListImage[] {
  return posts.flatMap((p) =>
    p.media
      .filter((m) => m.kind === 'photo')
      .map((m) => ({
        largeUrl: m.largeUrl,
        origUrl: m.origUrl,
        altText: m.altText,
        width: m.width,
        height: m.height,
        postUrl: p.url,
      })),
  );
}

function toSummary(
  c: Creator,
  posts: Post[],
  extractions: ExtractionRecord[],
  referencePosts: Post[] = [],
): CreatorSummary {
  const media = posts.flatMap((p) => p.media).filter((m) => m.kind === 'photo');
  const itemNames = extractions.flatMap((e) => e.items.map((i) => i.name));
  return {
    id: c.id,
    venue: c.venue,
    kind: c.kind,
    boothId: c.boothId,
    line: c.line,
    boothNo: c.boothNo,
    circleName: c.circleName,
    logoUrl: c.logoUrl,
    days: c.days,
    memberNames: c.members.map((m) => m.name).filter(Boolean),
    xHandles: c.xHandles,
    oshinagakiCount: media.length,
    thumbUrl: media[0]?.thumbUrl ?? null,
    images: toListImages(posts),
    referenceImages: toListImages(referencePosts),
    searchText: [
      c.circleName,
      c.boothId ?? '',
      ...c.members.map((m) => m.name),
      ...c.xHandles,
      ...itemNames,
    ]
      .join(' ')
      .toLowerCase(),
  };
}

/** ハンドル -> 採用済み投稿 の索引 */
function indexPostsByHandle(posts: Post[]): Map<string, Post[]> {
  const m = new Map<string, Post[]>();
  for (const p of posts) {
    const k = p.handle.toLowerCase();
    const arr = m.get(k) ?? [];
    arr.push(p);
    m.set(k, arr);
  }
  for (const arr of m.values()) {
    arr.sort((a, b) => {
      // 固定ツイート優先、次にスコア、次に新しい順
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
  }
  return m;
}

function postsForCreator(c: Creator, byHandle: Map<string, Post[]>): Post[] {
  const out: Post[] = [];
  const seen = new Set<string>();
  for (const h of c.xHandles) {
    for (const p of byHandle.get(h.toLowerCase()) ?? []) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** 一覧ページ用のデータを組み立てる */
export async function buildVenueIndex(venue: Venue): Promise<{
  venue: Venue;
  label: string;
  hall: string;
  days: string[];
  creators: CreatorSummary[];
  /** お品書きが1枚以上あるサークル数 */
  withOshinagaki: number;
  totalOshinagaki: number;
  /**
   * オフライン保存の既定対象。
   * ページ本体とサムネイルのみ。原寸に近い large を全件入れると
   * 30MB を超え、pbs.twimg.com 側にも弾かれる。
   */
  offlineUrls: string[];
  /**
   * サークルごとの large 画像。お気に入りに入れたものだけ追加で保存する。
   * 会場で実際に開くのはお気に入りのページなので、そこだけ高画質で持つ。
   */
  largeByCreator: Record<string, string[]>;
}> {
  const [creators, posts, curation, extractions] = await Promise.all([
    loadCreators(venue),
    loadPosts(),
    loadCuration(),
    loadExtractions(),
  ]);
  // この会場のものだと確定した投稿だけを使う
  const adopted = selectPostsForVenue(posts, curation, venue);
  const byHandle = indexPostsByHandle(adopted);
  const exByPost = new Map<string, ExtractionRecord[]>();
  for (const e of extractions) {
    const arr = exByPost.get(e.postId) ?? [];
    arr.push(e);
    exByPost.set(e.postId, arr);
  }

  // この会場のお品書きがまだ無いサークル向けの「参考：浜松のお品書き」
  const allHandles = new Set(creators.flatMap((c) => c.xHandles.map((h) => h.toLowerCase())));
  const refByHandle = indexPostsByHandle(
    selectReferencePostsForVenue(posts, curation, venue, (h) => allHandles.has(h)),
  );

  const summaries = creators.map((c) => {
    const ps = postsForCreator(c, byHandle);
    const exs = ps.flatMap((p) => exByPost.get(p.id) ?? []);
    // 確定枠があるサークルには参考を出さない
    const refs = ps.length > 0 ? [] : postsForCreator(c, refByHandle);
    return toSummary(c, ps, exs, refs);
  });

  // オフライン保存の対象を組む。
  // 原寸(orig)は重すぎるので large まで。会場では large で十分読める。
  // トップと横断ページも入れておく（オフラインで一覧から辿れるように）
  const offlineUrls: string[] = ['/', '/items/', '/favorites/', '/map/'];
  // 会場マップ画像もオフラインで必要
  const venueMapImage = (await loadVenueMap(venue))?.imageUrl;
  if (venueMapImage) offlineUrls.push(venueMapImage);
  const largeByCreator: Record<string, string[]> = {};
  for (const c of creators) {
    const ps = postsForCreator(c, byHandle);
    if (ps.length === 0) continue;
    offlineUrls.push(`/creator/${encodeURIComponent(c.id)}/`);
    const large: string[] = [];
    for (const p of ps) {
      for (const m of p.media) {
        if (m.kind !== 'photo') continue;
        offlineUrls.push(m.thumbUrl);
        large.push(m.largeUrl);
      }
    }
    if (large.length > 0) largeByCreator[c.id] = large;
  }

  const meta = VENUE_META[venue];
  return {
    venue,
    label: meta.label,
    hall: meta.hall,
    days: meta.days,
    creators: summaries,
    withOshinagaki: summaries.filter((s) => s.oshinagakiCount > 0).length,
    totalOshinagaki: summaries.reduce((n, s) => n + s.oshinagakiCount, 0),
    offlineUrls: [...new Set(offlineUrls)],
    largeByCreator,
  };
}

/** 詳細ページ用のデータを組み立てる */
export async function buildCreatorDetail(id: string): Promise<CreatorDetail | null> {
  const [creators, posts, curation, extractions] = await Promise.all([
    loadAllCreators(),
    loadPosts(),
    loadCuration(),
    loadExtractions(),
  ]);
  const c = creators.find((x) => x.id === id);
  if (!c) return null;

  // 詳細ページはそのサークルの会場のページなので、その会場のものだけを出す。
  // 東京専用のお品書きが大阪のページに出る、といったことが起きない。
  const adopted = selectPostsForVenue(posts, curation, c.venue);
  const byHandle = indexPostsByHandle(adopted);
  const ps = postsForCreator(c, byHandle);
  const postIds = new Set(ps.map((p) => p.id));
  const exs = extractions.filter((e) => postIds.has(e.postId));

  const postDays: Record<string, string[]> = {};
  for (const p of ps) postDays[p.id] = daysForPost(p, c.venue, c.days);

  // この会場のお品書きがまだ無いサークルには、浜松で頒布されたお品書きを
  // 「参考」として別枠で見せる。確定枠とは絶対に混ぜない
  // （混ぜると「載っているものは全部その会場のお品書き」が崩れる）。
  const handles = new Set(c.xHandles.map((h) => h.toLowerCase()));
  const referencePosts =
    ps.length > 0
      ? []
      : postsForCreator(
          c,
          indexPostsByHandle(
            selectReferencePostsForVenue(posts, curation, c.venue, (h) => handles.has(h)),
          ),
        );

  return {
    ...toSummary(c, ps, exs),
    members: c.members,
    note: c.note,
    posts: ps,
    items: exs,
    postDays,
    referencePosts,
  };
}

/** 全サークルの ID（generateStaticParams 用） */
export async function allCreatorIds(): Promise<string[]> {
  return (await loadAllCreators()).map((c) => c.id);
}
