/**
 * 掲載中の投稿について「画像を取りこぼしていないか」を X 側と突き合わせる。
 *
 *   npm run audit-media               … 掲載中の投稿を照合して差分を報告する
 *   npm run audit-media -- --fix      … 足りない画像を data/posts.json に補う
 *   npm run audit-media -- --all      … 掲載中に限らずレビュー候補すべてを見る
 *   npm run audit-media -- --limit 50 … 先頭 N 件だけ
 *
 * ## なぜ必要か
 *
 * お品書きを4枚組で出すサークルは多い（1枚目が一覧、2枚目以降が価格表や
 * 注意事項）。ところが**1枚しか載っていない**投稿が実際にあった。
 * クロールは検索結果や固定ツイートの GraphQL から画像を拾うが、
 * 応答の形によっては1枚しか入っていないことがある。1枚目だけでは
 * 「何がいくらで買えるか」が読めないので、これは実害のある取りこぼし。
 *
 * 照合には X の公開埋め込みAPI（cdn.syndication.twimg.com）を使う。
 * ログイン不要・セッション不要で、投稿1件ぶんの正しい画像一覧が返る。
 * クロール用のセッションを消費しないので、何度でも安全に回せる。
 */
import { selectPostsForVenue, selectReferencePostsForVenue, selectReviewCandidates } from './lib/curation';
import { dataPath, readJson, sleep, writeJson } from './lib/io';
import { buildMediaUrls } from './lib/x-graphql';
import type { Creator, Curation, Post, PostMedia, Venue } from './lib/types';
import { VENUES } from './lib/types';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

type SyndicationMedia = {
  media_url_https?: string;
  type?: string;
  ext_alt_text?: string | null;
  original_info?: { width?: number; height?: number };
};

/** X の公開埋め込みAPIから、その投稿の画像一覧を取る */
async function fetchMedia(
  id: string,
  postUrl: string,
): Promise<{ ok: true; media: PostMedia[] } | { ok: false; reason: string }> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=a&lang=ja`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  } catch (e) {
    return { ok: false, reason: `取得失敗（${(e as Error).message}）` };
  }
  if (res.status === 404) return { ok: false, reason: '投稿が見つからない（削除・非公開）' };
  if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
  let json: { mediaDetails?: SyndicationMedia[] };
  try {
    json = (await res.json()) as { mediaDetails?: SyndicationMedia[] };
  } catch {
    return { ok: false, reason: '応答が JSON ではない' };
  }
  const out: PostMedia[] = [];
  const seen = new Set<string>();
  for (const m of json.mediaDetails ?? []) {
    if (!m.media_url_https) continue;
    const urls = buildMediaUrls(m.media_url_https);
    if (seen.has(urls.baseUrl)) continue;
    seen.add(urls.baseUrl);
    const kind = m.type === 'video' ? 'video' : m.type === 'animated_gif' ? 'animated_gif' : 'photo';
    out.push({
      ...urls,
      kind,
      altText: m.ext_alt_text ?? null,
      width: m.original_info?.width ?? 0,
      height: m.original_info?.height ?? 0,
      videoUrl: kind === 'photo' ? null : postUrl,
    });
  }
  return { ok: true, media: out };
}

async function main(): Promise<void> {
  const fix = process.argv.includes('--fix');
  const all = process.argv.includes('--all');
  const limit = arg('--limit') ? Number(arg('--limit')) : Infinity;

  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const curation = await readJson<Curation>(dataPath('curation.json'), {
    updatedAt: '',
    verdicts: {},
    excludedHandles: [],
  });

  // 対象: 実際にサイトに出るもの（確定枠＋参考枠）。--all で候補すべて
  const targetIds = new Set<string>();
  if (all) {
    for (const p of selectReviewCandidates(posts, curation)) targetIds.add(p.id);
  } else {
    const handles = new Set<string>();
    for (const v of VENUES) {
      for (const f of [`creators.${v}.json`, `sponsors.${v}.json`]) {
        for (const c of await readJson<Creator[]>(dataPath(f), [])) {
          for (const h of c.xHandles) handles.add(h.toLowerCase());
        }
      }
    }
    for (const v of VENUES as readonly Venue[]) {
      for (const p of selectPostsForVenue(posts, curation, v)) targetIds.add(p.id);
      for (const p of selectReferencePostsForVenue(posts, curation, v, (h) => handles.has(h))) {
        targetIds.add(p.id);
      }
    }
  }

  const targets = posts.filter((p) => targetIds.has(p.id)).slice(0, limit);
  console.log(`照合対象 ${targets.length}件（${all ? 'レビュー候補すべて' : 'サイトに出るもの'}）\n`);

  const byId = new Map(posts.map((p) => [p.id, p]));
  let missing = 0;
  let gone = 0;
  let failed = 0;

  for (const p of targets) {
    const r = await fetchMedia(p.id, p.url);
    await sleep(250);
    if (!r.ok) {
      if (r.reason.startsWith('投稿が見つからない')) {
        gone++;
        console.log(`  ✗ @${p.handle} ${p.id} — ${r.reason}`);
      } else {
        failed++;
        console.log(`  ? @${p.handle} ${p.id} — ${r.reason}`);
      }
      continue;
    }
    const have = new Set(p.media.map((m) => m.baseUrl));
    const lack = r.media.filter((m) => !have.has(m.baseUrl));
    if (lack.length === 0) continue;
    missing++;
    const photos = (n: PostMedia[]): number => n.filter((m) => m.kind === 'photo').length;
    console.log(
      `  + @${p.handle} ${p.id} — 画像 ${photos(p.media)}枚 → ${photos(r.media)}枚（${lack.length}枚不足）`,
    );
    console.log(`      ${p.text.replace(/\s+/g, ' ').slice(0, 70)}`);
    if (fix) {
      // X の並び順に揃える。1枚目が一覧、2枚目以降が価格表という構成が多く、
      // 順番が入れ替わると読み手が最初に見る画像が変わってしまう。
      const mine = new Map(p.media.map((m) => [m.baseUrl, m]));
      const merged = r.media.map((m) => ({ ...m, ...(mine.get(m.baseUrl) ?? {}) }));
      // X 側に無い画像（取得後に削除されたもの等）は落とさず後ろに残す
      const extra = p.media.filter((m) => !r.media.some((x) => x.baseUrl === m.baseUrl));
      byId.set(p.id, { ...p, media: [...merged, ...extra] });
    }
  }

  console.log(`\n照合 ${targets.length}件`);
  console.log(`  画像が足りない: ${missing}件`);
  if (gone > 0) console.log(`  投稿が消えている: ${gone}件`);
  if (failed > 0) console.log(`  照合できなかった: ${failed}件`);

  if (fix && missing > 0) {
    await writeJson(dataPath('posts.json'), posts.map((p) => byId.get(p.id) ?? p));
    console.log('  → data/posts.json を更新しました');
  } else if (missing > 0) {
    console.log('  --fix を付けると data/posts.json に補います');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
