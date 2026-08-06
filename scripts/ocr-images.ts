/**
 * 判別待ちの画像を OCR で読み、会場帰属と「お品書きかどうか」を決める。
 *
 *   npm run ocr-images -- --calibrate   手読み済みの画像で精度を測る（閾値決め）
 *   npm run ocr-images                  全画像を処理して data/image-reads.json を更新
 *   npm run ocr-images -- --limit 20    先頭20件だけ
 *
 * 読み取った内容はそのまま信じない。`verifyImageRead()` が公式の出展記録と
 * 突き合わせ、一致したものだけを確定にする。OCR が誤読しても、
 * 公式データと合わなくなるだけなので誤掲載にはならない。
 *
 * ## OCR にできること・できないこと（実測）
 *
 * tesseract は装飾的な日本語のポスターに弱い。手読み済み27枚で測った結果:
 *
 *   価格表記（¥2,000 など） … 本物のお品書き15枚中5枚で検出
 *   会場名（大阪／浜松／東京） … 27枚中5枚
 *   ブース番号（F-11 など）   … ほぼ読めない
 *   日付（8/14 など）         … ほぼ読めない
 *
 * さらに**文字を版面の順に拾わないので文脈が壊れる**。会場名が読めても
 * それが何を指しているか分からず、実際に誤検出が出た（buildImageRead 参照）。
 *
 * よって OCR の役割は「これは頒布物の一覧か」の判定**だけ**に絞る。
 * 会場の証明には一切使わない。また陽性のときしか結果を残さない
 * （「読めなかった」を「お品書きではない」と記録すると、
 *   本文の語で正しく載っている投稿を巻き添えで消すため）。
 *
 * 全件をきちんと読むなら Claude API（attribute-images.ts）を使うこと。
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { verifyImageRead, type ImageRead, type VenueRead } from './lib/image-verdict';
import { closeOcr, countPrices, isOfficialListingShot, ocrImage, saveCache } from './lib/ocr';
import {
  buildOfficialIndex,
  normalizeBooth,
  normalizeText,
  scanMarkers,
} from './lib/venue-attribution';
import { REF_VENUES, REF_VENUE_META, type Creator, type Post, type RefVenue } from './lib/types';
import type { ReviewTask } from './prepare-image-review';

const DATA = path.join(process.cwd(), 'data');

/**
 * 「頒布物の一覧」と見なす価格表記の個数。
 * `--calibrate` の実測で、お品書きでない画像を誤って通すものが
 * 0件になる値を選ぶ。取りこぼしは許容、誤掲載は許容しない。
 */
export const PRICE_THRESHOLD = 3;

type Input = ImageRead & { postId: string; notes?: string | null };

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** OCR したテキストから、画像に印字されている会場と（読めれば）ブース番号を拾う */
export function venueReadsFromOcr(ocrText: string): VenueRead[] {
  const markers = scanMarkers(ocrText);
  const found = new Map<RefVenue, Set<string>>();

  for (const m of markers) {
    if (m.kind !== 'venue') continue;
    if (!found.has(m.venue)) found.set(m.venue, new Set());
  }
  if (found.size === 0) return [];

  // ブース番号は、いちばん近い会場名の区間に属するものとして扱う。
  // OCR は文字の並び順が崩れることがあるので、距離だけで素朴に寄せる。
  const venueMarkers = markers.filter((m): m is Extract<typeof m, { kind: 'venue' }> =>
    m.kind === 'venue',
  );
  for (const m of markers) {
    if (m.kind !== 'booth') continue;
    let best: RefVenue | null = null;
    let bestDist = Infinity;
    for (const vm of venueMarkers) {
      const d = Math.abs(vm.index - m.index);
      if (d < bestDist) {
        bestDist = d;
        best = vm.venue;
      }
    }
    // 離れすぎている番号は誰のものか分からないので使わない
    if (best && bestDist <= 60) found.get(best)!.add(m.booth);
  }

  return REF_VENUES.filter((v) => found.has(v)).map((v) => {
    const booths = [...found.get(v)!];
    return {
      venue: v,
      // 複数拾えたときは決め打ちしない（照合で落ちるより未指定のほうが安全）
      boothId: booths.length === 1 ? normalizeBooth(booths[0]!) : null,
      dates: [],
    } satisfies VenueRead;
  });
}

const MAGIMIRA_RE = /マジカルミライ|マジミラ|magicalmirai|magical\s*mirai/i;

async function ocrPost(task: ReviewTask): Promise<{ text: string; prices: number }> {
  let all = '';
  for (const img of task.images) {
    if (!existsSync(img.file)) continue;
    try {
      all += (await ocrImage(img.file)) + '\n';
    } catch {
      // 読めない画像は飛ばす。読めなかったことは「確定しない」に倒れる
    }
  }
  return { text: all, prices: countPrices(all) };
}

/** OCR の結果から ImageRead を組み立てる */
export function buildImageRead(
  ocrText: string,
  postText: string,
  prices: number,
  threshold: number,
): ImageRead {
  // 画像から読めた会場名は**記録するだけで、会場の証明には使わない**。
  //
  // OCR は文字を版面の順に拾わないので文脈が壊れる。実データで次の誤検出が出た:
  //   @gcmstyle    本文の「東京」は7/25のボーマス63のこと。マジミラは浜松のみ。
  //                画像から「東京」を拾い、東京ページに載るところだった
  //   @miyamoribungaku  浜松のお品書き。「新譜は東京・大阪でリリース予定」という
  //                     別文脈の地名を画像からも拾った
  //   @iruma_azalea 本文は大阪 B-12 なのに画像から「東京」
  //
  // 「会場名が印字されていて、その作者が公式にその会場に出展している」は、
  // 文脈を理解できる読み手（Claude API / 人手）なら妥当な証明になるが、
  // 文脈の無い OCR のテキストでは成立しない。
  //
  // よって OCR が担うのは「これは頒布物の一覧か」の判定だけにする。
  // 会場は本文の照合（text-booth）か、きちんとした画像判別に委ねる。
  const seen = venueReadsFromOcr(ocrText);
  const isMagimira = MAGIMIRA_RE.test(ocrText) || MAGIMIRA_RE.test(postText);
  const seenLabel =
    seen.map((v) => (v.venue === 'unknown' ? '不明' : REF_VENUE_META[v.venue].label)).join('・') ||
    'なし';
  const isOshinagaki = prices >= threshold;

  // 公式一覧ページの画面写真だと分かれば、陰性を断定できる
  const listingShot = !isOshinagaki && isOfficialListingShot(ocrText);

  return {
    isOshinagaki,
    readBy: 'ocr',
    negativeIsReliable: listingShot,
    isMagimira,
    venueScope: 'specific',
    venues: [],
    notes: listingShot
      ? 'OCR: 公式出店者一覧ページのスクリーンショット（「サークルメンバー」を検出）。頒布物の一覧ではない'
      : `OCR: 価格表記${prices}件 / 画像に見えた会場名 ${seenLabel}（OCRは会場の証明には使わない）`,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const calibrate = argv.includes('--calibrate');
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;

  const tasks = await readJson<ReviewTask[]>('image-review-queue.json', []);
  const existing = await readJson<Input[]>('image-reads.json', []);
  const byPostId = new Map(existing.map((r) => [r.postId, r]));

  if (calibrate) {
    await runCalibration(tasks, existing);
    return;
  }

  const posts = await readJson<Post[]>('posts.json', []);
  const postText = new Map(posts.map((p) => [p.id, p.text]));

  const officialRows = (
    await Promise.all(
      REF_VENUES.flatMap((v: RefVenue) =>
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
  ).flat();
  const officialIndex = buildOfficialIndex(officialRows);

  let done = 0;
  let proven = 0;
  let oshinagaki = 0;
  let skipped = 0;

  for (const t of tasks) {
    if (done >= limit) break;
    // 手読み済みのものは上書きしない
    if (byPostId.has(t.postId)) {
      skipped++;
      continue;
    }
    done++;

    const { text, prices } = await ocrPost(t);
    const read = buildImageRead(text, postText.get(t.postId) ?? '', prices, PRICE_THRESHOLD);

    // OCR は陽性のときだけ結果を残す。
    //
    // tesseract は装飾的な日本語のポスターに弱く、実測で本物のお品書き15枚のうち
    // 10枚を読み落とした。この「読めなかった」を「お品書きではない」として
    // 書き込むと、本文の「お品書き」の語で正しく掲載されている投稿を
    // 巻き添えで消してしまう。読めなかったものは**未判定のまま**にして、
    // 本文による判定に委ねる。
    //
    // 「お品書きではない」と断定してよいのは、画像をきちんと読める判別器
    //（attribute-images の Claude API / 人手の読み取り）だけ。
    if (!read.isOshinagaki && !read.negativeIsReliable) {
      console.log(`[${String(done).padStart(3)}] @${t.handle.padEnd(18)} 読み取れず（未判定のまま）`);
      if (done % 10 === 0) await saveCache();
      continue;
    }

    if (read.isOshinagaki) oshinagaki++;
    const official = officialIndex.get(t.handle.toLowerCase()) ?? [];
    const { attribution } = verifyImageRead(read, official);
    if (attribution.provenVenues.length) proven++;
    const label = attribution.provenVenues.length
      ? attribution.provenVenues.join(',')
      : read.isOshinagaki
        ? 'お品書きだが会場不明'
        : '会場のみ読めた';

    console.log(
      `[${String(done).padStart(3)}] @${t.handle.padEnd(18)} 価格${String(prices).padStart(2)}件 ${label}`,
    );

    byPostId.set(t.postId, { postId: t.postId, ...read });
    if (done % 10 === 0) await saveCache();
  }

  const out = [...byPostId.values()];
  await writeFile(
    path.join(DATA, 'image-reads.json'),
    JSON.stringify(out, null, 2) + '\n',
    'utf8',
  );
  await closeOcr();

  console.log(`\nOCR で処理: ${done}件（手読み済みで飛ばした: ${skipped}件）`);
  console.log(`  お品書きと判定（価格${PRICE_THRESHOLD}件以上）: ${oshinagaki}件`);
  console.log(`  会場まで確定: ${proven}件`);
  console.log('  → data/image-reads.json');
  console.log('\n次: npm run apply-image-reads で data/posts.json に反映する');
}

/**
 * 手読み済みの画像を正解として、OCR の判定がどれだけ合うかを測る。
 *
 * 見るべきは**誤って「お品書き」と判定する件数**。ここが0でないと
 * 誤掲載につながる。取りこぼし（お品書きなのに見逃す）は許容する。
 */
async function runCalibration(_tasks: ReviewTask[], truth: Input[]): Promise<void> {
  const posts = await readJson<Post[]>('posts.json', []);
  const byId = new Map(posts.map((p) => [p.id, p]));

  // 手読み済みの投稿はキューから外れているので、画像はファイル名から探す。
  // prepare-image-review は 1枚なら <id>.jpg、複数なら <id>-1.jpg… で保存する。
  const dir = path.join(process.cwd(), '.image-review');
  const filesFor = (id: string): string[] => {
    const single = path.join(dir, `${id}.jpg`);
    if (existsSync(single)) return [single];
    const out: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const f = path.join(dir, `${id}-${i}.jpg`);
      if (existsSync(f)) out.push(f);
    }
    return out;
  };

  type Row = { id: string; handle: string; prices: number; want: boolean; venues: string };
  const rows: Row[] = [];

  for (const t of truth) {
    const files = filesFor(t.postId);
    if (files.length === 0) continue;
    const post = byId.get(t.postId);
    let text = '';
    for (const f of files) {
      try {
        text += (await ocrImage(f)) + '\n';
      } catch {
        /* 読めない画像は飛ばす */
      }
    }
    const prices = countPrices(text);
    const read = buildImageRead(text, post?.text ?? '', prices, 1);
    rows.push({
      id: t.postId,
      handle: post?.handle ?? '?',
      prices,
      want: t.isOshinagaki,
      venues: read.venues.map((v) => (v.venue === 'unknown' ? '不明' : REF_VENUE_META[v.venue].label)).join('・') || '-',
    });
  }
  await closeOcr();

  if (rows.length === 0) {
    console.log('手読み済みの画像が .image-review/ に見つかりません。');
    console.log('先に npm run prepare-image-review を実行してください。');
    return;
  }

  console.log(`\n手読み済み ${rows.length}件に対する OCR の読み取り\n`);
  console.log('正解  価格  画像の会場        アカウント');
  for (const r of rows.sort((a, b) => b.prices - a.prices)) {
    console.log(
      `${r.want ? 'お品書き' : '  それ以外'}  ${String(r.prices).padStart(3)}  ${r.venues.padEnd(14)}  @${r.handle}`,
    );
  }

  console.log('\n閾値ごとの成績（誤検出＝お品書きでないものを通してしまった数）');
  console.log('閾値  検出  取りこぼし  誤検出');
  for (let n = 1; n <= 10; n++) {
    const tp = rows.filter((r) => r.want && r.prices >= n).length;
    const fn = rows.filter((r) => r.want && r.prices < n).length;
    const fp = rows.filter((r) => !r.want && r.prices >= n).length;
    const mark = fp === 0 ? '  ← 誤検出0' : '';
    console.log(
      `${String(n).padStart(3)}  ${String(tp).padStart(4)}  ${String(fn).padStart(8)}  ${String(fp).padStart(6)}${mark}`,
    );
  }
  console.log('\n誤検出が0になる最小の閾値を PRICE_THRESHOLD に設定すること。');
}

main().catch(async (e) => {
  await closeOcr().catch(() => {});
  console.error(e);
  process.exit(1);
});
