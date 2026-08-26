/**
 * 「その画像は人が見た」という記録。
 *
 * data/image-reads.json は**読み取った内容**を書くところで、
 * 「見たが、お品書きではなかった」を全部そこに書くのは現実的でない
 * （1回の走査で数百枚を見る）。かといって記録しないと、次の走査でも
 * 同じ数百枚が候補に並び、いつまでも収束しない。
 *
 * そこで「見た」という事実だけを別に持つ。掲載判定には一切影響しない。
 * 走査の道具（scan-unlisted / venue-diff）が既定で候補から外すだけ。
 *
 * 投稿は編集されないので、一度見た画像を見直す必要はない。
 * 見直したいときは --include-reviewed を付ける。
 */
import { dataPath, readJson, writeJson } from './io';

export type ReviewLogEntry = {
  postId: string;
  /** 見た日（YYYY-MM-DD） */
  reviewedAt: string;
  /** 何の走査で見たか */
  note?: string;
};

const FILE = 'image-review-log.json';

export async function loadReviewLog(): Promise<Set<string>> {
  const rows = await readJson<ReviewLogEntry[]>(dataPath(FILE), []);
  return new Set(rows.map((r) => r.postId));
}

/** 見た記録を足す。既にあるものは触らない */
export async function addToReviewLog(
  postIds: string[],
  reviewedAt: string,
  note: string,
): Promise<number> {
  const rows = await readJson<ReviewLogEntry[]>(dataPath(FILE), []);
  const known = new Set(rows.map((r) => r.postId));
  let added = 0;
  for (const id of postIds) {
    if (known.has(id)) continue;
    known.add(id);
    rows.push({ postId: id, reviewedAt, note });
    added++;
  }
  await writeJson(dataPath(FILE), rows);
  return added;
}
