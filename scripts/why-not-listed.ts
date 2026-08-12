/**
 * 未掲載のブースについて「なぜ載っていないか」を1件ずつ具体的に出す。
 *
 *   npm run why-not-listed -- --venue osaka
 *   npm run why-not-listed -- --venue tokyo --kind sponsor
 *
 * 分類だけでは判断できないので、落ちた投稿の本文と、
 * どの関門で落ちたかを並べる。人がこれを読んで、載せるべきものは
 * data/curation.json の manualVenues に書いて載せる。
 *
 * 出す情報:
 *   ハンドルの有無 / 取得できている投稿数
 *   マジミラの投稿数 / 画像つきの数 / score>=50 の数
 *   落ちた理由（会場未確定なら判定根拠も、内容判定なら該当した関門を）
 */
import {
  isMagimiraPost,
  isOshinagakiPost,
  isProductPost,
  selectPostsForVenue,
  selectReferencePostsForVenue,
} from './lib/curation';
import { dataPath, readJson } from './lib/io';
import type { Creator, Curation, Post, Venue } from './lib/types';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** その投稿が落ちた最初の関門を返す */
function whyDropped(p: Post, venue: Venue): string {
  if (p.isRetweet) return 'リツイート';
  if (p.isReply) return 'リプライ';
  if (!p.media.some((m) => m.kind === 'photo')) return '画像が無い';
  if (!isMagimiraPost(p)) return 'マジカルミライの投稿ではない';
  if (p.score < 50) return `お品書きらしさが閾値未満（score ${p.score}）`;
  const oshi = isOshinagakiPost(p);
  const prod = isProductPost(p);
  if (!oshi && !prod) {
    return p.imageIsOshinagaki === false
      ? '画像を見てお品書きでないと確認済み'
      : '本文がお品書きでも商品紹介でもなく、画像も未確認';
  }
  const proven = p.attribution?.provenVenues ?? [];
  if (!proven.includes(venue)) {
    if (proven.length === 0) {
      return `会場が未確定（${p.attribution?.evidence[0] ?? '根拠なし'}）`;
    }
    return `別の会場と確定している（${proven.join(',')}）`;
  }
  return '（落ちていない）';
}

async function main(): Promise<void> {
  const onlyVenue = arg('--venue');
  const onlyKind = arg('--kind');
  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const curation = await readJson<Curation>(dataPath('curation.json'), {
    updatedAt: new Date(0).toISOString(),
    excludedHandles: [],
    verdicts: {},
    manualVenues: {},
  });

  for (const v of ['osaka', 'tokyo'] as Venue[]) {
    if (onlyVenue && v !== onlyVenue) continue;
    for (const kind of ['creators', 'sponsors']) {
      if (onlyKind && !kind.startsWith(onlyKind)) continue;
      const list = await readJson<Creator[]>(dataPath(`${kind}.${v}.json`), []);
      for (const c of list) {
        const hs = (c.xHandles ?? []).map((h) => h.toLowerCase());
        const mine = posts.filter((p) => hs.includes(p.handle.toLowerCase()));
        if (selectPostsForVenue(mine, curation, v).length > 0) continue;

        const ref = selectReferencePostsForVenue(mine, curation, v, () => true);
        const magimira = mine.filter((p) => isMagimiraPost(p));
        const withPhoto = magimira.filter((p) => p.media.some((m) => m.kind === 'photo'));
        const cand = withPhoto.filter((p) => p.score >= 50);

        console.log(
          `\n■ ${v} ${String(c.boothId).padEnd(6)}${c.circleName}` +
            `${hs.length === 0 ? '  【Xハンドル無し】' : ''}`,
        );
        if (hs.length > 0) {
          console.log(
            `   @${hs.join(', @')}  投稿${mine.length} / マジミラ${magimira.length} / 画像つき${withPhoto.length} / 候補${cand.length}  参考枠${ref.length}`,
          );
        }
        if (mine.length === 0 && hs.length > 0) {
          console.log('   → そのハンドルの投稿が1件も取れていない');
          continue;
        }
        // 惜しいものから順に3件
        const ranked = [...(cand.length > 0 ? cand : withPhoto.length > 0 ? withPhoto : magimira)]
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
        if (ranked.length === 0) {
          console.log('   → マジカルミライに触れた投稿が無い');
          continue;
        }
        for (const p of ranked) {
          console.log(`   ・${whyDropped(p, v)}`);
          console.log(`     ${p.createdAt.slice(0, 10)} ${p.text.replace(/\s+/g, ' ').slice(0, 88)}`);
          console.log(`     https://x.com/${p.handle}/status/${p.id}`);
        }
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
