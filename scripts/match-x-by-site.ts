/**
 * X のプロフィールに書かれたサイトURLと、公式の出展者一覧に載っている
 * サイトURLを突き合わせて、アカウントを特定する。
 *
 *   npm run match-x-by-site
 *   npm run match-x-by-site -- --limit 3
 *
 * ## これまでの手が届かなかったところ
 *
 *   find-x-handles      … 名前で X を検索する。企業に効かない（43件中1件）。
 *                          X のユーザー検索は一致が無くても無関係な
 *                          アカウントを返し、名前だけでは本物を選べない。
 *   find-x-from-website … 公式サイトを開いて X リンクを拾う。42件中19件。
 *                          サイトに X リンクを置いていない会社には効かない。
 *
 * 残ったのは「公式サイトはあるが、そこに X リンクが無い」ブース。
 * タイトー、ヤマハミュージックジャパン、セガ フェイブ など。
 *
 * ## 逆方向から見る
 *
 * サイト → X が無くても、X → サイト は書かれていることが多い。
 * X のプロフィール欄のリンクが、公式ページに載っているのと同じ
 * ドメインを指していれば、そのアカウントはその会社のものである。
 *
 * これは名前が似ているという推測ではない。**アカウント側が自分の
 * サイトとして公式と同じドメインを申告している**という照合で、
 * find-x-from-website と対になる。よって自動採用する。
 *
 * ## 候補の集め方
 *
 * 名前で引けないから困っているので、名前以外の入口も使う:
 *   - サークル名・メンバー名でのユーザー検索（従来どおり）
 *   - 公式サイトのドメインで**投稿**を検索
 *     企業は自社ページのURLを添えて告知する。そのURLを含む投稿の
 *     著者は本人である可能性が高い。ここでは候補として拾うだけで、
 *     採否はプロフィールのドメイン照合で決める。
 */
import { chromium, type Page } from 'playwright';

import { dataPath, jitter, readJson, sleep, writeJson } from './lib/io';
import { siteKey } from './lib/site-key';
import type { Creator, RefVenue } from './lib/types';
import { blockHeavyResources, createLoggedInContext, looksLoggedOut } from './lib/x-session';

const DELAY_MIN_MS = 4_000;
const DELAY_MAX_MS = 8_000;
const MAX_PROFILE_CHECKS = 8;

type Target = {
  circleName: string;
  memberNames: string[];
  venues: { venue: RefVenue; boothId: string | null }[];
  /** 公式ページに載っているサイトのホスト名 */
  officialHosts: string[];
  officialUrls: string[];
  candidates: string[];
  /** 投稿検索で出てきたもの。名前検索より本人である可能性が高い */
  fromPostSearch: string[];
  checked: { handle: string; displayName: string; profileUrl: string; matched: boolean }[];
  adopted: string | null;
  reason: string;
};

/** 比較用に名前を潰す */
function canon(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s　・･!！?？'’"”「」『』（）()[\]【】\-–—_.,、。/／＆&+＋株式会社有限会社㈱]/g, '');
}

/**
 * プロフィールを見に行く順番を決める。
 *
 * X の検索はどのサークルで引いても同じ無関係アカウントを返してくる。
 * 上から順に見ると本命に届かないので、次の順で並べ替える:
 *   1. ハンドルがサークル名・メンバー名・公式ドメインの語に寄っている
 *   2. 投稿検索で出てきた（自社URLを添えて告知した本人の可能性が高い）
 *   3. それ以外
 */
function rankCandidates(t: Target): string[] {
  const needles = [
    ...[t.circleName, ...t.memberNames].map(canon),
    // taito.co.jp → taito、store.p-i-i-t.com → piit
    ...t.officialHosts.map((h) => canon(h.split('/')[0]!.split('.')[0]!)),
    ...t.officialHosts.flatMap((h) => h.split('/')[0]!.split('.').map(canon)),
  ].filter((n) => n.length >= 3);

  const score = (h: string): number => {
    const ch = canon(h);
    if (needles.some((n) => ch.includes(n) || n.includes(ch))) return 0;
    if (t.fromPostSearch.includes(h)) return 1;
    return 2;
  };
  return [...t.candidates].sort((a, b) => score(a) - score(b));
}

/** X のユーザー検索 */
async function searchAccounts(page: Page, query: string): Promise<string[]> {
  await page.goto(`https://x.com/search?f=user&q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  if (looksLoggedOut(page.url())) throw new Error('ログイン画面に飛ばされました');
  await page.waitForTimeout(3500);
  return await page.evaluate(() => {
    const out: string[] = [];
    for (const cell of Array.from(document.querySelectorAll('[data-testid="UserCell"]')).slice(0, 6)) {
      const href = cell.querySelector('a[href^="/"]')?.getAttribute('href') ?? '';
      const h = href.replace(/^\//, '');
      if (h && !h.includes('/') && !out.includes(h)) out.push(h);
    }
    return out;
  });
}

/** X の投稿検索。著者のハンドルだけを返す */
async function searchPostAuthors(page: Page, query: string): Promise<string[]> {
  await page.goto(`https://x.com/search?f=live&q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  if (looksLoggedOut(page.url())) throw new Error('ログイン画面に飛ばされました');
  await page.waitForTimeout(3500);
  return await page.evaluate(() => {
    const out: string[] = [];
    for (const art of Array.from(document.querySelectorAll('article')).slice(0, 12)) {
      const href = Array.from(art.querySelectorAll('a[href*="/status/"]'))
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => /^\/[^/]+\/status\/\d+/.test(h));
      const h = href ? href.split('/')[1]! : '';
      if (h && !out.includes(h)) out.push(h);
    }
    return out;
  });
}

/** プロフィールを開いて、表示名と「プロフィール欄のリンク」を読む */
async function readProfile(
  page: Page,
  handle: string,
): Promise<{ displayName: string; profileUrl: string; bio: string } | null> {
  await page.goto(`https://x.com/${handle}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (looksLoggedOut(page.url())) throw new Error('ログイン画面に飛ばされました');
  await page.waitForTimeout(3500);
  return await page.evaluate(() => {
    const head = document.querySelector('[data-testid="UserName"]') as HTMLElement | null;
    const bioEl = document.querySelector('[data-testid="UserDescription"]') as HTMLElement | null;
    const urlEl = document.querySelector('[data-testid="UserUrl"]') as HTMLElement | null;
    if (!head) return null;
    // プロフィール欄のリンクは t.co に包まれるが、表示文字列は本来のドメイン
    const shown = urlEl?.innerText?.trim() ?? '';
    return {
      displayName: head.innerText.split('\n')[0] ?? '',
      profileUrl: shown,
      bio: bioEl?.innerText?.replace(/\s+/g, ' ').slice(0, 160) ?? '',
    };
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const i = argv.indexOf('--limit');
  const limit = i >= 0 ? Number(argv[i + 1]) : Infinity;

  const targets = new Map<string, Target>();
  for (const v of ['osaka', 'tokyo'] as RefVenue[]) {
    for (const kind of ['creators', 'sponsors']) {
      const list = await readJson<Creator[]>(dataPath(`${kind}.${v}.json`), []);
      for (const c of list) {
        if ((c.xHandles ?? []).length > 0) continue;
        const urls = (c.members ?? [])
          .flatMap((m) => m.links ?? [])
          .map((l) => l.url)
          .filter((u) => /^https?:\/\//.test(u));
        const cur = targets.get(c.circleName);
        if (cur) {
          cur.venues.push({ venue: v, boothId: c.boothId });
          continue;
        }
        targets.set(c.circleName, {
          circleName: c.circleName,
          memberNames: (c.members ?? []).map((m) => m.name).filter(Boolean),
          venues: [{ venue: v, boothId: c.boothId }],
          officialUrls: urls,
          officialHosts: [...new Set(urls.map(siteKey).filter((h): h is string => Boolean(h)))],
          candidates: [],
          fromPostSearch: [],
          checked: [],
          adopted: null,
          reason: '',
        });
      }
    }
  }

  const queue = [...targets.values()].filter((t) => t.officialHosts.length > 0).slice(0, limit);
  console.log('X プロフィールのリンク先で照合します');
  console.log(`  対象: ${queue.length}件（公式サイトのURLがあるもの）\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await createLoggedInContext(browser);
  await blockHeavyResources(context);
  const page = await context.newPage();

  let done = 0;
  for (const t of queue) {
    done++;
    const add = (hs: string[]): void => {
      for (const h of hs) if (!t.candidates.includes(h)) t.candidates.push(h);
    };

    // 候補を集める。名前で引けないから困っているので、名前以外も使う
    const queries: { kind: 'user' | 'post'; q: string }[] = [
      { kind: 'user', q: t.circleName },
      ...t.memberNames.slice(0, 1).map((m) => ({ kind: 'user' as const, q: m })),
      // 公式サイトのドメインを含む投稿。企業は自社URLを添えて告知する
      ...t.officialHosts.map((h) => ({ kind: 'post' as const, q: `${h} マジカルミライ` })),
    ];
    for (const { kind, q } of queries.slice(0, 4)) {
      try {
        const hs = kind === 'user' ? await searchAccounts(page, q) : await searchPostAuthors(page, q);
        if (kind === 'post') for (const h of hs) if (!t.fromPostSearch.includes(h)) t.fromPostSearch.push(h);
        add(hs);
      } catch (e) {
        t.reason = `検索失敗: ${(e as Error).message}`;
      }
      await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
    }

    // プロフィールのリンク先が公式と同じドメインなら本人。
    //
    // 見に行く順番が効く。X の検索は毎回同じ無関係アカウントを返してきて
    // （@neonrustworks @zero06410354 @Hiroki199008 など、どのサークルで
    // 検索しても出る）、そのまま上から見ると確認枠を食い潰して本命に
    // 届かない。実際 Domingoブースの @cfm_domingo と
    // forute の @forute723 は未確認のまま落ちていた。
    // 名前が寄っているものを先に見る。
    for (const h of rankCandidates(t).slice(0, MAX_PROFILE_CHECKS)) {
      if (t.adopted) break;
      try {
        const p = await readProfile(page, h);
        if (!p) continue;
        const shownHost = p.profileUrl ? (siteKey(p.profileUrl) ?? '') : '';
        const matched = Boolean(shownHost) && t.officialHosts.includes(shownHost);
        t.checked.push({ handle: h, displayName: p.displayName, profileUrl: p.profileUrl, matched });
        if (matched) {
          t.adopted = h;
          t.reason = `X プロフィールのリンク先（${p.profileUrl}）が公式の出展者一覧と同じドメイン`;
        }
      } catch (e) {
        t.reason = `プロフィール取得失敗: ${(e as Error).message}`;
      }
      await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
    }

    if (!t.adopted && !t.reason) {
      t.reason = `候補${t.candidates.length}件を見たが、公式ドメイン（${t.officialHosts.join(',')}）と一致するものが無い`;
    }
    console.log(
      `[${String(done).padStart(2)}/${queue.length}] ${t.circleName.slice(0, 22).padEnd(24)} ${
        t.adopted ? `→ @${t.adopted}` : '—'
      }  ${t.reason}`,
    );
  }

  await browser.close();

  const out = [...targets.values()];
  await writeJson(dataPath('x-handle-by-site.json'), out);

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
  console.log(`  自動採用: ${added}件 / ${queue.length}件`);
  console.log('  → data/x-handles-proven.json');
  console.log('  → data/x-handle-by-site.json（内訳。落ちたものは checked を見る）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
