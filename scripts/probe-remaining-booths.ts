/**
 * 自動照合で決まらなかったブースについて、判断材料を出すだけの道具。
 *
 *   npm run probe-remaining-booths
 *
 * 採用はしない。「マジカルミライ + サークル名」で投稿を検索し、
 * 誰がそのブースの話をしているかを本文ごと並べる。
 * 人がこれを読んで data/x-handles-manual.json に書く。
 *
 * 自動採用しない理由: ここまでの手（名前検索・公式サイトのXリンク・
 * Xプロフィールのリンク先照合）が全部空振りしたブースが残っている。
 * 材料が薄いところで機械に決めさせると、無関係なアカウントを
 * そのブースとして紐づけ、別人の投稿をお品書きとして公開してしまう。
 */
import { chromium, type Page } from 'playwright';

import { dataPath, jitter, readJson, sleep } from './lib/io';
import type { Creator, RefVenue } from './lib/types';
import { blockHeavyResources, createLoggedInContext, looksLoggedOut } from './lib/x-session';

async function searchPosts(
  page: Page,
  query: string,
): Promise<{ handle: string; name: string; text: string }[]> {
  await page.goto(`https://x.com/search?f=live&q=${encodeURIComponent(query)}`, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  if (looksLoggedOut(page.url())) throw new Error('ログイン画面に飛ばされました');
  await page.waitForTimeout(4000);
  return await page.evaluate(() => {
    const out: { handle: string; name: string; text: string }[] = [];
    for (const art of Array.from(document.querySelectorAll('article')).slice(0, 10)) {
      const el = art as HTMLElement;
      const href = Array.from(el.querySelectorAll('a[href*="/status/"]'))
        .map((a) => a.getAttribute('href') ?? '')
        .find((h) => /^\/[^/]+\/status\/\d+/.test(h));
      const handle = href ? href.split('/')[1]! : '';
      if (!handle) continue;
      const nameEl = el.querySelector('[data-testid="User-Name"]') as HTMLElement | null;
      const body = el.querySelector('[data-testid="tweetText"]') as HTMLElement | null;
      out.push({
        handle,
        name: (nameEl?.innerText ?? '').split('\n')[0] ?? '',
        text: (body?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 180),
      });
    }
    return out;
  });
}

async function main(): Promise<void> {
  const targets = new Map<string, { name: string; booths: string[] }>();
  for (const v of ['osaka', 'tokyo'] as RefVenue[]) {
    for (const kind of ['creators', 'sponsors']) {
      for (const c of await readJson<Creator[]>(dataPath(`${kind}.${v}.json`), [])) {
        if ((c.xHandles ?? []).length > 0) continue;
        const e = targets.get(c.circleName) ?? { name: c.circleName, booths: [] };
        if (c.boothId) e.booths.push(`${v === 'osaka' ? '大阪' : '東京'}${c.boothId}`);
        targets.set(c.circleName, e);
      }
    }
  }

  const browser = await chromium.launch({ headless: true });
  const context = await createLoggedInContext(browser);
  await blockHeavyResources(context);
  const page = await context.newPage();

  for (const t of targets.values()) {
    console.log(`\n════ ${t.name}  [${t.booths.join(' ')}]`);
    try {
      const hits = await searchPosts(page, `${t.name} マジカルミライ`);
      if (hits.length === 0) console.log('  該当なし');
      for (const h of hits.slice(0, 6)) {
        console.log(`  @${h.handle.padEnd(20)}${h.name.slice(0, 20).padEnd(22)}${h.text}`);
      }
    } catch (e) {
      console.log(`  検索失敗: ${(e as Error).message}`);
    }
    await sleep(jitter(4_000, 8_000));
  }

  await browser.close();
  console.log('\n判断材料のみ。採用は data/x-handles-manual.json に書くこと。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
