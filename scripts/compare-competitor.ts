/**
 * 競合サイト（Mirai Guide）と本サイトを、同じ定義で数える。
 *
 *   npm run compare-competitor
 *
 * 数える指標は3つ。
 *   出展者数        … 公式一覧のブース数
 *   商品情報のあるブース数 … 商品名・価格・お品書き画像のいずれかが載っているブース
 *   商品明細の件数  … 商品名＋価格の行数
 *
 * 前回の計測は開催地の切替に失敗して東京しか測れていなかった。
 * 今回はセレクタの構造を調べたうえで切り替える。
 */
import { chromium, type Page } from 'playwright';

const URL = 'https://mirai.miku.software/ja/creators-market';

type Measured = { venue: string; items: number; booths: string[]; days: string[] };

async function scrollAll(page: Page): Promise<void> {
  let prev = -1;
  for (let i = 0; i < 200; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === prev) break;
    prev = y;
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(250);
  }
}

/** 仮想スクロールで DOM から消える項目があるので、スクロールしながら拾い続ける */
async function collectGoods(page: Page): Promise<{ items: Set<string>; booths: Set<string> }> {
  const items = new Set<string>();
  const booths = new Set<string>();
  let prev = -1;
  for (let i = 0; i < 200; i++) {
    const lines = await page.evaluate(() => document.body.innerText.split('\n'));
    lines.forEach((l, idx) => {
      if (/^[¥￥][\d,]+$/.test(l.trim()) && lines[idx - 1]) items.add(lines[idx - 1]!.trim());
      if (/^[A-G]-\d{1,2}$/.test(l.trim())) booths.add(l.trim());
    });
    const y = await page.evaluate(() => window.scrollY);
    if (y === prev) break;
    prev = y;
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(250);
  }
  return { items, booths };
}

async function measureVenue(page: Page, venueLabel: string): Promise<Measured> {
  // 開催地は本物の <select>。テキストをクリックしても切り替わらない
  // （前回の計測が東京のままだったのはこれが原因）。
  const selects = page.locator('select');
  const n = await selects.count();
  let switched = false;
  for (let i = 0; i < n; i++) {
    const opts = await selects.nth(i).locator('option').allTextContents();
    if (opts.some((o) => o.trim() === venueLabel)) {
      await selects.nth(i).selectOption({ label: venueLabel });
      switched = true;
      break;
    }
  }
  if (!switched) throw new Error(`開催地セレクタに「${venueLabel}」が見つかりません`);
  await page.waitForTimeout(5000);

  // 「グッズ」タブへ
  const goods = page.getByText('グッズ', { exact: true }).first();
  if (await goods.count()) {
    await goods.click().catch(() => {});
    await page.waitForTimeout(3000);
  }

  const { items, booths } = await collectGoods(page);
  const days = await page.evaluate(() =>
    [...new Set((document.body.innerText.match(/\d{2}\/\d{2}/g) || []))].sort(),
  );

  return { venue: venueLabel, items: items.size, booths: [...booths].sort(), days };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ locale: 'ja-JP' });

  console.log('競合サイト（Mirai Guide）を計測します\n');
  const results: Measured[] = [];
  for (const v of ['東京', '大阪']) {
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(4000);
    await scrollAll(page);
    const m = await measureVenue(page, v);
    results.push(m);
    console.log(`── ${v}`);
    console.log(`   日程表示: ${m.days.join(' ') || '（取得できず）'}`);
    console.log(`   商品明細: ${m.items}件`);
    console.log(`   商品情報のあるブース: ${m.booths.length}`);
    console.log(`   ${m.booths.join(', ')}`);
  }

  // 日程が同じなら切替に失敗している
  if (results.length === 2 && results[0]!.days.join() === results[1]!.days.join()) {
    console.log('\n⚠ 東京と大阪で表示日程が同じです。開催地の切替に失敗しています。');
    console.log('  この数値は東京のものだけとして扱ってください。');
  }

  await page.screenshot({ path: 'screenshots/competitor.png', fullPage: true });
  await browser.close();

  await compareWithOurs(results);
}

/** 本サイトの掲載ブースと突き合わせる */
async function compareWithOurs(theirs: Measured[]): Promise<void> {
  const { readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const { selectPostsForVenue } = await import('./lib/curation');
  const { VENUES } = await import('./lib/types');
  type Creator = import('./lib/types').Creator;
  type Curation = import('./lib/types').Curation;
  type Post = import('./lib/types').Post;

  const DATA = path.join(process.cwd(), 'data');
  const read = async <T,>(n: string, f: T): Promise<T> => {
    try {
      return JSON.parse(await readFile(path.join(DATA, n), 'utf8')) as T;
    } catch {
      return f;
    }
  };

  const posts = await read<Post[]>('posts.json', []);
  const curation = await read<Curation>('curation.json', {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });
  const items = await read<unknown[]>('items.json', []);

  const label: Record<string, string> = { osaka: '大阪', tokyo: '東京' };

  console.log('\n\n════ 本サイトとの比較 ════');
  for (const v of VENUES) {
    const creators = [
      ...(await read<Creator[]>(`creators.${v}.json`, [])),
      ...(await read<Creator[]>(`sponsors.${v}.json`, [])),
    ];
    const h2b = new Map<string, string>();
    for (const c of creators) {
      if (!c.boothId) continue;
      for (const h of c.xHandles) h2b.set(h.toLowerCase(), c.boothId.toUpperCase());
    }
    const ours = new Set(
      selectPostsForVenue(posts, curation, v)
        .map((p) => h2b.get(p.handle.toLowerCase()))
        .filter((b): b is string => !!b)
        // 表記ゆれ（D5 と D-5）を揃える
        .map((b) => b.replace(/^([A-G])-?0*(\d+)$/, '$1-$2')),
    );
    const t = theirs.find((r) => r.venue === label[v]);
    const them = new Set((t?.booths ?? []).map((b) => b.replace(/^([A-G])-?0*(\d+)$/, '$1-$2')));

    const both = [...ours].filter((b) => them.has(b));
    const onlyOurs = [...ours].filter((b) => !them.has(b));
    const onlyThem = [...them].filter((b) => !ours.has(b));

    console.log(`\n── ${label[v]}（公式のサークル総数 ${creators.length}）`);
    console.log(`  商品情報のあるブース   本サイト ${ours.size} / 競合 ${them.size}`);
    console.log(`  商品明細（名前＋価格） 本サイト ${items.length} / 競合 ${t?.items ?? '?'}`);
    console.log(`  両方に載っている: ${both.length}  本サイトだけ: ${onlyOurs.length}  競合だけ: ${onlyThem.length}`);
    console.log(`  合わせると ${ours.size + onlyThem.length} ブース`);
    if (onlyThem.length) console.log(`  競合だけが持っているブース: ${onlyThem.sort().join(', ')}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
