import { createHash } from 'node:crypto';

/**
 * 画像の同一性キー。
 *
 * 抽出結果のキャッシュに使う。同じ画像に二度 API 課金しないための要なので、
 * 抽出側（extract-items.ts）とフィクスチャ生成側で必ず同じ関数を使う。
 * pbs.twimg.com の baseUrl は投稿ごとに一意なのでこれで十分。
 */
export function mediaKey(baseUrl: string): string {
  return createHash('sha256').update(baseUrl).digest('hex').slice(0, 16);
}
