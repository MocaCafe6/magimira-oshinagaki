/**
 * お品書き画像から商品名・価格・種別を構造化抽出する。
 *
 *   npm run extract-items -- --limit 1   … まず1枚だけで精度と実費を確認（推奨）
 *   npm run extract-items                … 採用済みの未抽出画像すべて
 *   npm run extract-items -- --force     … 抽出済みも再実行
 *   npm run extract-items -- --dry-run   … 対象と概算費用だけ表示（API を呼ばない）
 *
 * 要 ANTHROPIC_API_KEY（.env.local または環境変数）
 *
 * 費用について:
 *   画像1枚あたり最大 ~4,784 入力トークン（高解像度対応の上限）。
 *   claude-opus-5 は入力 $5 / 出力 $25 per 1M tokens なので、
 *   200枚で概ね $7（約1,100円）。実測値は毎回 usage から集計して表示する。
 *
 * 画像はダウンロードせず pbs.twimg.com の URL を直接 API に渡す。
 * name=orig は稀に API の上限を超えるので name=4096x4096 を使う
 * （それでも高解像度の上限 2576px を上回るので精度は落ちない）。
 */

import { readFile } from 'node:fs/promises';

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
// SDK の zodOutputFormat は Zod v4 の型を要求する。
// zod 3.25 系は v4 実装を `zod/v4` サブパスで同梱しているのでそこから取る。
import * as z from 'zod/v4';

// 掲載判定は公開サイトと同じ関数を使う（公開されない投稿に課金しないため）
import { selectPostsForVenue } from './lib/curation';
import { dataPath, readJson, sleep, writeJson, PROJECT_ROOT } from './lib/io';
import { mediaKey } from './lib/media-key';
import type { Curation, ExtractionRecord, ExtractedItem, Post } from './lib/types';
import { ITEM_CATEGORIES, VENUES } from './lib/types';

const MODEL = 'claude-opus-5';
/** 概算表示用の単価（USD / 1M tokens） */
const PRICE_IN_PER_MTOK = 5;
const PRICE_OUT_PER_MTOK = 25;
/** 高解像度画像1枚あたりの入力トークン上限 */
const TOKENS_PER_IMAGE = 4784;

const ItemSchema = z.object({
  name: z.string().describe('商品名。お品書きに書かれている表記をそのまま使う'),
  price: z
    .number()
    .nullable()
    .describe('日本円の価格。数値のみ。読み取れない場合や「無料」以外で不明な場合は null'),
  priceNote: z
    .string()
    .nullable()
    .describe('価格に付随する条件。例: 「税込」「2点セット」「各」。無ければ null'),
  category: z.string().describe('商品種別'),
  note: z.string().nullable().describe('数量限定・ランダム封入などの補足。無ければ null'),
  confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('読み取りの確信度。文字が小さい・装飾的で判読しにくい場合は low'),
});

const ResponseSchema = z.object({
  isOshinagaki: z
    .boolean()
    .describe('この画像が頒布物の一覧（お品書き）かどうか。宣伝イラストのみなら false'),
  items: z.array(ItemSchema).describe('読み取れた商品。お品書きでなければ空配列'),
});

const SYSTEM_PROMPT = `あなたは同人イベントのお品書き画像を読み取って商品情報を構造化する担当です。

お品書きとは、頒布する商品とその価格を一覧にした画像です。
初音ミク関連イベント「マジカルミライ」のクリエイターズマーケット向けのものを扱います。

読み取りの方針:
- 商品名は画像に書かれている表記をそのまま使う。勝手に言い換えたり要約したりしない。
- 価格は日本円の数値のみを price に入れる。「¥2,000」「2000円」はいずれも 2000。
- 「税込」「2点セット」「各」のような価格の条件は priceNote に分ける。
- セット販売と単品が併記されている場合は、それぞれ別の商品として列挙する。
- 「完売」「頒布終了」と書かれている商品も、note にその旨を書いて列挙する。
- 判読できない文字を推測で埋めない。読めない部分は confidence を low にし、
  note に何が読めなかったかを書く。
- 商品が1つも読み取れない場合（宣伝イラストだけ、告知テキストだけ等）は
  isOshinagaki を false にし、items は空配列にする。

category は次のいずれかを優先して使う:
${ITEM_CATEGORIES.map((c) => `- ${c}`).join('\n')}

どれにも当てはまらない場合は「その他」を選び、note に実際の種別を書く。
新しい種別を勝手に作らない。`;

type Args = {
  limit: number | null;
  force: boolean;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const i = argv.indexOf('--limit');
  const raw = i >= 0 ? argv[i + 1] : null;
  const limit = raw == null ? null : Number(raw);
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error(`--limit は正の整数（受け取った値: ${raw}）`);
  }
  return { limit, force: argv.includes('--force'), dryRun: argv.includes('--dry-run') };
}

/** .env.local から ANTHROPIC_API_KEY を読む（dotenv を足さずに済ませる） */
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
    // .env.local が無いのは普通のこと
  }
}

type Target = {
  post: Post;
  mediaIndex: number;
  apiUrl: string;
  key: string;
};

function collectTargets(posts: Post[], done: Map<string, ExtractionRecord>, force: boolean): Target[] {
  const out: Target[] = [];
  for (const post of posts) {
    post.media.forEach((m, mediaIndex) => {
      if (m.kind !== 'photo') return; // 動画からは読めない
      const key = mediaKey(m.baseUrl);
      if (!force && done.has(key)) return; // 同じ画像に二度課金しない
      out.push({ post, mediaIndex, apiUrl: m.apiUrl, key });
    });
  }
  return out;
}

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const [posts, curation, existing] = await Promise.all([
    readJson<Post[]>(dataPath('posts.json'), []),
    readJson<Curation>(dataPath('curation.json'), {
      verdicts: {},
      excludedHandles: [],
      updatedAt: '',
    }),
    readJson<ExtractionRecord[]>(dataPath('items.json'), []),
  ]);

  if (posts.length === 0) {
    throw new Error('data/posts.json が空です。先に `npm run crawl-x` を実行してください。');
  }

  const done = new Map(existing.map((r) => [r.mediaKey, r]));
  // いずれかの会場に掲載される投稿だけを抽出対象にする。
  // 会場が確定していない投稿は公開されないので、商品を読んでも表示されない＝課金の無駄。
  const byId = new Map<string, Post>();
  for (const v of VENUES) {
    for (const p of selectPostsForVenue(posts, curation, v)) byId.set(p.id, p);
  }
  const adopted = [...byId.values()];
  let targets = collectTargets(adopted, done, args.force);
  const totalCandidates = targets.length;
  if (args.limit !== null) targets = targets.slice(0, args.limit);

  const estIn = targets.length * TOKENS_PER_IMAGE;
  const estOut = targets.length * 500;
  const estCost = (estIn / 1e6) * PRICE_IN_PER_MTOK + (estOut / 1e6) * PRICE_OUT_PER_MTOK;

  console.log('お品書きの商品抽出');
  console.log(`  モデル: ${MODEL}`);
  console.log(`  採用済み投稿: ${adopted.length}件 / 全 ${posts.length}件`);
  console.log(`  抽出済み画像: ${done.size}枚（再課金しません）`);
  console.log(`  対象画像: ${targets.length}枚` + (args.limit !== null ? `（全 ${totalCandidates}枚のうち --limit 指定）` : ''));
  console.log(`  概算費用: ${usd(estCost)}（入力 ${estIn.toLocaleString()} tok 前提の上限見積）\n`);

  if (targets.length === 0) {
    console.log('抽出対象がありません。--force で再抽出できます。');
    return;
  }
  if (args.dryRun) {
    console.log('--dry-run なので API は呼びません。対象:');
    for (const t of targets.slice(0, 20)) {
      console.log(`  @${t.post.handle} ${t.post.id}[${t.mediaIndex}]`);
    }
    if (targets.length > 20) console.log(`  ... 他 ${targets.length - 20}枚`);
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
  const records: ExtractionRecord[] = [...existing];
  let inTok = 0;
  let outTok = 0;
  let ok = 0;
  let failed = 0;
  let notOshinagaki = 0;

  const persist = async (): Promise<void> => {
    // mediaKey でユニークにする（--force のとき古い結果を残さない）
    const byKey = new Map<string, ExtractionRecord>();
    for (const r of records) byKey.set(r.mediaKey, r);
    await writeJson(dataPath('items.json'), [...byKey.values()]);
  };

  for (const [i, t] of targets.entries()) {
    const label = `[${i + 1}/${targets.length}] @${t.post.handle} ${t.post.id}[${t.mediaIndex}]`;
    try {
      const res = await client.messages.parse({
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: 'adaptive' },
        output_config: {
          // 機械的な読み取りなので低 effort で足りる。費用と待ち時間を抑える。
          effort: 'low',
          // スキーマ検証は SDK 側で行われ、parsed_output に型付きで返る
          format: zodOutputFormat(ResponseSchema),
        },
        system: [
          {
            type: 'text',
            text: SYSTEM_PROMPT,
            // 全画像で同じ指示なのでキャッシュする
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: t.apiUrl } },
              {
                type: 'text',
                text:
                  `この画像から商品情報を読み取ってください。\n\n` +
                  `参考情報（投稿本文）:\n${t.post.text || '（本文なし）'}`,
              },
            ],
          },
        ],
      });

      inTok += res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0);
      outTok += res.usage.output_tokens;

      if (res.stop_reason === 'refusal') {
        records.push({
          postId: t.post.id,
          mediaIndex: t.mediaIndex,
          mediaKey: t.key,
          isOshinagaki: false,
          items: [],
          error: `読み取りを拒否されました（${res.stop_details?.category ?? '理由不明'}）`,
          extractedAt: new Date().toISOString(),
          model: MODEL,
          usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
        });
        failed += 1;
        console.log(`${label} 拒否`);
        await persist();
        continue;
      }

      const parsed = res.parsed_output;
      if (!parsed) {
        throw new Error('構造化出力を解釈できませんでした');
      }

      const items: ExtractedItem[] = parsed.items.map((it) => ({
        postId: t.post.id,
        mediaIndex: t.mediaIndex,
        name: it.name,
        price: it.price,
        priceNote: it.priceNote,
        category: it.category,
        note: it.note,
        confidence: it.confidence,
      }));

      records.push({
        postId: t.post.id,
        mediaIndex: t.mediaIndex,
        mediaKey: t.key,
        isOshinagaki: parsed.isOshinagaki,
        items,
        error: null,
        extractedAt: new Date().toISOString(),
        model: MODEL,
        usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      });

      if (parsed.isOshinagaki) {
        ok += 1;
        const low = items.filter((it) => it.confidence === 'low').length;
        console.log(
          `${label} ${items.length}商品` + (low > 0 ? `（うち自信度低 ${low}件）` : ''),
        );
      } else {
        notOshinagaki += 1;
        console.log(`${label} お品書きではないと判定`);
      }

      await persist();
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      console.log(`${label} 失敗: ${message}`);
      records.push({
        postId: t.post.id,
        mediaIndex: t.mediaIndex,
        mediaKey: t.key,
        isOshinagaki: false,
        items: [],
        error: message,
        extractedAt: new Date().toISOString(),
        model: MODEL,
        usage: null,
      });
      await persist();
      // レート制限なら少し待つ（SDK も既定でリトライする）
      if (/rate limit|429/i.test(message)) await sleep(20_000);
    }
  }

  await persist();

  const cost = (inTok / 1e6) * PRICE_IN_PER_MTOK + (outTok / 1e6) * PRICE_OUT_PER_MTOK;
  const totalItems = records.reduce((n, r) => n + r.items.length, 0);

  console.log(`\n完了`);
  console.log(`  お品書きとして読み取れた: ${ok}枚`);
  if (notOshinagaki > 0) console.log(`  お品書きではなかった: ${notOshinagaki}枚`);
  if (failed > 0) console.log(`  失敗: ${failed}枚`);
  console.log(`  抽出済み商品の総数: ${totalItems}件`);
  console.log(`  実測トークン: 入力 ${inTok.toLocaleString()} / 出力 ${outTok.toLocaleString()}`);
  console.log(`  実測費用: ${usd(cost)}`);
  if (targets.length > 0) {
    const per = cost / targets.length;
    console.log(`  1枚あたり: ${usd(per)} → 200枚換算 ${usd(per * 200)}`);
  }
  console.log(`  → data/items.json`);
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
