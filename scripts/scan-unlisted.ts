/**
 * 「その会場のお品書きがまだ載っていないサークル」を洗い出し、
 * 目視で確かめるべき投稿を層に分けて並べる。
 *
 *   npm run scan-unlisted -- --venue tokyo
 *   npm run scan-unlisted -- --venue tokyo --tier A,B   … 層を絞る
 *   npm run scan-unlisted -- --venue tokyo --ids        … 投稿IDだけを出す
 *
 * 出てきた ID を fetch-images-for-review --ids に渡し、
 * make-review-sheets でシートにして目で見る。
 *
 * why-not-listed は「なぜ落ちたか」を1件ずつ人に読ませる道具。
 * こちらは「次に何を見るか」を機械的に決めるための道具。
 *
 * ## 層を分ける理由（2026-08-25 の東京走査で分かったこと）
 *
 * 最初は「東京と確定済み(A)」と「未確定かつ最近か東京に言及(B)」だけを
 * 見た。147枚見て収穫は2件。**残りの4件は見なかった層にあった**。
 *
 *   C 未確定・会場に言及なし・会期前  → imie / 海風太陽 の3会場共通お品書き
 *   N 本文にマジミラの語が無い        → 森羅盤商会 / やみくろ のお品書き
 *   O 別会場と確定している            → ねじ式 の3会場共通お品書き
 *
 * 三会場に出るサークルは「浜松 D-10 / 大阪 C-2 / 東京 D-2」と**画像に**
 * 並記した1枚を使い回す。本文はその時いちばん近い会場のことしか書かない。
 * だから本文起点の絞り込み（B）では東京のお品書きに届かない。
 * 見落としたくないなら層を絞らずに全部見ること。
 */
import { isMagimiraPost, selectPostsForVenue } from './lib/curation';
import { dataPath, readJson } from './lib/io';
import type { Creator, Curation, Post, Venue } from './lib/types';

/** 本文がその会場に触れているか */
const VENUE_RE: Record<Venue, RegExp> = {
  osaka: /大阪|OSAKA|osaka|Osaka|インテックス/,
  tokyo: /東京|TOKYO|tokyo|Tokyo|幕張/,
};

type Tier = 'A' | 'B' | 'C' | 'N' | 'O';

const TIER_LABEL: Record<Tier, string> = {
  A: 'A 会場は確定済み。画像がお品書きだと分かれば掲載になる',
  B: 'B 会場が未確定。会期が近い、または本文がこの会場に触れている',
  C: 'C 会場が未確定。本文はこの会場に触れていない（3会場共通のお品書きがここに紛れる）',
  N: 'N 本文にマジカルミライの語が無い（画像にだけ書いてあることがある）',
  O: '別の会場のものだと確定している（画像が複数会場を並記していないか）',
};

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** その投稿がどの層か。見ない理由がある投稿は null */
function tierOf(p: Post, venue: Venue, since: string): Tier | null {
  if (p.isRetweet || p.isReply) return null;
  if (!p.media.some((m) => m.kind === 'photo')) return null;
  if (p.imageIsOshinagaki !== undefined) return null; // もう読んである
  if (!isMagimiraPost(p)) return 'N';
  const proven = p.attribution?.provenVenues ?? [];
  if (proven.includes(venue)) return 'A';
  if (proven.length > 0) return 'O';
  const text = [p.text, ...p.media.map((m) => m.altText ?? '')].join(' ');
  return p.createdAt.slice(0, 10) >= since || VENUE_RE[venue].test(text) ? 'B' : 'C';
}

async function main(): Promise<void> {
  const venue = (arg('--venue') ?? 'tokyo') as Venue;
  // 既定は大阪の会期が終わった翌日。ここから先の投稿は東京に向けたもの
  const since = arg('--since') ?? '2026-08-17';
  const tiers = new Set(
    (arg('--tier') ?? 'A,B,C,N,O').split(',').map((s) => s.trim().toUpperCase()) as Tier[],
  );
  const idsOnly = process.argv.includes('--ids');

  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const curation = await readJson<Curation>(dataPath('curation.json'), {
    updatedAt: '',
    verdicts: {},
    excludedHandles: [],
  });
  const creators = [
    ...(await readJson<Creator[]>(dataPath(`creators.${venue}.json`), [])),
    ...(await readJson<Creator[]>(dataPath(`sponsors.${venue}.json`), [])),
  ];

  const listed = new Set(
    selectPostsForVenue(posts, curation, venue).map((p) => p.handle.toLowerCase()),
  );

  const byHandle = new Map<string, Post[]>();
  for (const p of posts) {
    const k = p.handle.toLowerCase();
    byHandle.set(k, [...(byHandle.get(k) ?? []), p]);
  }

  type Row = { booth: string; name: string; tier: Tier; post: Post };
  const rows: Row[] = [];
  const noHandle: string[] = [];
  const nothingToSee: string[] = [];
  let unlisted = 0;

  for (const c of creators) {
    const handles = c.xHandles.map((h) => h.toLowerCase());
    if (handles.some((h) => listed.has(h))) continue; // もう載っている
    unlisted++;

    const label = `${c.boothId ?? '—'} ${c.circleName}`;
    if (handles.length === 0) {
      noHandle.push(`${label}`);
      continue;
    }

    const seen = new Set<string>();
    const cands: Row[] = [];
    for (const h of handles) {
      for (const p of byHandle.get(h) ?? []) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        const tier = tierOf(p, venue, since);
        if (tier && tiers.has(tier)) {
          cands.push({ booth: c.boothId ?? '—', name: c.circleName, tier, post: p });
        }
      }
    }
    // 層の順、その中では新しい順
    const order: Tier[] = ['A', 'B', 'C', 'N', 'O'];
    cands.sort(
      (a, b) =>
        order.indexOf(a.tier) - order.indexOf(b.tier) ||
        (a.post.createdAt < b.post.createdAt ? 1 : -1),
    );

    if (cands.length === 0) {
      nothingToSee.push(`${label} @${c.xHandles.join(',')}`);
      continue;
    }
    rows.push(...cands);
  }

  if (idsOnly) {
    console.log([...new Set(rows.map((r) => r.post.id))].join(','));
    return;
  }

  const booths = new Set(rows.map((r) => r.booth));
  console.log(`${venue} で「この会場のお品書きが載っていない」サークル: ${unlisted}件`);
  console.log(`  目視の対象がある: ${booths.size}ブース / 画像 ${rows.length}枚`);
  console.log(`  見るべき投稿が無い: ${nothingToSee.length}件`);
  console.log(`  X ハンドルが無い: ${noHandle.length}件`);
  const byTier = new Map<Tier, number>();
  for (const r of rows) byTier.set(r.tier, (byTier.get(r.tier) ?? 0) + 1);
  for (const t of ['A', 'B', 'C', 'N', 'O'] as Tier[]) {
    if (byTier.has(t)) console.log(`    ${TIER_LABEL[t]} … ${byTier.get(t)}枚`);
  }

  let cur = '';
  for (const r of rows) {
    if (r.booth !== cur) {
      cur = r.booth;
      console.log(`\n■ ${r.booth} ${r.name}`);
    }
    console.log(
      `   [${r.tier}] ${r.post.createdAt.slice(0, 10)} @${r.post.handle} ${r.post.id} score${r.post.score}`,
    );
    console.log(`      ${r.post.text.replace(/\s+/g, ' ').slice(0, 70)}`);
  }

  console.log(`\n── 見るべき投稿が無い（${nothingToSee.length}）`);
  for (const s of nothingToSee) console.log(`  ${s}`);
  console.log(`\n── X ハンドルが無い（${noHandle.length}）`);
  for (const s of noHandle) console.log(`  ${s}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
