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

/**
 * 表示名から比較用の綴りを何通りか作る。
 *
 * 括弧で読みや別名を併記する人が多い。実データ:
 *   「真島ゆろ(ましまゆろ)」… 公式のメンバー名は「真島ゆろ」
 * 括弧の中身ごと連結して比較していたため一致せず、取り逃がしていた。
 */
function canonNameVariants(s: string): string[] {
  const stripped = s.replace(/[（(【\[].*?[）)】\]]/g, ''); // 括弧の中身を落とす
  const beforeSep = s.split(/[|｜/／@＠]/)[0] ?? s; // 「名前 | 肩書」形式
  return [...new Set([s, stripped, beforeSep].map(canonName).filter(Boolean))];
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

/**
 * X の「話題」検索から、投稿とその著者を拾う。
 *
 * ユーザー検索が役に立たないサークルが多い。屋号でアカウントを作って
 * いない、表示名に絵文字や別名を入れている、そもそも名前が一般的すぎる。
 * 実測でユーザー検索から自動確定できたのは59件中1件だけだった。
 *
 * 一方、そのサークルが出展告知をしていれば、本文に必ずサークル名と
 * ブース番号が入る。その投稿の著者が本人である。名前の似ている別人を
 * 拾う余地が無いので、ユーザー検索より確度が高い。
 */
async function searchPosts(
  page: Page,
  query: string,
): Promise<{ handle: string; text: string }[]> {
  const url = `https://x.com/search?f=live&q=${encodeURIComponent(query)}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  if (looksLoggedOut(page.url())) throw new Error('ログイン画面に飛ばされました');
  await page.waitForTimeout(4000);

  return await page.evaluate(() => {
    const out: { handle: string; text: string }[] = [];
    for (const art of Array.from(document.querySelectorAll('article')).slice(0, 12)) {
      const el = art as HTMLElement;
      const href = Array.from(el.querySelectorAll('a[href*="/status/"]'))
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => /^\/[^/]+\/status\/\d+/.test(h));
      const handle = href ? href.split('/')[1]! : '';
      if (!handle) continue;
      const body = el.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
      out.push({ handle, text: (body?.innerText ?? el.innerText).slice(0, 600) });
    }
    return out;
  });
}

/** 「A-13」「A13」「Ａ－１３」などの揺れを潰す */
function canonBooth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９－―ー]/g, (c) =>
      '－―ー'.includes(c) ? '-' : String.fromCharCode(c.charCodeAt(0) - 0xfee0),
    )
    .toUpperCase()
    .replace(/^([A-Z])\s*-?\s*0*(\d+)$/, '$1-$2');
}

/** 本文にこのブース番号が書かれているか */
function textHasBooth(text: string, booth: string): boolean {
  const want = canonBooth(booth);
  const m = /^([A-Z])-(\d+)$/.exec(want);
  if (!m) return false;
  const re = new RegExp(`${m[1]}\\s*[-‐‑–—ー―]?\\s*0*${m[2]}(?![0-9])`, 'i');
  return re.test(
    text.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)),
  );
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
    const matchesName = (displayName: string): boolean =>
      canonNameVariants(displayName).some((v) => wanted.includes(v));
    const hasExact = (): boolean => t.found.some((f) => matchesName(f.displayName));

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
    const exact = t.found.filter((f) => matchesName(f.displayName));
    if (exact.length === 1) {
      t.best = exact[0]!.handle;
      t.reason = `表示名が「${exact[0]!.displayName}」で完全一致`;
    } else if (exact.length > 1) {
      t.reason = `表示名が一致する候補が${exact.length}件あり、判断がつかない`;
    }

    // --- 投稿検索。ユーザー検索で決まらなかったものを追う ---
    //
    // 「サークル名 + マジカルミライ」で投稿を検索し、その本文に
    // **公式のブース番号**が書かれていたら、その著者を本人とみなす。
    //
    // 名前だけの一致とは別物である。公式の出展記録にあるブース番号を
    // 自分の告知として書けるのは出展者本人だけで、同名の別人が偶然
    // 一致する余地が無い。会場帰属の判定で使っている証明と同じ強さ。
    const booths = t.venues.map((v) => v.boothId).filter((b): b is string => Boolean(b));
    // サークル名だけでなくメンバー名でも検索する。屋号を出さず本名・
    // 作家名で告知する人が多く、サークル名では投稿が引っかからない。
    const postQueries = [t.circleName, ...t.memberNames].slice(0, 3);
    for (const q of postQueries) {
      if (t.best || booths.length === 0) break;
      try {
        const hits = await searchPosts(page, `${q} マジカルミライ`);
        // 本文に公式ブース番号があり、かつサークル名かメンバー名のどれかが
        // 書かれていること。どちらか片方では足りない
        // （ブース番号だけなら他人の紹介、名前だけならファンの言及）。
        const names = [t.circleName, ...t.memberNames].map(canonName).filter((n) => n.length >= 2);
        const proved = hits.filter((p) => {
          if (!booths.some((b) => textHasBooth(p.text, b))) return false;
          const body = canonName(p.text);
          return names.some((n) => body.includes(n));
        });
        const handles = [...new Set(proved.map((p) => p.handle))];
        for (const h of handles) {
          if (!t.found.some((x) => x.handle === h)) {
            const sample = proved.find((p) => p.handle === h)!;
            t.found.push({
              handle: h,
              displayName: '(投稿検索)',
              bio: sample.text.replace(/\s+/g, ' ').slice(0, 120),
              verified: false,
            });
          }
        }
        if (handles.length === 1) {
          t.best = handles[0]!;
          t.reason = `投稿本文に公式ブース番号（${booths.join('/')}）とサークル名の両方があり、本人と確定`;
        } else if (handles.length > 1) {
          t.reason = `ブース番号入りの投稿が${handles.length}アカウントから出ており、判断がつかない`;
        }
      } catch (e) {
        t.reason = `投稿検索失敗: ${(e as Error).message}`;
      }
      await sleep(jitter(DELAY_MIN_MS, DELAY_MAX_MS));
    }

    if (!t.best && !t.reason) {
      t.reason = t.found.length > 0 ? '表示名が一致する候補が無い（要確認）' : '候補が見つからなかった';
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

  // ブース番号で証明できたものだけ自動採用する。
  //
  // 表示名の一致は自動採用しない方針を続ける（同名の別人を紐づけると
  // 無関係な投稿がそのブースのお品書きとして公開されるため）。
  // 一方こちらは「公式の出展記録にあるブース番号を自分の告知として
  // 書いている」という証明で、会場帰属の判定で使っているものと同じ強さ。
  // 人手の確認を挟む理由が無いので機械が採る。
  const proven = await readJson<Record<string, string[]>>(dataPath('x-handles-proven.json'), {});
  let added = 0;
  for (const t of out) {
    if (!t.best || !t.reason.includes('本人と確定')) continue;
    const cur = proven[t.circleName] ?? [];
    if (!cur.includes(t.best)) {
      proven[t.circleName] = [...cur, t.best];
      added++;
    }
  }
  await writeJson(dataPath('x-handles-proven.json'), proven);

  const decided = out.filter((t) => t.best).length;
  console.log(`\n完了`);
  console.log(`  最有力候補まで絞れた: ${decided}件 / ${out.length}件`);
  console.log(`  ブース番号で証明でき、自動採用した: ${added}件`);
  console.log(`  → data/x-handles-proven.json（自動）`);
  console.log(`  → data/x-handle-candidates.json（提案）`);
  console.log(`\n残りは中身を確認して data/x-handles-manual.json に採用してください。`);
  console.log(`  形式: { "サークル名": ["handle"] }`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
