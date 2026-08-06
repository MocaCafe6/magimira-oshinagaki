/**
 * 競合サイトだけが商品情報を持っているブースについて、
 * 本サイトがなぜ拾えていないのかを1件ずつ突き止める。
 *
 *   npm run diagnose-gaps -- osaka A-3 A-9 ...
 *   npm run diagnose-gaps            （既定のリストで実行）
 *
 * 競合を正解データとして使う。落ちている理由が
 *   「Xに投稿が無い」        → 構造的に届かない。こちらの欠陥ではない
 *   「投稿はあるが検出漏れ」  → **こちらの欠陥**。直せる
 * のどちらなのかを分ける。
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { isMagimiraPost, isOshinagakiPost, ADOPT_SCORE_THRESHOLD } from './lib/curation';
import type { Creator, Post, Venue } from './lib/types';

const DATA = path.join(process.cwd(), 'data');

/** npm run compare-competitor の「競合だけが持っているブース」より */
const DEFAULT_GAPS: Record<Venue, string[]> = {
  osaka: ['A-10', 'A-3', 'A-9', 'B-5', 'B-7', 'C-2', 'D-1', 'E-1', 'E-4', 'F-1', 'F-10', 'G-10'],
  tokyo: ['A-9', 'B-1', 'B-12', 'B-19', 'B-20', 'B-21', 'B-31', 'C-11', 'C-2', 'D-1', 'D-2'],
};

async function read<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

const canon = (b: string): string => b.toUpperCase().replace(/^([A-G])-?0*(\d+)$/, '$1-$2');

async function main() {
  const posts = await read<Post[]>('posts.json', []);
  const byHandle = new Map<string, Post[]>();
  for (const p of posts) {
    const k = p.handle.toLowerCase();
    if (!byHandle.has(k)) byHandle.set(k, []);
    byHandle.get(k)!.push(p);
  }

  const tally = { noHandle: 0, noPosts: 0, noPhoto: 0, lowScore: 0, notOshinagaki: 0, unresolved: 0, other: 0 };

  for (const venue of ['osaka', 'tokyo'] as Venue[]) {
    const creators = [
      ...(await read<Creator[]>(`creators.${venue}.json`, [])),
      ...(await read<Creator[]>(`sponsors.${venue}.json`, [])),
    ];
    console.log(`\n════ ${venue === 'osaka' ? '大阪' : '東京'} ════`);

    for (const booth of DEFAULT_GAPS[venue]) {
      const c = creators.find((x) => x.boothId && canon(x.boothId) === canon(booth));
      if (!c) {
        console.log(`${booth.padEnd(6)} 公式データに該当ブースが無い`);
        tally.other++;
        continue;
      }
      const name = c.circleName.slice(0, 16);

      if (c.xHandles.length === 0) {
        console.log(`${booth.padEnd(6)} ${name.padEnd(18)} Xアカウントが公式に載っていない`);
        tally.noHandle++;
        continue;
      }

      const mine = c.xHandles.flatMap((h) => byHandle.get(h.toLowerCase()) ?? []);
      if (mine.length === 0) {
        console.log(`${booth.padEnd(6)} ${name.padEnd(18)} @${c.xHandles[0]} — 投稿を1件も取得できていない`);
        tally.noPosts++;
        continue;
      }

      const withPhoto = mine.filter((p) => p.media.some((m) => m.kind === 'photo'));
      const magimira = withPhoto.filter((p) => isMagimiraPost(p));
      const scored = magimira.filter((p) => p.score >= ADOPT_SCORE_THRESHOLD);
      const osh = scored.filter((p) => isOshinagakiPost(p));
      const proven = osh.filter((p) => p.attribution?.provenVenues.includes(venue));

      let reason: string;
      if (withPhoto.length === 0) {
        reason = '画像つき投稿が無い';
        tally.noPhoto++;
      } else if (magimira.length === 0) {
        reason = 'マジミラに言及した画像つき投稿が無い';
        tally.noPhoto++;
      } else if (scored.length === 0) {
        reason = `スコアが閾値未満（最高 ${Math.max(...magimira.map((p) => p.score))}）`;
        tally.lowScore++;
      } else if (osh.length === 0) {
        reason = 'お品書きだと判定できていない ← 画像を読めば解決する';
        tally.notOshinagaki++;
      } else if (proven.length === 0) {
        reason = '会場が確定していない ← 画像を読めば解決する';
        tally.unresolved++;
      } else {
        reason = '掲載されているはず（要確認）';
        tally.other++;
      }

      console.log(
        `${booth.padEnd(6)} ${name.padEnd(18)} @${(c.xHandles[0] ?? '').padEnd(16)} 投稿${String(mine.length).padStart(3)} 画像付${String(withPhoto.length).padStart(3)} 候補${String(scored.length).padStart(2)}  ${reason}`,
      );
    }
  }

  console.log('\n════ 落ちている理由の内訳 ════');
  console.log(`  Xアカウントが公式に無い          ${tally.noHandle}`);
  console.log(`  投稿を取得できていない            ${tally.noPosts}`);
  console.log(`  マジミラの画像つき投稿が無い      ${tally.noPhoto}`);
  console.log(`  スコアが閾値未満                  ${tally.lowScore}`);
  console.log(`  お品書きだと判定できていない      ${tally.notOshinagaki}  ← 直せる`);
  console.log(`  会場が確定していない              ${tally.unresolved}  ← 直せる`);
  console.log(`  その他                            ${tally.other}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
