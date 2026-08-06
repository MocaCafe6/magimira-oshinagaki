/**
 * X 内部 GraphQL レスポンスから投稿を取り出す。
 *
 * 設計方針: `data.search_by_raw_query.search_timeline.timeline.instructions[...]`
 * のような固定パスをハードコードしない。X はラッパー構造を頻繁に変えるため、
 * JSON を深さ優先で走査して「ツイートに見えるオブジェクト」を集める。
 * ツイート自体の形（rest_id + legacy.full_text）は long-lived なので、
 * この方式のほうが構造変更に耐える。
 */

import type { MediaKind, Post, PostMedia } from './types';

type Json = unknown;

function isObj(v: Json): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: Json): string | null {
  return typeof v === 'string' ? v : null;
}

function num(v: Json): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** obj.a.b.c を安全に辿る */
function dig(root: Json, ...path: string[]): Json {
  let cur: Json = root;
  for (const k of path) {
    if (!isObj(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

/** 最初に値が取れたパスを採用する（X はフィールド位置をよく動かす） */
function digAny(root: Json, paths: string[][]): Json {
  for (const p of paths) {
    const v = dig(root, ...p);
    if (v !== undefined && v !== null) return v;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ツイートノードの収集
// ---------------------------------------------------------------------------

/** ツイート実体（TweetWithVisibilityResults は .tweet に包まれている）を剥がす */
function unwrapTweet(v: Json): Record<string, Json> | null {
  if (!isObj(v)) return null;
  const typename = str(v['__typename']);
  if (typename === 'TweetWithVisibilityResults') {
    return unwrapTweet(v['tweet']);
  }
  // __typename が付かないケースもあるので、形で判定する
  const hasId = typeof v['rest_id'] === 'string';
  const hasLegacy = isObj(v['legacy']);
  if (hasId && hasLegacy) return v;
  if (typename === 'Tweet' && hasLegacy) return v;
  return null;
}

/**
 * JSON 全体を走査してツイートノードを集める。
 * 同じツイートが複数箇所に現れることがあるので rest_id で重複排除する。
 */
export function collectTweetNodes(root: Json): Record<string, Json>[] {
  const found = new Map<string, Record<string, Json>>();
  const seen = new Set<Json>();

  const walk = (v: Json, depth: number): void => {
    if (depth > 40 || v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);

    const tweet = unwrapTweet(v);
    if (tweet) {
      const id = str(tweet['rest_id']);
      if (id && !found.has(id)) found.set(id, tweet);
      // ツイート内の引用ツイートも走査対象にする（後段でフィルタする）
    }

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else {
      for (const key of Object.keys(v)) walk((v as Record<string, Json>)[key], depth + 1);
    }
  };

  walk(root, 0);
  return [...found.values()];
}

/**
 * 固定ツイートの ID を集める。
 * UserTweets は `TimelinePinEntry` 命令、または entryId に "pinned" を含む
 * エントリで固定ツイートを表す。
 */
export function collectPinnedIds(root: Json): Set<string> {
  const ids = new Set<string>();
  const seen = new Set<Json>();

  const collectIdsBeneath = (v: Json, depth: number): void => {
    if (depth > 20 || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      for (const item of v) collectIdsBeneath(item, depth + 1);
      return;
    }
    const o = v as Record<string, Json>;
    const t = unwrapTweet(o);
    if (t) {
      const id = str(t['rest_id']);
      if (id) ids.add(id);
    }
    for (const key of Object.keys(o)) collectIdsBeneath(o[key], depth + 1);
  };

  const walk = (v: Json, depth: number): void => {
    if (depth > 40 || v === null || typeof v !== 'object') return;
    if (seen.has(v)) return;
    seen.add(v);

    if (!Array.isArray(v)) {
      const o = v as Record<string, Json>;
      const type = str(o['type']) ?? '';
      const entryId = str(o['entryId']) ?? '';
      if (type === 'TimelinePinEntry' || /pin/i.test(entryId)) {
        collectIdsBeneath(o, 0);
      }
    }

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
    } else {
      for (const key of Object.keys(v)) walk((v as Record<string, Json>)[key], depth + 1);
    }
  };

  walk(root, 0);
  return ids;
}

// ---------------------------------------------------------------------------
// メディア
// ---------------------------------------------------------------------------

/**
 * pbs.twimg.com の URL から各サイズのバリアントを組む。
 *   https://pbs.twimg.com/media/Gabc123.jpg
 *   → https://pbs.twimg.com/media/Gabc123?format=jpg&name=orig
 */
export function buildMediaUrls(mediaUrlHttps: string): {
  baseUrl: string;
  thumbUrl: string;
  largeUrl: string;
  origUrl: string;
  apiUrl: string;
} {
  const noQuery = mediaUrlHttps.split('?')[0]!;
  const m = /^(.*)\.(jpg|jpeg|png|gif|webp)$/i.exec(noQuery);
  const baseUrl = m ? m[1]! : noQuery;
  const format = (m ? m[2]! : 'jpg').toLowerCase() === 'jpeg' ? 'jpg' : (m ? m[2]! : 'jpg').toLowerCase();
  const v = (name: string) => `${baseUrl}?format=${format}&name=${name}`;
  return {
    baseUrl,
    thumbUrl: v('small'),
    largeUrl: v('large'),
    // 原寸表示用。アップロード時の解像度がそのまま返る
    origUrl: v('orig'),
    // Claude API 入力用。orig は稀に API の上限を超えるので固定上限をかける
    apiUrl: v('4096x4096'),
  };
}

function toMediaKind(t: string | null): MediaKind {
  if (t === 'video') return 'video';
  if (t === 'animated_gif') return 'animated_gif';
  return 'photo';
}

function extractMedia(tweet: Record<string, Json>, tweetUrl: string): PostMedia[] {
  const raw =
    digAny(tweet, [
      ['legacy', 'extended_entities', 'media'],
      ['legacy', 'entities', 'media'],
    ]) ?? [];
  if (!Array.isArray(raw)) return [];

  const out: PostMedia[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!isObj(item)) continue;
    const url = str(item['media_url_https']);
    if (!url) continue;
    const urls = buildMediaUrls(url);
    if (seen.has(urls.baseUrl)) continue;
    seen.add(urls.baseUrl);

    const kind = toMediaKind(str(item['type']));
    out.push({
      ...urls,
      kind,
      altText: str(item['ext_alt_text']),
      width: num(dig(item, 'original_info', 'width')) ?? 0,
      height: num(dig(item, 'original_info', 'height')) ?? 0,
      videoUrl: kind === 'photo' ? null : tweetUrl,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 本文
// ---------------------------------------------------------------------------

/**
 * 本文を組む。
 * - 長文投稿は note_tweet 側に全文がある
 * - t.co を展開URLに置換して読めるようにする
 * - 末尾の画像用 t.co リンクを落とす
 */
export function extractText(tweet: Record<string, Json>): string {
  let text =
    str(digAny(tweet, [
      ['note_tweet', 'note_tweet_results', 'result', 'text'],
      ['legacy', 'full_text'],
      ['legacy', 'text'],
    ])) ?? '';

  // t.co → 展開URL
  const urlEntities = digAny(tweet, [
    ['note_tweet', 'note_tweet_results', 'result', 'entity_set', 'urls'],
    ['legacy', 'entities', 'urls'],
  ]);
  if (Array.isArray(urlEntities)) {
    for (const e of urlEntities) {
      if (!isObj(e)) continue;
      const short = str(e['url']);
      const expanded = str(e['expanded_url']);
      if (short && expanded) text = text.split(short).join(expanded);
    }
  }

  // 画像に対応する t.co リンクは本文の末尾に付くだけなので落とす
  const mediaEntities = digAny(tweet, [
    ['legacy', 'extended_entities', 'media'],
    ['legacy', 'entities', 'media'],
  ]);
  if (Array.isArray(mediaEntities)) {
    for (const e of mediaEntities) {
      if (!isObj(e)) continue;
      const short = str(e['url']);
      if (short) text = text.split(short).join('');
    }
  }

  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+$/gm, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Post への変換
// ---------------------------------------------------------------------------

/** X の created_at ("Wed Aug 05 12:34:56 +0000 2026") を ISO にする */
function toIso(raw: string | null): string | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString();
}

/** 投稿主のハンドルを取り出す。X はこのフィールドの位置を何度も動かしている */
export function extractHandle(tweet: Record<string, Json>): string | null {
  return str(
    digAny(tweet, [
      ['core', 'user_results', 'result', 'core', 'screen_name'],
      ['core', 'user_results', 'result', 'legacy', 'screen_name'],
      ['author', 'core', 'screen_name'],
      ['legacy', 'user', 'screen_name'],
    ]),
  );
}

export type RawPost = Omit<Post, 'score' | 'matchedSignals' | 'attribution'>;

/**
 * ツイートノードを RawPost に変換する。
 * スコアリングは呼び出し側で行う（純関数を分離しておく）。
 */
export function toRawPost(
  tweet: Record<string, Json>,
  opts: { pinnedIds: Set<string>; source: 'search' | 'timeline' | 'manual' },
): RawPost | null {
  const id = str(tweet['rest_id']);
  if (!id) return null;
  const handle = extractHandle(tweet);
  if (!handle) return null;
  const createdAt = toIso(str(dig(tweet, 'legacy', 'created_at')));
  if (!createdAt) return null;

  const url = `https://x.com/${handle}/status/${id}`;
  const text = extractText(tweet);

  const isRetweet =
    dig(tweet, 'legacy', 'retweeted_status_result') !== undefined || /^RT @/.test(text);
  const isReply =
    str(dig(tweet, 'legacy', 'in_reply_to_status_id_str')) !== null ||
    str(dig(tweet, 'legacy', 'in_reply_to_screen_name')) !== null;

  return {
    id,
    handle,
    url,
    text,
    createdAt,
    media: extractMedia(tweet, url),
    isPinned: opts.pinnedIds.has(id),
    isReply,
    isRetweet,
    isManual: opts.source === 'manual',
    source: opts.source,
  };
}

/**
 * レスポンス JSON 群から、指定ハンドルの投稿だけを取り出す。
 * 引用ツイートや「関連する投稿」で他人の投稿が混ざるので必ず絞る。
 */
export function extractPostsForHandle(
  responses: Json[],
  handle: string,
  source: 'search' | 'timeline',
): RawPost[] {
  const wanted = handle.toLowerCase();
  const pinnedIds = new Set<string>();
  for (const r of responses) {
    for (const id of collectPinnedIds(r)) pinnedIds.add(id);
  }

  const byId = new Map<string, RawPost>();
  for (const r of responses) {
    for (const node of collectTweetNodes(r)) {
      const post = toRawPost(node, { pinnedIds, source });
      if (!post) continue;
      if (post.handle.toLowerCase() !== wanted) continue;
      // 同じ投稿が検索とタイムラインの両方に出たら、情報が多い方を残す
      const prev = byId.get(post.id);
      if (!prev || post.media.length > prev.media.length || (post.isPinned && !prev.isPinned)) {
        byId.set(post.id, { ...post, isPinned: post.isPinned || (prev?.isPinned ?? false) });
      }
    }
  }
  return [...byId.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

/** ツイートURLから ID とハンドルを取り出す（手動追加用） */
export function parseTweetUrl(raw: string): { handle: string; id: string } | null {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com' && host !== 'mobile.twitter.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    const si = parts.findIndex((p) => p === 'status' || p === 'statuses');
    if (si < 1) return null;
    const handle = parts[si - 1]!;
    const id = parts[si + 1];
    if (!id || !/^\d+$/.test(id)) return null;
    return { handle, id };
  } catch {
    return null;
  }
}
