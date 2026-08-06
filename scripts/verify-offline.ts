/**
 * オフライン動作の検証。
 *
 *   npm run build
 *   npm run preview        (別ターミナル)
 *   npm run verify-offline
 *
 * 会場（インテックス大阪・幕張メッセ）では回線が飽和して通信できなくなる。
 * 「オフライン保存」を押したあと本当に回線を切って表示できるかを確かめる。
 * Service Worker は localhost では secure context 扱いになるので検証できる。
 */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

import { PROJECT_ROOT } from './lib/io';

const OUT_DIR = resolve(PROJECT_ROOT, 'screenshots');

function arg(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

const BASE = arg('--base', 'http://localhost:4173').replace(/\/$/, '');

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const problems: string[] = [];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'ja-JP',
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();

  console.log(`検証対象: ${BASE}\n`);

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  // Service Worker が登録され、制御を握るまで待つ
  const swOk = await page
    .waitForFunction(
      () => navigator.serviceWorker?.controller !== null,
      undefined,
      { timeout: 20_000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!swOk) {
    problems.push('Service Worker がページを制御していない（登録に失敗した可能性）');
  } else {
    console.log('  Service Worker: 登録・制御 OK');
  }

  // manifest が引けるか
  const manifestRes = await page.request.get(`${BASE}/manifest.webmanifest`);
  if (!manifestRes.ok()) problems.push(`manifest.webmanifest が ${manifestRes.status()}`);
  else {
    const m = (await manifestRes.json()) as { name?: string; icons?: unknown[] };
    console.log(`  manifest: OK (${m.name}, icons ${m.icons?.length ?? 0}件)`);
  }

  // お気に入りを2件つけてから保存する。
  // 会場で本当に開くのはお気に入りのページなので、そこが最重要。
  //
  // 注意: 星を押すと aria-label が「追加」→「外す」に変わるため、
  // aria-label で絞った locator を nth() で使い回すと別のカードを掴む。
  // カード自体を index で特定してから、その中の星を押す。
  const cards = page.locator('[data-testid="creator-list"] > li');
  const favIds: string[] = [];
  if ((await cards.count()) >= 2) {
    for (const n of [0, 1]) {
      const li = cards.nth(n);
      const href = await li.locator('a').first().getAttribute('href');
      if (href) favIds.push(href);
      await li.locator('button[aria-label*="お気に入り"]').first().click();
    }
    await page.waitForTimeout(600);
    console.log(`  お気に入り登録: ${favIds.join(' , ')}`);
  } else {
    problems.push('サークルカードが見つからない');
  }

  // 「オフライン保存」を実行する
  const saveBtn = page.getByRole('button', { name: /ぶんを保存/ });
  if ((await saveBtn.count()) === 0) {
    problems.push('オフライン保存ボタンが見つからない');
  } else {
    const label = await saveBtn.textContent();
    console.log(`  保存ボタン: "${label?.trim()}"`);
    await saveBtn.scrollIntoViewIfNeeded();
    await saveBtn.click();

    // 完了メッセージを待つ
    const done = await page
      .waitForSelector('text=/保存しました/', { timeout: 120_000 })
      .then((h) => h.textContent())
      .catch(() => null);
    if (!done) problems.push('オフライン保存が完了しなかった');
    else console.log(`  保存結果: ${done.trim()}`);

    await page.screenshot({ path: resolve(OUT_DIR, '30-offline-saved.png') });
    console.log('  30-offline-saved.png');
  }

  // ここから回線を切る
  await ctx.setOffline(true);
  console.log('\n  --- オフラインに切り替え ---');

  // 到達性判定そのものを確認する（アプリの useReachability と同じ経路）
  const probeResult = await page.evaluate(async () => {
    const out: Record<string, unknown> = { navigatorOnLine: navigator.onLine };
    try {
      const res = await fetch(`/manifest.webmanifest?probe=${Date.now()}`, { cache: 'no-store' });
      out.ok = res.ok;
      out.status = res.status;
    } catch (e) {
      out.threw = String(e);
    }
    return out;
  });
  console.log(`  到達性プローブ: ${JSON.stringify(probeResult)}`);

  // キャッシュの実際の中身を出す（推測せずに確かめる）
  const cacheDump = await page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      out[name] = (await c.keys()).map((r) => new URL(r.url).pathname + new URL(r.url).search);
    }
    return out;
  });
  for (const [name, keys] of Object.entries(cacheDump)) {
    console.log(`  cache[${name}] ${keys.length}件`);
    for (const k of keys.filter((k) => k.startsWith('/creator') || !k.startsWith('/_next'))) {
      console.log(`    ${k}`);
    }
  }
  if (probeResult.ok === true) {
    problems.push(
      'オフラインなのに到達性プローブが成功している（Service Worker がキャッシュを返している可能性）',
    );
  }

  // トップページを再読込しても表示できるか
  const reload = await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => null);
  if (!reload) {
    problems.push('オフラインでトップページを再読込できなかった');
  } else {
    const cards = await page.locator('[data-testid="creator-list"] > li').count();
    console.log(`  オフラインでの一覧カード: ${cards}件`);
    if (cards < 10) problems.push(`オフラインで一覧が表示されない（${cards}件）`);

    // 到達性の実測に基づく案内が出ているか。
    // navigator.onLine はキャッシュ復帰後 true に戻ることがあるため、
    // アプリ側は実際に fetch して判定している。
    const notice = await page
      .waitForSelector('text=/通信できていません/', { timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    if (!notice) {
      // 何が描画されているのかを出す（推測せず確かめる）
      const section = await page
        .locator('section', { hasText: '会場用にオフライン保存' })
        .first()
        .textContent()
        .catch(() => null);
      console.log(
        `  オフライン保存セクションの表示: ${section ? section.replace(/\s+/g, ' ').slice(0, 160) : '(見つからない)'}`,
      );

      // ハイドレーションが走っているかを確かめる。
      // 一覧のHTMLはサーバ生成なので、JS が動いていなくても表示される。
      // React が DOM に接続していれば内部プロパティが付く（非破壊で確認できる）。
      const diag = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="creator-list"]');
        const hydrated = el ? Object.keys(el).some((k) => k.startsWith('__react')) : false;
        return {
          hydrated,
          hasSwController: navigator.serviceWorker?.controller !== null,
          scriptCount: document.querySelectorAll('script[src]').length,
        };
      });
      console.log(`  ハイドレーション診断: ${JSON.stringify(diag)}`);
      if (!diag.hydrated) {
        problems.push('オフラインで JavaScript が動いていない（必要なチャンクが未キャッシュ）');
      } else {
        problems.push('通信できない旨の案内が出ていない');
      }
    } else {
      console.log('  オフライン案内: 表示 OK（到達性の実測に基づく）');
    }

    await page.screenshot({ path: resolve(OUT_DIR, '31-offline-list.png') });
    console.log('  31-offline-list.png');
  }

  // お気に入りに入れたサークルの詳細ページがオフラインで開けるか（最重要）
  for (const href of favIds) {
    const res = await page.goto(`${BASE}${href}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    const h1 = await page.locator('h1').first().textContent().catch(() => null);
    const isShellFallback = h1?.trim() === 'マジミラお品書き一覧';
    if (!res || !h1 || isShellFallback) {
      problems.push(`オフラインでお気に入りページを開けなかった: ${href}（表示: ${h1?.trim()}）`);
    } else {
      console.log(`  オフラインでお気に入りページ: ${href} → ${h1.trim()}`);
    }
  }
  await page.screenshot({ path: resolve(OUT_DIR, '32-offline-detail.png') });
  console.log('  32-offline-detail.png');

  // お気に入り一覧（IndexedDB）もオフラインで開けるか
  await page.goto(`${BASE}/favorites/`, { waitUntil: 'domcontentloaded' }).catch(() => {});
  await page.waitForTimeout(1000);
  const favH1 = await page.locator('h1').first().textContent().catch(() => null);
  if (favH1?.includes('お気に入り')) console.log('  オフラインでのお気に入り一覧: OK');
  else problems.push('オフラインでお気に入り一覧を開けなかった');

  await ctx.setOffline(false);
  await browser.close();

  console.log(`\nスクリーンショット: ${OUT_DIR}`);
  if (problems.length > 0) {
    console.log(`\n問題 ${problems.length}件:`);
    for (const p of problems) console.log(`  ✖ ${p}`);
    process.exit(1);
  }
  console.log('\n問題は検出されませんでした。');
}

main().catch((err) => {
  console.error(`\nエラー: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
