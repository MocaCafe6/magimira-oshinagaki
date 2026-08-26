/**
 * 「この画像は目で見た」を記録する。掲載判定には影響しない。
 *
 *   npm run mark-reviewed -- --dir <fetch-images-for-review の出力先> --note "東京走査2回目"
 *   npm run mark-reviewed -- --ids 123,456 --note "..."
 *
 * 走査でシートを見終わったら必ず通す。これをしないと次の走査でも
 * 同じ画像が候補に並び、新しく出たお品書きが山に埋もれる。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { addToReviewLog } from './lib/review-log';

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const dir = arg('--dir');
  const ids = arg('--ids');
  const note = arg('--note') ?? '目視走査';
  const date = arg('--date') ?? new Date().toISOString().slice(0, 10);

  const postIds: string[] = [];
  if (dir) {
    const index = JSON.parse(await readFile(path.join(dir, '_index.json'), 'utf8')) as {
      id: string;
    }[];
    postIds.push(...index.map((r) => r.id));
  }
  if (ids) postIds.push(...ids.split(',').map((s) => s.trim()).filter(Boolean));
  if (postIds.length === 0) throw new Error('--dir か --ids のどちらかが要ります');

  const added = await addToReviewLog(postIds, date, note);
  console.log(`目視済みとして記録: ${added}件（指定 ${postIds.length}件、うち既存 ${postIds.length - added}件）`);
  console.log('  → data/image-review-log.json');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
