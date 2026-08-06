/**
 * お品書き画像から会場・ブース番号・日付を読み取って会場帰属を確定する。
 *
 *   npm run attribute-images -- --dry-run   … 対象と概算費用だけ表示
 *   npm run attribute-images -- --limit 1   … まず1枚で精度を確認
 *   npm run attribute-images                … 本文で確定できなかった投稿すべて
 *
 * 要 ANTHROPIC_API_KEY（.env.local または環境変数）
 *
 * なぜ画像を読むのか:
 *   本文だけでは 4 割ほどしか会場を確定できない。お品書きの画像には
 *   ほぼ必ず「マジカルミライ2026 大阪 D-06」のように会場とブース番号が
 *   刷り込まれているので、そこを読めば残りを確定できる。
 *
 * なぜこれが「推測」ではなく「証明」なのか:
 *   読み取った会場とブース番号を**公式の出展データと照合**する。
 *   一致したときだけ確定とする。モデルが誤読・捏造しても、
 *   公式データと偶然一致することはまずない。
 *   一致しなければ確定せず、非公開のままレビューに回る。
 */

import { readFile } from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import * as z from 'zod/v4';

import { selectReviewCandidates } from './lib/curation';
import { verifyImageRead } from './lib/image-verdict';
import { dataPath, readJson, sleep, writeJson, PROJECT_ROOT } from './lib/io';
import type { OfficialListing } from './lib/official-parser';
import type { Curation, Post, RefVenue } from './lib/types';
import { REF_VENUE_META, VENUES } from './lib/types';
import { buildOfficialIndex } from './lib/venue-attribution';

const MODEL = 'claude-opus-5';
const PRICE_IN_PER_MTOK = 5;
const PRICE_OUT_PER_MTOK = 25;
const TOKENS_PER_IMAGE = 4784;

const VenueReadSchema = z.object({
  venue: z
    .enum(['hamamatsu', 'osaka', 'tokyo', 'unknown'])
    .describe('画像に書かれている会場。判読できない・書かれていない場合は unknown'),
  boothId: z
    .string()
    .nullable()
    .describe('その会場でのブース番号（例: D-06, A-5）。書かれていなければ null'),
  dates: z
    .array(z.string())
    .describe('画像に書かれている日付を YYYY-MM-DD で。書かれていなければ空配列'),
});

const ResponseSchema = z.object({
  isOshinagaki: z.boolean().describe('この画像が頒布物の一覧（お品書き）かどうか'),
  venues: z
    .array(VenueReadSchema)
    .describe('画像に書かれている会場ごとの情報。複数会場が併記されていればすべて'),
  notes: z.string().nullable().describe('判読に迷った点があれば簡潔に。無ければ null'),
});

const SYSTEM_PROMPT = `あなたは同人イベントのお品書き画像から「どの会場のものか」を読み取る担当です。

対象イベント: 初音ミク「マジカルミライ 2026」クリエイターズマーケット
会場は3つあります。
- 浜松 (HAMAMATSU): 2026年7月24日〜26日
- 大阪 (OSAKA): 2026年8月14日〜16日
- 東京 (TOKYO): 2026年8月28日〜30日

読み取りの方針:
- 画像に書かれている会場名とブース番号を、書かれているとおりに読む。
- 「浜松 A-05 / 大阪 D-06 / 東京 C-18」のように複数会場が併記されていれば、
  すべてを venues 配列に入れる。
- ブース番号は画像の表記のまま返す（"D-06" なら "D-06"）。
- 会場名が書かれていない場合は venue を unknown にする。
  **推測しない。** 書かれていないものを補わない。
- 日付が書かれていれば YYYY-MM-DD 形式で返す。年は 2026 年。
- 頒布物の一覧に見えない画像（宣伝イラストだけ等）は isOshinagaki を false にする。

重要: 読み取った内容は公式の出展データと照合されます。
推測で埋めると照合に失敗して無駄になるだけなので、
見えないものは unknown / null / 空配列にしてください。`;

type Args = { limit: number | null; dryRun: boolean; force: boolean };

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf('--limit');
  const raw = i >= 0 ? argv[i + 1] : null;
  const limit = raw == null ? null : Number(raw);
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit は正の整数（受け取った値: ${raw}）`);
  }
  return { limit, dryRun: argv.includes('--dry-run'), force: argv.includes('--force') };
}

async function loadApiKeyFromEnvFile(): Promise<void> {
  if (process.env.ANTHROPIC_API_KEY) return;
  try {
    const text = await readFile(`${PROJECT_ROOT}/.env.local`, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?ANTHROPIC_API_KEY\s*=\s*(.+?)\s*$/.exec(line);
      if (!m) continue;
      process.env.ANTHROPIC_API_KEY = m[1]!.replace(/^["']|["']$/g, '');
      return;
    }
  } catch {
    /* .env.local が無いのは普通のこと */
  }
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [posts, curation, listings] = await Promise.all([
    readJson<Post[]>(dataPath('posts.json'), []),
    readJson<Curation>(dataPath('curation.json'), {
      verdicts: {},
      excludedHandles: [],
      updatedAt: '',
    }),
    readJson<OfficialListing[]>(dataPath('official-listings.json'), []),
  ]);
  if (posts.length === 0) throw new Error('data/posts.json が空です。先に `npm run crawl-x` を。');
  if (listings.length === 0) {
    throw new Error('data/official-listings.json がありません。先に `npm run scrape-official` を。');
  }
  const officialIndex = buildOfficialIndex(listings);

  // 本文で確定できず、画像を持っている候補が対象
  const candidates = selectReviewCandidates(posts, curation);
  let targets = candidates.filter((p) => {
    if (curation.manualVenues?.[p.id]) return false;
    if (!args.force && p.attribution && p.attribution.provenVenues.length > 0) return false;
    if (!args.force && p.attribution?.source === 'image') return false;
    return p.media.some((m) => m.kind === 'photo');
  });
  const total = targets.length;
  if (args.limit !== null) targets = targets.slice(0, args.limit);

  const estIn = targets.length * TOKENS_PER_IMAGE;
  const estOut = targets.length * 300;
  const estCost = (estIn / 1e6) * PRICE_IN_PER_MTOK + (estOut / 1e6) * PRICE_OUT_PER_MTOK;

  console.log('お品書き画像からの会場判別');
  console.log(`  モデル: ${MODEL}`);
  console.log(`  レビュー候補: ${candidates.length}件`);
  console.log(`  本文で確定できず画像がある: ${total}件`);
  console.log(`  今回の対象: ${targets.length}件`);
  console.log(`  概算費用: ${usd(estCost)}\n`);

  if (targets.length === 0) {
    console.log('対象がありません。');
    return;
  }
  if (args.dryRun) {
    console.log('--dry-run なので API は呼びません。対象:');
    for (const t of targets.slice(0, 15)) {
      console.log(`  @${t.handle} ${t.id}  ${t.text.replace(/\n/g, ' ').slice(0, 50)}`);
    }
    if (targets.length > 15) console.log(`  ... 他 ${targets.length - 15}件`);
    return;
  }

  await loadApiKeyFromEnvFile();
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY が設定されていません。\n' +
        '  .env.local に ANTHROPIC_API_KEY=sk-ant-... を書くか、環境変数を設定してください。\n' +
        '  対象と費用だけ確認したい場合は --dry-run を使えます。',
    );
  }

  const client = new Anthropic();
  const byId = new Map(posts.map((p) => [p.id, p]));
  let inTok = 0;
  let outTok = 0;
  let provenCount = 0;
  let unprovenCount = 0;
  let mismatchCount = 0;

  const persist = async (): Promise<void> => {
    await writeJson(dataPath('posts.json'), [...byId.values()]);
  };

  for (const [i, p] of targets.entries()) {
    const photo = p.media.find((m) => m.kind === 'photo')!;
    const label = `[${i + 1}/${targets.length}] @${p.handle} ${p.id}`;
    try {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'low', format: zodOutputFormat(ResponseSchema) },
        system: [
          { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: photo.apiUrl } },
              {
                type: 'text',
                text:
                  'この画像がどの会場のお品書きかを読み取ってください。\n\n' +
                  `参考（投稿本文）:\n${p.text || '（本文なし）'}`,
              },
            ],
          },
        ],
      });

      inTok += res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0);
      outTok += res.usage.output_tokens;

      if (res.stop_reason === 'refusal' || !res.parsed_output) {
        unprovenCount += 1;
        console.log(`${label} 読み取れず`);
        await persist();
        continue;
      }

      const read = res.parsed_output;
      const official = officialIndex.get(p.handle.toLowerCase()) ?? [];
      // 公式データとの照合は共有ロジックに任せる。
      // 手作業で読み取った場合（apply-image-reads.ts）と同じ判定を通す。
      const { attribution, mismatched } = verifyImageRead(read, official);
      if (mismatched) mismatchCount += 1;

      // 画像がお品書きかどうかは、会場の確定とは別に必ず記録する
      const next: Post = { ...p, imageIsOshinagaki: read.isOshinagaki };
      if (attribution.provenVenues.length > 0) {
        next.attribution = attribution;
        provenCount += 1;
        console.log(`${label} → ${attribution.provenVenues.join(',')} に確定`);
      } else if ((p.attribution?.provenVenues.length ?? 0) > 0) {
        // 画像から会場が読めなかっただけ。本文で確定済みの帰属は消さない
        next.attribution = {
          ...p.attribution!,
          evidence: [...p.attribution!.evidence, ...attribution.evidence],
        };
        unprovenCount += 1;
        console.log(`${label} 画像からは会場を読めず（本文の判定を維持）`);
      } else {
        next.attribution = attribution;
        unprovenCount += 1;
        console.log(`${label} 確定せず（${attribution.evidence[0] ?? '会場の記載なし'}）`);
      }
      byId.set(p.id, next);
      await persist();
    } catch (err) {
      unprovenCount += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${label} 失敗: ${message}`);
      if (/rate limit|429/i.test(message)) await sleep(20_000);
    }
  }

  await persist();

  const cost = (inTok / 1e6) * PRICE_IN_PER_MTOK + (outTok / 1e6) * PRICE_OUT_PER_MTOK;
  console.log(`\n完了`);
  console.log(`  会場を確定できた: ${provenCount}件`);
  console.log(`  確定できなかった: ${unprovenCount}件`);
  if (mismatchCount > 0) {
    console.log(`  公式データと食い違い（確定せず）: ${mismatchCount}件`);
  }
  console.log(`  実測トークン: 入力 ${inTok.toLocaleString()} / 出力 ${outTok.toLocaleString()}`);
  console.log(`  実測費用: ${usd(cost)}`);
  if (targets.length > 0) {
    console.log(`  1枚あたり: ${usd(cost / targets.length)}`);
  }
  console.log(`\n次は \`npm run verify-attribution\` で担保を確認してください。`);
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
