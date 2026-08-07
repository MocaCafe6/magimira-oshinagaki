/**
 * 公式ページに X リンクが載っていないサークル・企業の
 * X アカウントを、名前で検索して見つける。
 *
 *   npm run find-x-handles              未取得のもの全部
 *   npm run find-x-handles -- --limit 5 まず少数で試す
 *   npm run find-x-handles -- --venue osaka
 *
 * 公式の出店者一覧に X リンクがあるのは一部だけ。実測で
 * 企業ブースは43件中33件、クリエイターズマーケットも11件が未掲載だった。
 * リンクが無いサークルは投稿を集めようがなく、まるごと落ちていた
 * （グッドスマイルカンパニー、*Luna、真島ゆろ、せきこみごはん など）。
 *
 * ## 誤紐づけを防ぐ
 *
 * 名前で検索して出てきたアカウントをそのまま採用はしない。
 * **候補として提案するだけ**で、採用は data/x-handles-manual.json への
 * 明示的な記載による。同名の別人を勝手に紐づけると、まったく無関係な
 * 投稿がそのブースのお品書きとして公開されてしまう。
 *
 * 出力: data/x-handle-candidates.json（提案。人が確認して採用する）
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium, type Page } from 'playwright';

import { dataPath, jitter, readJson, sleep, writeJson } from './lib/io';
import type { Creator, RefVenue } from './lib/types';
import { blockHeavyResources, createLoggedInContext, looksLoggedOut } from './lib/x-session';

const DELAY_MIN_MS = 4_000;
const DELAY_MAX_MS = 8_000;

type Candidate = {
  /** 探した対象 */
  circleName: string;
  memberNames: string[];
  venues: { venue: RefVenue; boothId: string | null }[];
  /** 見つかった候補（上位のみ） */
  found: { handle: string; displayName: string; bio: string; verified: boolean }[];
  /** 名前の一致度で選んだ最有力候補。null なら判断がつかない */
  best: string | null;
  reason: string;
};

/** 比較用に名前を潰す。表記ゆれ・記号・法人格を落とす */
function canonName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[株式会社|有限会社|（株）|\(株\)|㈱]/g, '')
    .replace(/[\s　・･!！?？'’"”「」『』（）()\[\]【】\-–—_.,、。/／＆&+＋]/g, '')
    .replace(/[ぁ-ん]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60)); // ひらがな→カタカナ
}

/** X の「ユーザー」検索結果から上位アカウントを拾う */
async function searchAccounts(
  page: Page,
  query: string,
): Promise<{ handle: string; displayName: string; bio: string; verified: boolean }[]> {
  const url = `https://x.com/search?f=user&q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (looksLoggedOut(page.url())) throw new Error('ログイン画面に飛ばされました');
  await page.waitForTimeout(4000);

  return await page.evaluate(() => {
    const out: { handle: string; displayName: string; bio: string; verified: boolean }[] = [];
    const cells = document.querySelectorAll('[data-testid="UserCell"]');
    for (const cell of Array.from(cells).slice(0, 6)) {
      const link = cell.querySelector('a[href^="/"]') as HTMLAnchorElement | null;
      const handle = link?.getAttribute('href')?.replace(/^\//, '') ?? '';
      if (!handle || handle.includes('/')) continue;
      const text = (cell as HTMLElement).innerText.split('\n').filter(Boolean);
      out.push({
        handle,
        displayName: text[0] ?? '',
        bio: text.slice(2).join(' ').slice(0, 120),
        verified: Boolean(cell.querySelector('[data-testid="icon-verified"]')),
      });
    }
    return out;
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (f: string): string | null => {
    const i = argv.indexOf(f);
    return i >= 0 ? (argv[i + 1] ?? null) : null;
  };
  const limit = get('--limit') ? Number(get('--limit')) : Infinity;
  const onlyVenue = get('--venue');

  // 会場をまたいで同じサークルは1回だけ探す
  const targets = new Map<string, Candidate>();
  for (const v of ['osaka', 'tokyo'] as RefVenue[]) {
    if (onlyVenue && v !== onlyVenue) continue;
    for (const kind of ['creators', 'sponsors']) {
      const list = await readJson<Creator[]>(dataPath(`${kind}.${v}.json`), []);
      for (const c of list) {
        if ((c.xHandles ?? []).length > 0) continue;
        const key = c.circleName;
        const cur = targets.get(key) ?? {
          circleName: c.circleName,
          memberNames: (c.members ?? []).map((m) => m.name).filter(Boolean),
          venues: [],
          found: [],
          best: null,
          reason: '',
        };
        cur.venues.push({ venue: v, boothId: c.boothId });
        for (const m of (c.members ?? []).map((x) => x.name).filter(Boolean)) {
          if (!cur.memberNames.includes(m)) cur.memberNames.push(m);
        }
        targets.set(key, cur);
      }
    }
  }

  const queue = [...targets.values()].slice(0, limit);
  console.log(`X アカウントを名前で探します`);
  console.log(`  対象: ${queue.length}件（会場をまたぐ同名は1件にまとめた）\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await createLoggedInContext(browser);
  await blockHeavyResources(context);
  const page = await context.newPage();

  let done = 0;
  for (const t of queue) {
    done++;
    // サークル名で探し、続けてメンバー名でも探す。
    //
    // 「結果が1件でも返ったら打ち切る」ではいけない。X のユーザー検索は
    // 一致が無くても空を返さず、まったく無関係なアカウントを詰めてくる
    // （実測で「はなじ」「币赚」が上位に出た）。打ち切ると、サークル名が
    // 屋号でメンバー名が本アカウントというよくある形を取り逃がす
    // （ましまろ湯／真島ゆろ がまさにそれだった）。
    // 打ち切ってよいのは表示名が完全一致したときだけ。
    const wanted = [t.circleName, ...t.memberNames].map(canonName);
    const hasExact = (): boolean => t.found.some((f) => wanted.includes(canonName(f.displayName)));

    for (const q of [t.circleName, ...t.memberNames].slice(0, 3)) {
      try {
        const found = await searchAccounts(page, q);
        for (const f of found) {
          if (!t.found.some((x) => x.handle === f.handle)) t.found.push(f);
        }
      } catch (e) {
        t.reason = `検索失敗: ${(e as Error).message}`;
      }
      await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
      if (hasExact()) break;
    }

    // 表示名がサークル名またはメンバー名と一致するものを最有力とする
    const exact = t.found.filter((f) => wanted.includes(canonName(f.displayName)));
    if (exact.length === 1) {
      t.best = exact[0]!.handle;
      t.reason = `表示名が「${exact[0]!.displayName}」で完全一致`;
    } else if (exact.length > 1) {
      t.reason = `表示名が一致する候補が${exact.length}件あり、判断がつかない`;
    } else if (t.found.length > 0) {
      t.reason = '表示名が一致する候補が無い（要確認）';
    } else if (!t.reason) {
      t.reason = '候補が見つからなかった';
    }

    console.log(
      `[${String(done).padStart(3)}/${queue.length}] ${t.circleName.slice(0, 22).padEnd(24)} ${
        t.best ? `→ @${t.best}` : `候補${t.found.length}件`
      }  ${t.reason}`,
    );
  }

  await browser.close();

  const out = [...targets.values()];
  await writeJson(dataPath('x-handle-candidates.json'), out);
  const decided = out.filter((t) => t.best).length;
  console.log(`\n完了`);
  console.log(`  最有力候補まで絞れた: ${decided}件 / ${out.length}件`);
  console.log(`  → data/x-handle-candidates.json`);
  console.log(`\n中身を確認して data/x-handles-manual.json に採用してください。`);
  console.log(`  形式: { "サークル名": ["handle"] }`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
