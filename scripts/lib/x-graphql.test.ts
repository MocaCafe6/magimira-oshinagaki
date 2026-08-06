import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMediaUrls,
  collectPinnedIds,
  collectTweetNodes,
  extractHandle,
  extractPostsForHandle,
  extractText,
  parseTweetUrl,
  toRawPost,
} from './x-graphql';

/** X の実レスポンスを模した入れ子構造 */
function tweetNode(over: {
  id: string;
  handle: string;
  fullText?: string;
  noteText?: string;
  createdAt?: string;
  media?: { url: string; type?: string; alt?: string; w?: number; h?: number }[];
  urls?: { url: string; expanded_url: string }[];
  replyTo?: string;
  retweet?: boolean;
  visibilityWrapped?: boolean;
}) {
  // X の実レスポンスでは media[].url に画像用の t.co 短縮URLが入り、
  // 同じ文字列が full_text の末尾にも現れる。
  const media = (over.media ?? []).map((m, i) => ({
    media_url_https: m.url,
    type: m.type ?? 'photo',
    ext_alt_text: m.alt ?? null,
    original_info: { width: m.w ?? 1200, height: m.h ?? 1600 },
    url: `https://t.co/tco${i}`,
  }));

  const inner: Record<string, unknown> = {
    __typename: 'Tweet',
    rest_id: over.id,
    core: { user_results: { result: { core: { screen_name: over.handle } } } },
    legacy: {
      full_text: over.fullText ?? '',
      created_at: over.createdAt ?? 'Mon Aug 03 09:00:00 +0000 2026',
      entities: { urls: over.urls ?? [], media },
      ...(media.length > 0 ? { extended_entities: { media } } : {}),
      ...(over.replyTo ? { in_reply_to_status_id_str: over.replyTo } : {}),
      ...(over.retweet ? { retweeted_status_result: { result: {} } } : {}),
    },
    ...(over.noteText
      ? { note_tweet: { note_tweet_results: { result: { text: over.noteText, entity_set: { urls: over.urls ?? [] } } } } }
      : {}),
  };

  return over.visibilityWrapped
    ? { __typename: 'TweetWithVisibilityResults', tweet: inner }
    : inner;
}

/** SearchTimeline のラッパー構造 */
function searchResponse(nodes: unknown[]) {
  return {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [
              {
                type: 'TimelineAddEntries',
                entries: nodes.map((n, i) => ({
                  entryId: `tweet-${i}`,
                  content: {
                    entryType: 'TimelineTimelineItem',
                    itemContent: { itemType: 'TimelineTweet', tweet_results: { result: n } },
                  },
                })),
              },
            ],
          },
        },
      },
    },
  };
}

test('buildMediaUrls は各サイズのバリアントを組む', () => {
  const u = buildMediaUrls('https://pbs.twimg.com/media/Gabc123.jpg');
  assert.equal(u.baseUrl, 'https://pbs.twimg.com/media/Gabc123');
  assert.equal(u.thumbUrl, 'https://pbs.twimg.com/media/Gabc123?format=jpg&name=small');
  assert.equal(u.largeUrl, 'https://pbs.twimg.com/media/Gabc123?format=jpg&name=large');
  assert.equal(u.origUrl, 'https://pbs.twimg.com/media/Gabc123?format=jpg&name=orig');
  // Claude API 入力用は上限を固定する（orig は稀に大きすぎる）
  assert.equal(u.apiUrl, 'https://pbs.twimg.com/media/Gabc123?format=jpg&name=4096x4096');
});

test('buildMediaUrls は png と既存クエリを扱う', () => {
  assert.equal(
    buildMediaUrls('https://pbs.twimg.com/media/Gxyz.png').origUrl,
    'https://pbs.twimg.com/media/Gxyz?format=png&name=orig',
  );
  // すでにクエリが付いていても壊れない
  assert.equal(
    buildMediaUrls('https://pbs.twimg.com/media/Gxyz.jpg?name=small').baseUrl,
    'https://pbs.twimg.com/media/Gxyz',
  );
  // jpeg は jpg に正規化する
  assert.equal(
    buildMediaUrls('https://pbs.twimg.com/media/Gxyz.jpeg').origUrl,
    'https://pbs.twimg.com/media/Gxyz?format=jpg&name=orig',
  );
});

test('collectTweetNodes は深い入れ子からツイートを掘り出す', () => {
  const res = searchResponse([
    tweetNode({ id: '111', handle: 'nulut', fullText: 'a' }),
    tweetNode({ id: '222', handle: 'nulut', fullText: 'b' }),
  ]);
  const nodes = collectTweetNodes(res);
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map((n) => n['rest_id']).sort(), ['111', '222']);
});

test('collectTweetNodes は TweetWithVisibilityResults を剥がす', () => {
  const res = searchResponse([
    tweetNode({ id: '333', handle: 'nulut', fullText: 'c', visibilityWrapped: true }),
  ]);
  const nodes = collectTweetNodes(res);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!['rest_id'], '333');
});

test('collectTweetNodes は未知のラッパー構造でも動く（構造変更への耐性）', () => {
  // X が将来ラッパーのキー名を変えても、ツイート自体の形が同じなら拾える
  const weird = {
    data: { some_new_wrapper: { v2: { blobs: [{ payload: { result: tweetNode({ id: '444', handle: 'nulut' }) } }] } } },
  };
  const nodes = collectTweetNodes(weird);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]!['rest_id'], '444');
});

test('collectPinnedIds は TimelinePinEntry から固定ツイートを特定する', () => {
  const res = {
    data: {
      user: {
        result: {
          timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelinePinEntry',
                  entry: {
                    entryId: 'tweet-999',
                    content: { itemContent: { tweet_results: { result: tweetNode({ id: '999', handle: 'nulut' }) } } },
                  },
                },
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    {
                      entryId: 'tweet-111',
                      content: { itemContent: { tweet_results: { result: tweetNode({ id: '111', handle: 'nulut' }) } } },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };
  const pinned = collectPinnedIds(res);
  assert.ok(pinned.has('999'));
  assert.ok(!pinned.has('111'), '通常エントリを固定扱いしない');
});

test('extractText は長文投稿の全文を優先する', () => {
  const node = tweetNode({
    id: '1',
    handle: 'nulut',
    fullText: '短縮された本文…',
    noteText: 'これが全文です。お品書きの詳細がここに入ります。',
  });
  assert.equal(extractText(node as Record<string, unknown>), 'これが全文です。お品書きの詳細がここに入ります。');
});

test('extractText は t.co を展開URLに置換する', () => {
  const node = tweetNode({
    id: '1',
    handle: 'nulut',
    fullText: '通販はこちら https://t.co/abcd',
    urls: [{ url: 'https://t.co/abcd', expanded_url: 'https://example.booth.pm/items/1' }],
  });
  assert.equal(extractText(node as Record<string, unknown>), '通販はこちら https://example.booth.pm/items/1');
});

test('extractText は画像用の t.co リンクを本文から落とす', () => {
  const node = tweetNode({
    id: '1',
    handle: 'nulut',
    fullText: 'お品書きです https://t.co/tco0',
    media: [{ url: 'https://pbs.twimg.com/media/G1.jpg' }],
  });
  const text = extractText(node as Record<string, unknown>);
  assert.ok(!text.includes('t.co'), `t.co が残っている: ${text}`);
  assert.equal(text, 'お品書きです');
});

test('extractText は HTML エンティティを戻す', () => {
  const node = tweetNode({ id: '1', handle: 'nulut', fullText: 'A&amp;B &lt;新刊&gt; &quot;限定&quot;' });
  assert.equal(extractText(node as Record<string, unknown>), 'A&B <新刊> "限定"');
});

test('extractHandle は複数のフィールド位置に対応する', () => {
  // 現行の位置
  assert.equal(
    extractHandle({ core: { user_results: { result: { core: { screen_name: 'newpath' } } } } }),
    'newpath',
  );
  // 旧来の位置（legacy 側）
  assert.equal(
    extractHandle({ core: { user_results: { result: { legacy: { screen_name: 'oldpath' } } } } }),
    'oldpath',
  );
  assert.equal(extractHandle({}), null);
});

test('toRawPost は画像・固定・リプライ・RT を反映する', () => {
  const node = tweetNode({
    id: '555',
    handle: 'nulut',
    fullText: 'マジカルミライのお品書き',
    createdAt: 'Mon Aug 03 09:00:00 +0000 2026',
    media: [
      { url: 'https://pbs.twimg.com/media/G1.jpg', alt: 'お品書き1', w: 1448, h: 2048 },
      { url: 'https://pbs.twimg.com/media/G2.jpg' },
    ],
  }) as Record<string, unknown>;

  const post = toRawPost(node, { pinnedIds: new Set(['555']), source: 'search' })!;
  assert.equal(post.id, '555');
  assert.equal(post.handle, 'nulut');
  assert.equal(post.url, 'https://x.com/nulut/status/555');
  assert.equal(post.createdAt, '2026-08-03T09:00:00.000Z');
  assert.equal(post.isPinned, true);
  assert.equal(post.isReply, false);
  assert.equal(post.isRetweet, false);
  assert.equal(post.source, 'search');
  assert.equal(post.media.length, 2);
  assert.equal(post.media[0]!.altText, 'お品書き1');
  assert.equal(post.media[0]!.width, 1448);
  assert.equal(post.media[0]!.origUrl, 'https://pbs.twimg.com/media/G1?format=jpg&name=orig');
});

test('toRawPost はリプライと RT を検知する', () => {
  const reply = toRawPost(
    tweetNode({ id: '1', handle: 'nulut', fullText: 'x', replyTo: '999' }) as Record<string, unknown>,
    { pinnedIds: new Set(), source: 'search' },
  )!;
  assert.equal(reply.isReply, true);

  const rt = toRawPost(
    tweetNode({ id: '2', handle: 'nulut', fullText: 'RT @other: x', retweet: true }) as Record<string, unknown>,
    { pinnedIds: new Set(), source: 'search' },
  )!;
  assert.equal(rt.isRetweet, true);
});

test('toRawPost は必須項目が欠けたノードを捨てる', () => {
  assert.equal(toRawPost({ rest_id: '1' }, { pinnedIds: new Set(), source: 'search' }), null);
  // ハンドルが取れない
  assert.equal(
    toRawPost({ rest_id: '1', legacy: { created_at: 'Mon Aug 03 09:00:00 +0000 2026' } }, { pinnedIds: new Set(), source: 'search' }),
    null,
  );
});

test('extractPostsForHandle は他人の投稿を除外する', () => {
  const res = searchResponse([
    tweetNode({ id: '1', handle: 'nulut', fullText: '自分の投稿' }),
    // 引用や関連投稿で混ざってくる他人の投稿
    tweetNode({ id: '2', handle: 'someone_else', fullText: '他人の投稿' }),
  ]);
  const posts = extractPostsForHandle([res], 'nulut', 'search');
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.id, '1');
});

test('extractPostsForHandle はハンドルの大小文字差を吸収する', () => {
  const res = searchResponse([tweetNode({ id: '1', handle: 'HeavenzP', fullText: 'x' })]);
  assert.equal(extractPostsForHandle([res], 'heavenzp', 'search').length, 1);
});

test('extractPostsForHandle は重複を排除し情報の多い方を残す', () => {
  // 検索結果には画像なし、タイムラインには画像あり＋固定 という状況
  const withoutMedia = searchResponse([tweetNode({ id: '1', handle: 'nulut', fullText: 'x' })]);
  const withMedia = {
    data: {
      user: { result: { timeline: { timeline: { instructions: [
        { type: 'TimelinePinEntry', entry: { entryId: 'tweet-1', content: { itemContent: { tweet_results: {
          result: tweetNode({ id: '1', handle: 'nulut', fullText: 'x', media: [{ url: 'https://pbs.twimg.com/media/G1.jpg' }] }),
        } } } } },
      ] } } } },
    },
  };
  const posts = extractPostsForHandle([withoutMedia, withMedia], 'nulut', 'search');
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.media.length, 1, '画像がある方を残す');
  assert.equal(posts[0]!.isPinned, true, '固定情報を失わない');
});

test('extractPostsForHandle は新しい順に並べる', () => {
  const res = searchResponse([
    tweetNode({ id: '1', handle: 'nulut', createdAt: 'Mon Aug 03 09:00:00 +0000 2026' }),
    tweetNode({ id: '2', handle: 'nulut', createdAt: 'Wed Aug 05 09:00:00 +0000 2026' }),
  ]);
  assert.deepEqual(extractPostsForHandle([res], 'nulut', 'search').map((p) => p.id), ['2', '1']);
});

test('parseTweetUrl はツイートURLを分解する', () => {
  assert.deepEqual(parseTweetUrl('https://x.com/nulut/status/1234567890'), { handle: 'nulut', id: '1234567890' });
  assert.deepEqual(parseTweetUrl('https://twitter.com/nulut/status/1234567890?s=20'), { handle: 'nulut', id: '1234567890' });
  assert.equal(parseTweetUrl('https://x.com/nulut'), null);
  assert.equal(parseTweetUrl('https://example.com/nulut/status/1'), null);
  assert.equal(parseTweetUrl('nonsense'), null);
});
