/**
 * 会場が未確定のお品書き投稿を、画像で判別するための作業ファイルを作る。
 *
 * ANTHROPIC_API_KEY があるなら attribute-images.ts を使う方が速い。
 * これは鍵が無い環境で、画像を人（または対話中のモデル）が読んで
 * 会場を確定させるための素材を用意する。
 *
 * 出力:
 *   data/image-review-queue.json  判別対象の一覧（本文・公式の出展情報つき）
 *   <outDir>/<postId>.jpg         判別に使う画像（既にあれば再取得しない）
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { isMagimiraPost, isOshinagakiPost, selectReviewCandidates } from './lib/curation';
import { buildOfficialIndex, type OfficialEntry } from './lib/venue-attribution';
import {
  REF_VENUE_META,
  VENUES,
  type Creator,
  type Curation,
  type Post,
  type RefVenue,
} from './lib/types';

const DATA = path.join(process.cwd(), 'data');

export type ReviewTask = {
  postId: string;
  handle: string;
  url: string;
  text: string;
  /**
   * 投稿に付いている画像すべて。お品書きが2枚目以降にあることがある
   * （「ボーマスの分＋マジミラの分」を並べて貼るなど）ので1枚目だけでは足りない。
   */
  images: { index: number; url: string; file: string }[];
  /** この作者の公式出展情報。判別結果はこれと照合して初めて採用される */
  official: { venue: RefVenue; booth: string | null; days: string[] }[];
  /** 判別が要るのはこの会場のどれか */
  candidateVenues: RefVenue[];
};

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const outDir = process.argv.includes('--out')
    ? process.argv[process.argv.indexOf('--out') + 1]!
    : path.join(process.cwd(), '.image-review');
  const limit = process.argv.includes('--limit')
    ? Number(process.argv[process.argv.indexOf('--limit') + 1])
    : Infinity;

  const posts = await readJson<Post[]>('posts.json', []);
  const curation = await readJson<Curation>('curation.json', {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });

  // 公式出展情報（浜松も含める。浜松専用と分かれば非公開にできる）
  const official: OfficialEntry[] = [];
  const byHandle = buildOfficialIndex(
    (
      await Promise.all(
        (['hamamatsu', 'osaka', 'tokyo'] as RefVenue[]).flatMap((v) =>
          ['creators', 'sponsors'].map(async (kind) => {
            const list = await readJson<Creator[]>(`${kind}.${v}.json`, []);
            return list.map((c) => ({
              venue: v,
              boothId: c.boothId,
              days: c.days,
              xHandles: c.xHandles,
            }));
          }),
        ),
      )
    ).flat(),
  );
  void official;

  const candidates = selectReviewCandidates(posts, curation);
  const manual = curation.manualVenues ?? {};

  const tasks: ReviewTask[] = [];
  for (const p of candidates) {
    if (manual[p.id]) continue;
    // 既に画像を読んであるものは対象外
    if (p.imageIsOshinagaki !== undefined && p.imageIsOshinagaki !== null) continue;
    // 他イベント（ボーマス・音けっと・COMITIA・プロセカ等）のお品書きは、
    // 会場が分かっても公開されない。読んでも意味が無いので外す。
    if (!isMagimiraPost(p)) continue;
    const photos = p.media.filter((m) => m.kind === 'photo');
    if (photos.length === 0) continue;
    // 既に公開できる状態のものは判別不要。
    // そうでないものは「会場が読めない」「お品書きか分からない」の
    // どちらかなので、両方とも画像を読めば解決しうる。
    const publishable = (p.attribution?.provenVenues.length ?? 0) > 0 && isOshinagakiPost(p);
    if (publishable) continue;

    const entries = byHandle.get(p.handle.toLowerCase()) ?? [];
    if (entries.length === 0) continue;
    // 対象2会場のどちらにも出ていない作者は、判別しても公開されない
    if (!entries.some((e) => VENUES.includes(e.venue as never))) continue;

    tasks.push({
      postId: p.id,
      handle: p.handle,
      url: p.url,
      text: p.text.slice(0, 400),
      images: photos.map((m, i) => ({
        index: i,
        url: m.largeUrl,
        file: path.join(outDir, photos.length === 1 ? `${p.id}.jpg` : `${p.id}-${i + 1}.jpg`),
      })),
      official: entries.map((e) => ({ venue: e.venue, booth: e.boothId, days: e.days })),
      candidateVenues: [...new Set(entries.map((e) => e.venue))],
    });
    if (tasks.length >= limit) break;
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(DATA, 'image-review-queue.json'),
    JSON.stringify(tasks, null, 2) + '\n',
    'utf8',
  );

  console.log(`\n画像で判別すべき投稿: ${tasks.length}件`);
  const multi = tasks.filter((t) => t.candidateVenues.length > 1).length;
  console.log(`  複数会場に出展している作者: ${multi}件`);
  for (const v of ['hamamatsu', 'osaka', 'tokyo'] as RefVenue[]) {
    const n = tasks.filter((t) => t.candidateVenues.includes(v)).length;
    console.log(`  ${REF_VENUE_META[v].label}の可能性がある: ${n}件`);
  }

  // 画像を取得
  let got = 0;
  let failed = 0;
  for (const t of tasks) {
    for (const img of t.images) {
      if (existsSync(img.file)) {
        got++;
        continue;
      }
      try {
        const res = await fetch(img.url);
        if (!res.ok) throw new Error(String(res.status));
        await writeFile(img.file, Buffer.from(await res.arrayBuffer()));
        got++;
      } catch {
        failed++;
      }
    }
  }
  const multiImage = tasks.filter((t) => t.images.length > 1).length;
  console.log(`\n画像: ${got}枚取得済み / 失敗 ${failed}枚`);
  console.log(`  複数枚の投稿: ${multiImage}件（お品書きが2枚目以降のことがある）`);
  console.log(`  ${outDir}`);
  console.log('  → data/image-review-queue.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
