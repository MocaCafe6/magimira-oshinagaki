/**
 * UI 検証用のフィクスチャを生成する。
 *
 *   npm run fixture           … data/posts.json と data/items.json を作る
 *   npm run fixture -- --clean … 消す
 *
 * X のクロールにはログイン済みセッションが必要で、CI や初回セットアップでは
 * 動かせない。お品書きの表示経路（画像グリッド・原寸ライトボックス・商品表・
 * レビューUI）を検証できるようにするため、実データと同じ形の投稿を作る。
 *
 * ⚠ 画像URLは実在しないので表示は壊れる。それ自体が
 *   「クリエイターが投稿を削除したとき」の見た目の確認になる。
 * ⚠ 本番のデータを上書きするので、既存の posts.json があるときは中断する。
 */

import { rm } from 'node:fs/promises';

import { dataPath, readJson, writeJson } from './lib/io';
import { mediaKey } from './lib/media-key';
import { scoreOshinagaki } from './lib/oshinagaki-score';
import { buildMediaUrls } from './lib/x-graphql';
import type { Creator, ExtractionRecord, Post, PostMedia, VenueAttribution } from './lib/types';

const FIXTURE_MARK = '__fixture__';

function media(id: string, alt: string | null, w: number, h: number): PostMedia {
  const urls = buildMediaUrls(`https://pbs.twimg.com/media/${id}.jpg`);
  return { ...urls, kind: 'photo', altText: alt, width: w, height: h, videoUrl: null };
}

/** 大阪と確定した状態の帰属（表示経路の検証に使う） */
function osakaAttribution(boothId: string | null): VenueAttribution {
  return {
    provenVenues: ['osaka'],
    daysByVenue: {},
    otherVenues: [],
    source: 'text-booth',
    evidence: [`${FIXTURE_MARK} 本文の「大阪 ${boothId ?? ''}」が公式のブース番号と一致`],
  };
}

async function clean(): Promise<void> {
  for (const f of ['posts.json', 'items.json']) {
    const existing = await readJson<unknown[]>(dataPath(f), []);
    const isFixture =
      Array.isArray(existing) && existing.some((r) => JSON.stringify(r).includes(FIXTURE_MARK));
    if (existing.length > 0 && !isFixture) {
      console.log(`  ${f} はフィクスチャではないので残します（本番データ）`);
      continue;
    }
    await rm(dataPath(f), { force: true });
    console.log(`  削除: data/${f}`);
  }
  console.log('フィクスチャを削除しました。');
}

async function generate(): Promise<void> {
  const existingPosts = await readJson<Post[]>(dataPath('posts.json'), []);
  const isFixture = existingPosts.some((p) => p.text.includes(FIXTURE_MARK));
  if (existingPosts.length > 0 && !isFixture) {
    throw new Error(
      'data/posts.json に本番データがあります。上書きしないため中断しました。' +
        '（意図的に置き換えるなら先に posts.json を退避してください）',
    );
  }

  const creators = await readJson<Creator[]>(dataPath('creators.osaka.json'), []);
  if (creators.length === 0) {
    throw new Error('先に `npm run scrape-official` を実行してください。');
  }

  // 実際にお品書きを出しそうな、X ハンドルを持つサークルを数件選ぶ
  const targets = creators.filter((c) => c.xHandles.length > 0).slice(0, 6);

  const posts: Post[] = [];
  const items: ExtractionRecord[] = [];

  targets.forEach((c, i) => {
    const handle = c.xHandles[0]!;
    const postId = `900000000000000${i}`;
    const text =
      `${FIXTURE_MARK} マジカルミライ2026 大阪 ${c.boothId} のお品書きです！\n` +
      `新作アクリルスタンドと缶バッジを頒布します。よろしくお願いします。\n` +
      `#マジカルミライ2026`;

    const mediaList: PostMedia[] = [
      media(`Gfixture${i}a`, `${c.circleName} のお品書き`, 1448, 2048),
    ];
    // 2枚組・4枚組のレイアウトも確認できるようにする
    if (i % 3 === 1) mediaList.push(media(`Gfixture${i}b`, null, 2048, 1448));
    if (i % 3 === 2) {
      mediaList.push(media(`Gfixture${i}b`, null, 1200, 1200));
      mediaList.push(media(`Gfixture${i}c`, null, 1200, 1200));
      mediaList.push(media(`Gfixture${i}d`, null, 1200, 1200));
    }

    const base = {
      id: postId,
      handle,
      url: `https://x.com/${handle}/status/${postId}`,
      text,
      createdAt: new Date(Date.UTC(2026, 7, 1 + i, 3, 0, 0)).toISOString(),
      media: mediaList,
      isPinned: i === 0,
      isReply: false,
      isRetweet: false,
      isManual: false,
      source: 'search' as const,
    };
    const { score, signals } = scoreOshinagaki({
      text: base.text,
      mediaCount: base.media.length,
      isPinned: base.isPinned,
      isReply: false,
      isRetweet: false,
      createdAt: base.createdAt,
      boothIds: c.boothId ? [c.boothId] : [],
    });
    posts.push({
      ...base,
      score,
      matchedSignals: signals,
      attribution: osakaAttribution(c.boothId),
    });

    // AI 抽出結果（最初の3件ぶんだけ。未抽出の見た目も確認するため）
    if (i < 3) {
      items.push({
        postId,
        mediaIndex: 0,
        // 抽出側と同じキー関数を使う。これが一致していないと
        // 「同じ画像に二度課金しない」仕組みを検証できない。
        mediaKey: mediaKey(mediaList[0]!.baseUrl),
        isOshinagaki: true,
        items: [
          {
            postId,
            mediaIndex: 0,
            name: `${c.circleName} アクリルスタンド`,
            price: 2000,
            priceNote: '税込',
            category: 'アクリルスタンド',
            note: null,
            confidence: 'high',
          },
          {
            postId,
            mediaIndex: 0,
            name: '缶バッジセット（5個入）',
            price: 1500,
            priceNote: '5個セット',
            category: '缶バッジ',
            note: 'ランダム封入',
            confidence: 'medium',
          },
          {
            postId,
            mediaIndex: 0,
            name: '新譜CD「テスト楽曲集」',
            price: 3000,
            priceNote: null,
            category: 'CD・音楽',
            note: null,
            confidence: 'high',
          },
          {
            postId,
            mediaIndex: 0,
            name: '（読み取り不明な商品）',
            price: null,
            priceNote: null,
            category: 'その他',
            note: '文字が小さく判読できませんでした',
            confidence: 'low',
          },
        ],
        error: null,
        extractedAt: new Date(Date.UTC(2026, 7, 5, 0, 0, 0)).toISOString(),
        model: `${FIXTURE_MARK}`,
        usage: { inputTokens: 4784, outputTokens: 420 },
      });
    }
  });

  // リプライ・古い投稿など、却下されるべき候補も混ぜる（レビューUIの確認用）
  const noise = targets[0];
  if (noise) {
    const handle = noise.xHandles[0]!;
    const noiseText = `${FIXTURE_MARK} 新曲を投稿しました！聴いてください`;
    const noiseCreatedAt = new Date(Date.UTC(2026, 6, 20, 3, 0, 0)).toISOString();
    posts.push({
      id: '9000000000000099',
      handle,
      url: `https://x.com/${handle}/status/9000000000000099`,
      text: noiseText,
      createdAt: noiseCreatedAt,
      media: [media('Gfixturenoise', null, 1200, 675)],
      isPinned: false,
      isReply: false,
      isRetweet: false,
      score: scoreOshinagaki({
        text: noiseText,
        mediaCount: 1,
        isPinned: false,
        isReply: false,
        isRetweet: false,
        createdAt: noiseCreatedAt,
      }).score,
      matchedSignals: [],
      // 会場が確定できない投稿の見た目も確認する
      attribution: null,
      isManual: false,
      source: 'search',
    });
  }

  await writeJson(dataPath('posts.json'), posts);
  await writeJson(dataPath('items.json'), items);

  console.log(`フィクスチャを生成しました（UI 検証用）`);
  console.log(`  data/posts.json : ${posts.length}件`);
  console.log(`  data/items.json : ${items.length}件`);
  console.log(`\n  ⚠ 画像URLは実在しません（表示は壊れます）。`);
  console.log(`  ⚠ 検証が終わったら \`npm run fixture -- --clean\` で消してください。`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--clean')) {
    await clean();
    return;
  }
  await generate();
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
