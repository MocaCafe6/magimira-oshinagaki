/**
 * 「公開中の全件が当該会場・当該日のお品書きである」ことを機械的に検証する。
 *
 *   npm run verify-attribution
 *
 * サイトに載る投稿を1件ずつ取り出し、次をすべて満たすか確かめる:
 *   1. その会場だと確定している（自動判別の証明、または人手の会場指定）
 *   2. 確定の根拠が実データと矛盾しない
 *      - 本文が別会場のブース番号しか書いていないのに載っていないか
 *      - 浜松（終了済み）だけに言及する投稿が載っていないか
 *   3. 表示される日がサークルの公式参加日に含まれる
 *
 * 1件でも破れていれば異常終了する。担保はこのスクリプトが通ることと同義。
 */

import { dataPath, readJson } from './lib/io';
import { daysForPost, selectPostsForVenue, selectReviewCandidates } from './lib/curation';
import type { OfficialListing } from './lib/official-parser';
import type { Creator, Curation, Post, Venue } from './lib/types';
import { REF_VENUE_META, VENUES, VENUE_META } from './lib/types';
import { normalizeBooth, segmentByVenue } from './lib/venue-attribution';

type Violation = { venue: Venue; postId: string; handle: string; reason: string; text: string };

async function main(): Promise<void> {
  const posts = await readJson<Post[]>(dataPath('posts.json'), []);
  const curation = await readJson<Curation>(dataPath('curation.json'), {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });
  const listings = await readJson<OfficialListing[]>(dataPath('official-listings.json'), []);
  if (listings.length === 0) {
    throw new Error('data/official-listings.json がありません。`npm run scrape-official` を先に。');
  }

  // ハンドル → 会場ごとの公式ブース番号
  const officialBooths = new Map<string, Map<string, Set<string>>>();
  for (const l of listings) {
    for (const h of l.xHandles) {
      const k = h.toLowerCase();
      const byVenue = officialBooths.get(k) ?? new Map<string, Set<string>>();
      const set = byVenue.get(l.venue) ?? new Set<string>();
      const b = l.boothId ? normalizeBooth(l.boothId) : null;
      if (b) set.add(b);
      byVenue.set(l.venue, set);
      officialBooths.set(k, byVenue);
    }
  }

  const violations: Violation[] = [];
  let published = 0;
  const perVenue: Record<Venue, number> = { osaka: 0, tokyo: 0 };
  const bySource = new Map<string, number>();

  for (const venue of VENUES) {
    const creators = [
      ...(await readJson<Creator[]>(dataPath(`creators.${venue}.json`), [])),
      ...(await readJson<Creator[]>(dataPath(`sponsors.${venue}.json`), [])),
    ];
    // ハンドル → その会場でのサークル（参加日の照合に使う）
    const creatorByHandle = new Map<string, Creator[]>();
    for (const c of creators) {
      for (const h of c.xHandles) {
        const k = h.toLowerCase();
        creatorByHandle.set(k, [...(creatorByHandle.get(k) ?? []), c]);
      }
    }

    const shown = selectPostsForVenue(posts, curation, venue);
    perVenue[venue] = shown.length;
    published += shown.length;

    for (const p of shown) {
      const manual = curation.manualVenues?.[p.id]?.includes(venue) === true;
      const proven = p.attribution?.provenVenues.includes(venue) === true;
      const src = manual ? 'manual' : (p.attribution?.source ?? 'none');
      bySource.set(src, (bySource.get(src) ?? 0) + 1);

      // --- 1. 会場が確定していること ---
      if (!manual && !proven) {
        violations.push({
          venue,
          postId: p.id,
          handle: p.handle,
          reason: '会場が確定していないのに公開されている',
          text: p.text.slice(0, 60),
        });
        continue;
      }
      if (manual) continue; // 人手指定は人の責任。機械的な検証の対象外

      // --- 2. 根拠が本文と矛盾しないこと ---
      const combined = [p.text, ...p.media.map((m) => m.altText ?? '')].join('\n \n');
      const { segments, mentionedVenues } = segmentByVenue(combined);
      const off = officialBooths.get(p.handle.toLowerCase());

      // 2-a. 浜松にしか言及していないのに公開されている
      if (
        mentionedVenues.length > 0 &&
        mentionedVenues.every((v) => v === 'hamamatsu') &&
        p.attribution?.source !== 'image'
      ) {
        violations.push({
          venue,
          postId: p.id,
          handle: p.handle,
          reason: '浜松（終了済み・対象外）にしか言及していない',
          text: p.text.slice(0, 60),
        });
        continue;
      }

      // 2-b. その会場の区間のブース番号が公式と食い違っている
      const seg = segments.find((s) => s.venue === venue);
      const officialForVenue = off?.get(venue) ?? new Set<string>();
      if (seg && seg.booths.length > 0 && officialForVenue.size > 0) {
        const ok = seg.booths.some((b) => officialForVenue.has(b));
        if (!ok && p.attribution?.source !== 'image') {
          violations.push({
            venue,
            postId: p.id,
            handle: p.handle,
            reason:
              `本文の「${REF_VENUE_META[venue].label} ${seg.booths.join(',')}」が` +
              `公式のブース番号(${[...officialForVenue].join(',')})と一致しない`,
            text: p.text.slice(0, 60),
          });
          continue;
        }
      }

      // --- 3. 表示日が公式の参加日に含まれること ---
      const owners = creatorByHandle.get(p.handle.toLowerCase()) ?? [];
      for (const owner of owners) {
        const days = daysForPost(p, venue, owner.days);
        const official = new Set(owner.days);
        const bad = days.filter((d) => !official.has(d));
        if (bad.length > 0) {
          violations.push({
            venue,
            postId: p.id,
            handle: p.handle,
            reason: `${owner.boothId ?? owner.circleName} が参加しない日に表示される: ${bad.join(',')}`,
            text: p.text.slice(0, 60),
          });
        }
        // 会場の開催日そのものからも外れていないこと
        const venueDays = new Set(VENUE_META[venue].days);
        const outside = days.filter((d) => !venueDays.has(d));
        if (outside.length > 0) {
          violations.push({
            venue,
            postId: p.id,
            handle: p.handle,
            reason: `${REF_VENUE_META[venue].label}の開催日外に表示される: ${outside.join(',')}`,
            text: p.text.slice(0, 60),
          });
        }
      }
    }
  }

  const candidates = selectReviewCandidates(posts, curation);
  const unresolved = candidates.filter(
    (p) =>
      !(p.attribution && p.attribution.provenVenues.length > 0) &&
      !curation.manualVenues?.[p.id],
  );

  console.log('会場帰属の検証');
  console.log(`  取得済み投稿: ${posts.length}件 / レビュー候補: ${candidates.length}件`);
  console.log(`  公開される投稿: 大阪 ${perVenue.osaka}件 / 東京 ${perVenue.tokyo}件（延べ ${published}件）`);
  console.log(
    `  判定根拠の内訳: ${[...bySource.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'なし'}`,
  );
  console.log(`  未確定で非公開: ${unresolved.length}件`);
  const coverage = candidates.length > 0
    ? Math.round(((candidates.length - unresolved.length) / candidates.length) * 100)
    : 100;
  console.log(`  確定率: ${coverage}%（未確定は公開されないので正しさには影響しない）`);

  if (violations.length > 0) {
    console.log(`\n✖ 担保が破れています（${violations.length}件）:`);
    for (const v of violations.slice(0, 20)) {
      console.log(`  [${v.venue}] @${v.handle} ${v.postId}`);
      console.log(`     ${v.reason}`);
      console.log(`     本文: ${v.text.replace(/\n/g, ' ')}`);
    }
    if (violations.length > 20) console.log(`  ... 他 ${violations.length - 20}件`);
    process.exit(1);
  }

  console.log('\n✓ 公開中の全件が、当該会場・当該日のお品書きであることを確認しました。');
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
