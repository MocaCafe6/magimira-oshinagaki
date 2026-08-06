/** 公開されている投稿の本文を一覧する（目視確認用） */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { selectPostsForVenue } from './lib/curation';
import { VENUES, type Curation, type Post, type Venue } from './lib/types';

const DATA = path.join(process.cwd(), 'data');

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path.join(DATA, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  const posts = await readJson<Post[]>('posts.json', []);
  const curation = await readJson<Curation>('curation.json', {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });

  const seen = new Set<string>();
  for (const v of VENUES as readonly Venue[]) {
    const sel = selectPostsForVenue(posts, curation, v);
    console.log(`\n===== ${v} : ${sel.length}件 =====`);
    for (const p of sel) {
      const dup = seen.has(p.id) ? ' (両会場)' : '';
      seen.add(p.id);
      const t = p.text.replace(/\s+/g, ' ').slice(0, 150);
      console.log(`@${p.handle}${dup}  ${p.attribution?.source}`);
      console.log(`  ${t}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
