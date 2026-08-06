/**
 * 公式出店者一覧スクレイパー。
 *
 *   npm run scrape-official              … 大阪・東京の両方
 *   npm run scrape-official -- --venue osaka
 *
 * 出力: data/creators.<venue>.json, data/sponsors.<venue>.json
 *
 * 件数アサーション付き。公式サイトの DOM 構造が変わったら
 * 「0件で静かに成功」ではなく異常終了させる。
 */

import {
  compareByBooth,
  parseCreatorsMarket,
  parseListings,
  parseSponsorListings,
  parseSponsors,
  type OfficialListing,
} from './lib/official-parser';
import { dataPath, fetchHtml, readJson, writeJson } from './lib/io';
import type { Creator, Venue } from './lib/types';
import { REF_VENUES, REF_VENUE_META, VENUES, VENUE_META } from './lib/types';

/** 会場ごとの下限値。これを下回ったらパース失敗とみなす */
const EXPECTATIONS: Record<Venue, { minCreators: number; minXLinks: number; minSponsors: number }> = {
  osaka: { minCreators: 70, minXLinks: 90, minSponsors: 30 },
  tokyo: { minCreators: 90, minXLinks: 110, minSponsors: 30 },
};

function parseArgs(argv: string[]): { venues: Venue[] } {
  const i = argv.indexOf('--venue');
  if (i >= 0) {
    const v = argv[i + 1];
    if (v !== 'osaka' && v !== 'tokyo') {
      throw new Error(`--venue は osaka | tokyo のいずれか（受け取った値: ${v}）`);
    }
    return { venues: [v] };
  }
  return { venues: [...VENUES] };
}

function countXLinks(creators: Creator[]): number {
  return creators.reduce((n, c) => n + c.xHandles.length, 0);
}

/**
 * ID の一意性を保証する。
 *
 * ここが崩れると詳細ページが生成されず、そのサークルに到達できなくなる。
 * 実際にブース共有（日替わり出店）で衝突していたので、必ず検査する。
 */
function assertUniqueIds(venueLabel: string, kindLabel: string, creators: Creator[]): void {
  const seen = new Map<string, string[]>();
  for (const c of creators) {
    const arr = seen.get(c.id) ?? [];
    arr.push(c.circleName);
    seen.set(c.id, arr);
  }
  const dup = [...seen.entries()].filter(([, names]) => names.length > 1);
  if (dup.length === 0) return;
  const detail = dup
    .slice(0, 5)
    .map(([id, names]) => `${id} → ${names.join(' / ')}`)
    .join('; ');
  throw new Error(
    `[${venueLabel}] ${kindLabel}で ID が重複している（${dup.length}組）: ${detail}。` +
      ' 重複したままだと詳細ページが生成されず、そのサークルに到達できなくなる。' +
      ' official-parser.ts の assignIds を確認すること。',
  );
}

function summarize(label: string, creators: Creator[]): void {
  const withX = creators.filter((c) => c.xHandles.length > 0).length;
  const xLinks = countXLinks(creators);
  const byLine = new Map<string, number>();
  for (const c of creators) {
    const k = c.line ?? '(その他)';
    byLine.set(k, (byLine.get(k) ?? 0) + 1);
  }
  const lines = [...byLine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join(' ');
  console.log(`  ${label}: ${creators.length}件 / Xあり ${withX}件 / Xリンク ${xLinks}本`);
  console.log(`    列内訳: ${lines}`);
}

async function scrapeVenue(venue: Venue): Promise<void> {
  const meta = VENUE_META[venue];
  const exp = EXPECTATIONS[venue];
  console.log(`\n[${meta.label}] ${meta.hall}`);

  // --- クリエイターズマーケット ---
  console.log(`  取得中: ${meta.exmarketUrl}`);
  const marketHtml = await fetchHtml(meta.exmarketUrl);
  const creators = parseCreatorsMarket(marketHtml, venue).sort(compareByBooth);
  summarize('クリエイターズマーケット', creators);

  if (creators.length < exp.minCreators) {
    throw new Error(
      `[${meta.label}] サークル件数が想定を下回った: ${creators.length} < ${exp.minCreators}。` +
        ` 公式サイトの DOM 構造が変わった可能性があるので official-parser.ts のセレクタを確認すること。`,
    );
  }
  const xLinks = countXLinks(creators);
  if (xLinks < exp.minXLinks) {
    throw new Error(
      `[${meta.label}] X リンク数が想定を下回った: ${xLinks} < ${exp.minXLinks}。` +
        ` p.member_link のセレクタまたは normalizeXHandle を確認すること。`,
    );
  }
  const noName = creators.filter((c) => !c.circleName);
  if (noName.length > 0) {
    throw new Error(
      `[${meta.label}] サークル名が空の項目が ${noName.length} 件ある` +
        `（例: ${noName[0]!.id}）。h4.booth_name のパースを確認すること。`,
    );
  }
  assertUniqueIds(meta.label, 'クリエイターズマーケット', creators);

  // 1つのブースを複数サークルが日替わりで共有するケースを可視化する
  const shared = new Map<string, number>();
  for (const c of creators) {
    if (!c.boothId) continue;
    shared.set(c.boothId, (shared.get(c.boothId) ?? 0) + 1);
  }
  const sharedBooths = [...shared.entries()].filter(([, n]) => n > 1);
  if (sharedBooths.length > 0) {
    console.log(
      `    共有ブース: ${sharedBooths.length}件（${sharedBooths.map(([b, n]) => `${b}×${n}`).join(' ')}）`,
    );
  }

  await writeJson(dataPath(`creators.${venue}.json`), creators);
  console.log(`  → data/creators.${venue}.json`);

  // --- 出展ブース（企業・団体） ---
  console.log(`  取得中: ${meta.sponsorUrl}`);
  const sponsorHtml = await fetchHtml(meta.sponsorUrl);
  const sponsors = parseSponsors(sponsorHtml, venue).sort(compareByBooth);
  summarize('出展ブース', sponsors);

  if (sponsors.length < exp.minSponsors) {
    throw new Error(
      `[${meta.label}] 出展ブース件数が想定を下回った: ${sponsors.length} < ${exp.minSponsors}。` +
        ` ul.sponsor_booth_detail のセレクタを確認すること。`,
    );
  }

  assertUniqueIds(meta.label, '出展ブース', sponsors);

  // クリエイターズマーケットと出展ブースの間でも ID が衝突しないこと
  assertUniqueIds(meta.label, '全体', [...creators, ...sponsors]);

  await writeJson(dataPath(`sponsors.${venue}.json`), sponsors);
  console.log(`  → data/sponsors.${venue}.json`);
}

async function main(): Promise<void> {
  const { venues } = parseArgs(process.argv.slice(2));
  for (const venue of venues) {
    await scrapeVenue(venue);
  }

  // --- 会場帰属の判定用データ（浜松を含む全会場） ---
  //
  // 浜松（7/24-26）は終了済みでサイトには表示しないが、
  //  ・「この投稿は浜松のブース番号だ」と積極的に判定する
  //  ・「この作者は浜松に出ていないので消去法で大阪だと確定できる」
  // という判断に公式データが要る。表示用とは別に持つ。
  console.log('\n[会場帰属の判定用データ]');
  const listings: OfficialListing[] = [];
  for (const rv of REF_VENUES) {
    const meta = REF_VENUE_META[rv];
    const html = await fetchHtml(meta.exmarketUrl);
    const parsed = parseListings(html, rv);
    if (parsed.length === 0) {
      throw new Error(
        `[${meta.label}] 判定用データが0件。${meta.exmarketUrl} の DOM 構造を確認すること。`,
      );
    }
    // 出展ブース（企業）も判定に使う。無いと企業ブースの投稿が
    // 永久に会場未確定＝非公開になる。
    let sponsors: OfficialListing[] = [];
    if (rv !== 'hamamatsu') {
      const sponsorHtml = await fetchHtml(VENUE_META[rv].sponsorUrl);
      sponsors = parseSponsorListings(sponsorHtml, rv);
    }
    const withX = [...parsed, ...sponsors].filter((p) => p.xHandles.length > 0).length;
    console.log(
      `  ${meta.label}: CM ${parsed.length}件 + 企業 ${sponsors.length}件（Xあり ${withX}件）`,
    );
    listings.push(...parsed, ...sponsors);
  }
  await writeJson(dataPath('official-listings.json'), listings);
  console.log(`  → data/official-listings.json（${listings.length}件）`);

  // 全会場の X ハンドルを集約して、クローラーの入力にする。
  // 同じクリエイターが大阪と東京の両方に出る場合が多いので、
  // ハンドル単位で束ねて 1 回のクロールで済ませる。
  const handles = new Map<string, string[]>(); // handle -> creator ids
  for (const venue of venues) {
    for (const file of [`creators.${venue}.json`, `sponsors.${venue}.json`]) {
      const list = await readJson<Creator[]>(dataPath(file), []);
      for (const c of list) {
        for (const h of c.xHandles) {
          const arr = handles.get(h) ?? [];
          arr.push(c.id);
          handles.set(h, arr);
        }
      }
    }
  }
  const targets = [...handles.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([handle, creatorIds]) => ({ handle, creatorIds }));
  await writeJson(dataPath('x-targets.json'), targets);

  console.log(`\n完了。X クロール対象: ${targets.length} ハンドル`);
  console.log('  → data/x-targets.json');
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
