/**
 * 公式ページに載っている出展者の Web サイトを開き、
 * そこに書かれている X アカウントへのリンクを拾う。
 *
 *   npm run find-x-from-website
 *   npm run find-x-from-website -- --limit 5
 *
 * ## なぜこの手が要るか
 *
 * 名前で X を検索する方法（find-x-handles）は企業ブースに効かない。
 * 実測で43件中1件しか決まらなかった。X のユーザー検索は一致が無くても
 * 空を返さず、「株式会社タイトー」で検索すると自称アカウントが2つ出る
 * ような状態で、どれが本物か名前だけでは決められない。
 *
 * 一方、公式の出展者一覧には各社の Web サイトが載っている（大阪の
 * 企業ブースは X リンクが無い30件のうち29件にサイトのURLがある）。
 * 企業サイトは自社の X アカウントへリンクしている。
 *
 * これは**その会社自身が「これがうちのアカウントだ」と書いている**ので、
 * 名前が似ているという推測とは別物。同名の別人を拾う余地が無い。
 * よって自動採用してよい（x-handles-proven.json に書く）。
 *
 * ## 誤って拾わないための条件
 *
 *   - リンク先が x.com / twitter.com のプロフィールURLであること
 *     （/status/ や /share や /intent は投稿・共有ボタンなので除く）
 *   - 1サイトから1アカウントに絞れること
 *     複数出てきたら（ブランドごとに別アカウントがある等）自動採用しない
 *   - 明らかに他社のものは除く（X 公式、埋め込みウィジェット由来など）
 */
import { chromium } from 'playwright';

import { dataPath, jitter, readJson, sleep, writeJson } from './lib/io';
import type { Creator, RefVenue } from './lib/types';

const DELAY_MIN_MS = 2_000;
const DELAY_MAX_MS = 4_000;

/** 拾ってはいけないハンドル。X 自身や共有ボタンの宛先 */
const IGNORE = new Set(
  [
    'x', 'twitter', 'twitterapi', 'support', 'safety', 'verified', 'home',
    'explore', 'i', 'intent', 'share', 'hashtag', 'search', 'login', 'signup',
    'settings', 'privacy', 'tos', 'about', 'compose', 'messages',
  ].map((s) => s.toLowerCase()),
);

type Finding = {
  circleName: string;
  siteUrl: string;
  venues: { venue: RefVenue; boothId: string | null }[];
  handles: string[];
  adopted: string | null;
  reason: string;
};

/** ページ内の x.com / twitter.com プロフィールリンクからハンドルを抽出する */
function handlesFromHrefs(hrefs: string[]): string[] {
  const out: string[] = [];
  for (const href of hrefs) {
    let u: URL;
    try {
      u = new URL(href);
    } catch {
      continue;
    }
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com' && host !== 'mobile.twitter.com') continue;

    const seg = u.pathname.split('/').filter(Boolean);
    if (seg.length === 0) continue;
    // /intent/tweet, /share, /user/status/... は投稿・共有ボタン
    if (seg.length > 1) continue;
    const h = seg[0]!;
    if (!/^[A-Za-z0-9_]{1,15}$/.test(h)) continue;
    if (IGNORE.has(h.toLowerCase())) continue;
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--limit');
  const limit = i >= 0 ? Number(argv[i + 1]) : Infinity;

  // X ハンドルが無く、Web サイトのURLがある出展者を集める
  const targets = new Map<string, Finding>();
  for (const v of ['osaka', 'tokyo'] as RefVenue[]) {
    for (const kind of ['creators', 'sponsors']) {
      const list = await readJson<Creator[]>(dataPath(`${kind}.${v}.json`), []);
      for (const c of list) {
        if ((c.xHandles ?? []).length > 0) continue;
        const url = (c.members ?? [])
          .flatMap((m) => m.links ?? [])
          .map((l) => l.url)
          .find((u) => /^https?:\/\//.test(u));
        if (!url) continue;
        const cur = targets.get(c.circleName);
        if (cur) {
          cur.venues.push({ venue: v, boothId: c.boothId });
          continue;
        }
        targets.set(c.circleName, {
          circleName: c.circleName,
          siteUrl: url,
          venues: [{ venue: v, boothId: c.boothId }],
          handles: [],
          adopted: null,
          reason: '',
        });
      }
    }
  }

  const queue = [...targets.values()].slice(0, limit);
  console.log('公式サイトから X アカウントを辿ります');
  console.log(`  対象: ${queue.length}件\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
  });
  // 画像・動画は要らない。相手のサイトに余計な負荷をかけない
  await context.route('**/*', (route) => {
    const t = route.request().resourceType();
    if (t === 'image' || t === 'media' || t === 'font') return route.abort();
    return route.continue();
  });
  const page = await context.newPage();

  let done = 0;
  for (const t of queue) {
    done++;
    try {
      await page.goto(t.siteUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(1500);
      const hrefs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).map((a) => (a as HTMLAnchorElement).href),
      );
      t.handles = handlesFromHrefs(hrefs);
    } catch (e) {
      t.reason = `サイトを開けなかった: ${(e as Error).message.split('\n')[0]}`;
    }

    if (t.handles.length === 1) {
      t.adopted = t.handles[0]!;
      t.reason = `公式サイト（${new URL(t.siteUrl).hostname}）が自社の X アカウントとしてリンクしている`;
    } else if (t.handles.length > 1) {
      t.reason = `X へのリンクが${t.handles.length}本あり、どれが本体か決められない（${t.handles.join(', ')}）`;
    } else if (!t.reason) {
      t.reason = 'サイトに X へのリンクが無い';
    }

    console.log(
      `[${String(done).padStart(3)}/${queue.length}] ${t.circleName.slice(0, 20).padEnd(22)} ${
        t.adopted ? `→ @${t.adopted}` : '—'
      }  ${t.reason}`,
    );
    await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
  }

  await browser.close();

  const out = [...targets.values()];
  await writeJson(dataPath('x-handle-from-website.json'), out);

  const proven = await readJson<Record<string, string[]>>(dataPath('x-handles-proven.json'), {});
  let added = 0;
  for (const t of out) {
    if (!t.adopted) continue;
    const cur = proven[t.circleName] ?? [];
    if (!cur.includes(t.adopted)) {
      proven[t.circleName] = [...cur, t.adopted];
      added++;
    }
  }
  await writeJson(dataPath('x-handles-proven.json'), proven);

  console.log('\n完了');
  console.log(`  自動採用: ${added}件 / ${out.length}件`);
  console.log('  → data/x-handles-proven.json');
  console.log('  → data/x-handle-from-website.json（内訳）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
