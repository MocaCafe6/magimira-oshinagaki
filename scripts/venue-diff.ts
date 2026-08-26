/**
 * 「会場ごとにお品書きが違うサークル」を洗い出し、
 * その会場の最新版がちゃんと出ているかを点検する。
 *
 *   npm run venue-diff                 … 東京を基準に点検する
 *   npm run venue-diff -- --venue osaka
 *   npm run venue-diff -- --ids        … 目視すべき投稿IDだけを出す
 *
 * ## なぜ必要か
 *
 * 三会場に出るサークルには2種類ある。
 *   ① 1枚のお品書きを使い回す（画像に3会場を並記している）
 *   ② 会場ごとに別のお品書きを出す（品揃えも在庫も違う）
 *
 * ②で厄介なのは、**片方の会場ぶんだけ拾えている状態**が正常に見えること。
 * 実例: グッドスマイルカンパニーは「イベント情報更新」という同じ書き方で
 * 会場ごとに物販一覧を出す。大阪ぶんは画像を読んであるので載っていたが、
 * 東京ぶん（8/25投稿）は未読で、東京ページが空のままだった。
 * 掲載件数だけを見ていると「大阪は載っている」で満足してしまう。
 *
 * そこで会場をまたいで突き合わせ、次を洗い出す:
 *   - この会場だけ0件（他会場には出ている）
 *   - この会場に出ているのが全会場共通の投稿だけで、他会場には会場名入りがある
 *   - この会場の掲載が、他会場の掲載より古い
 *   - 表示の先頭が最新でない（固定ツイートやスコアが古い投稿を押し上げている）
 */
import { isOshinagakiPost, selectPostsForVenue } from './lib/curation';
import { dataPath, readJson } from './lib/io';
import { loadReviewLog } from './lib/review-log';
import type { Creator, Curation, Post, Venue } from './lib/types';
import { VENUES } from './lib/types';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** その投稿の会場帰属は「この会場を名指ししている」か「全会場共通」か */
function scopeOf(p: Post): '会場指定' | '全会場共通' {
  const s = p.attribution?.source;
  return s === 'event-wide' || s === 'sole-venue' ? '全会場共通' : '会場指定';
}

const dateOf = (p: Post): string => p.createdAt.slice(0, 10);

async function main(): Promise<void> {
  const venue = (arg('--venue') ?? 'tokyo') as Venue;
  const other = VENUES.filter((v) => v !== venue);
  const idsOnly = process.argv.includes('--ids');
  const reviewed = process.argv.includes('--include-reviewed')
    ? new Set<string>()
    : await loadReviewLog();

  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const curation = await readJson<Curation>(dataPath('curation.json'), {
    updatedAt: '',
    verdicts: {},
    excludedHandles: [],
  });

  const shownBy = new Map<Venue, Post[]>();
  for (const v of VENUES) shownBy.set(v, selectPostsForVenue(posts, curation, v));

  const creators: Creator[] = [
    ...(await readJson<Creator[]>(dataPath(`creators.${venue}.json`), [])),
    ...(await readJson<Creator[]>(dataPath(`sponsors.${venue}.json`), [])),
  ];

  const byHandle = new Map<string, Post[]>();
  for (const p of posts) {
    const k = p.handle.toLowerCase();
    byHandle.set(k, [...(byHandle.get(k) ?? []), p]);
  }

  type Finding = { booth: string; name: string; flag: string; detail: string; toRead: Post[] };
  const findings: Finding[] = [];

  for (const c of creators) {
    const handles = c.xHandles.map((h) => h.toLowerCase());
    if (handles.length === 0) continue;
    const mine = (list: Post[]): Post[] =>
      list.filter((p) => handles.includes(p.handle.toLowerCase()));

    const here = mine(shownBy.get(venue) ?? []);
    const there = other.flatMap((v) => mine(shownBy.get(v) ?? []));
    // 他会場にも出ていないサークルは scan-unlisted の担当。ここでは扱わない
    if (here.length === 0 && there.length === 0) continue;

    // まだ画像を読んでいない、この会場向けかもしれない投稿
    const unread = handles
      .flatMap((h) => byHandle.get(h) ?? [])
      .filter(
        (p) =>
          !p.isRetweet &&
          !p.isReply &&
          p.media.some((m) => m.kind === 'photo') &&
          p.imageIsOshinagaki === undefined &&
          !reviewed.has(p.id) &&
          !here.some((x) => x.id === p.id),
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const newestHere = here[0] ? here.map(dateOf).sort().at(-1)! : '';
    const newestThere = there[0] ? there.map(dateOf).sort().at(-1)! : '';
    const label = `${c.boothId ?? '—'} ${c.circleName}`;

    // ① この会場だけ0件
    if (here.length === 0) {
      findings.push({
        booth: c.boothId ?? '—',
        name: c.circleName,
        flag: 'この会場だけ0件',
        detail: `他会場には ${there.length}件（最新 ${newestThere}）出ているのに、${venue} は空`,
        toRead: unread.slice(0, 6),
      });
      continue;
    }

    // ② この会場は全会場共通だけ。他会場には会場名入りがある
    const hereSpecific = here.filter((p) => scopeOf(p) === '会場指定');
    const thereSpecific = there.filter((p) => scopeOf(p) === '会場指定');
    if (hereSpecific.length === 0 && thereSpecific.length > 0) {
      findings.push({
        booth: c.boothId ?? '—',
        name: c.circleName,
        flag: '全会場共通だけ',
        detail: `${venue} は全会場共通の投稿 ${here.length}件のみ。他会場には会場名入りが ${thereSpecific.length}件ある`,
        toRead: unread.slice(0, 6),
      });
      continue;
    }

    // ③ この会場の掲載が他会場より古い
    if (newestThere && newestHere < newestThere) {
      findings.push({
        booth: c.boothId ?? '—',
        name: c.circleName,
        flag: 'この会場のほうが古い',
        detail: `${venue} の最新 ${newestHere} / 他会場の最新 ${newestThere}`,
        toRead: unread.filter((p) => dateOf(p) > newestHere).slice(0, 6),
      });
      continue;
    }

    // ④ 表示の先頭が最新でない（固定ツイートやスコアで押し上げられている）
    const listed = here.filter(isOshinagakiPost);
    if (listed.length > 1) {
      const newest = listed.map(dateOf).sort().at(-1)!;
      if (dateOf(listed[0]!) < newest) {
        findings.push({
          booth: c.boothId ?? '—',
          name: c.circleName,
          flag: '先頭が最新でない',
          detail: `先頭は ${dateOf(listed[0]!)}（${listed[0]!.isPinned ? '固定ツイート' : `score${listed[0]!.score}`}）だが、最新のお品書きは ${newest}`,
          toRead: [],
        });
      }
    }
  }

  if (idsOnly) {
    const ids = new Set(findings.flatMap((f) => f.toRead.map((p) => p.id)));
    console.log([...ids].join(','));
    return;
  }

  const byFlag = new Map<string, number>();
  for (const f of findings) byFlag.set(f.flag, (byFlag.get(f.flag) ?? 0) + 1);
  console.log(`${venue} の点検: 気になるブース ${findings.length}件`);
  for (const [k, v] of byFlag) console.log(`  ${k}: ${v}件`);

  findings.sort((a, b) => a.flag.localeCompare(b.flag) || a.booth.localeCompare(b.booth, 'ja', { numeric: true }));
  let cur = '';
  for (const f of findings) {
    if (f.flag !== cur) {
      cur = f.flag;
      console.log(`\n──── ${f.flag} ────`);
    }
    console.log(`\n■ ${f.booth} ${f.name}`);
    console.log(`   ${f.detail}`);
    for (const p of f.toRead) {
      console.log(
        `   見る: ${dateOf(p)} @${p.handle} ${p.id} score${p.score} 画像${p.media.filter((m) => m.kind === 'photo').length}枚 proven=${p.attribution?.provenVenues.join(',') || '-'}`,
      );
      console.log(`        ${p.text.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
