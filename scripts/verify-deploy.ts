/**
 * 公開されたサイトが実際に動いているかを検証する。
 *
 *   npm run verify-deploy -- https://magimira-oshinagaki.vercel.app
 *
 * ローカルのビルドが通ることと、配信されたものが正しいことは別。
 * 実際のURLを叩いて、ページが返るか・画像が出るか・admin が漏れて
 * いないかを見る。
 */
import { chromium } from 'playwright';

const BASE = (process.argv[2] ?? 'https://magimira-oshinagaki.vercel.app').replace(/\/$/, '');

type Check = { name: string; ok: boolean; detail: string };

async function main() {
  const checks: Check[] = [];
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  // 主要ページが 200 を返すか
  for (const p of ['/', '/items/', '/map/', '/favorites/', '/creator/tokyo-B-27/']) {
    const res = await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    checks.push({
      name: `ページ ${p}`,
      ok: res?.status() === 200,
      detail: `HTTP ${res?.status()}`,
    });
  }

  // 一覧が実際に描画されているか
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45_000 });
  await page.waitForTimeout(3000);
  const listed = await page.evaluate(() => document.querySelectorAll('li').length);
  checks.push({ name: '一覧のカード描画', ok: listed > 50, detail: `${listed}件` });

  // お品書き画像が実際に表示されているか（pbs.twimg.com の直参照が生きているか）
  const imgs = await page.evaluate(() =>
    [...document.querySelectorAll('img')]
      .filter((i) => i.src.includes('pbs.twimg.com'))
      .map((i) => ({ src: i.src, w: i.naturalWidth })),
  );
  const loaded = imgs.filter((i) => i.w > 0).length;
  checks.push({
    name: 'お品書き画像の表示',
    ok: imgs.length > 0 && loaded > 0,
    detail: `${loaded}/${imgs.length}枚が読み込み済み`,
  });

  // admin が公開されていないこと
  const admin = await page.goto(BASE + '/admin/review/', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  checks.push({
    name: 'admin 画面が公開されていない',
    ok: (admin?.status() ?? 0) >= 400,
    detail: `HTTP ${admin?.status()}`,
  });

  // 公開された JS に管理APIのURLが混ざっていないこと
  await page.goto(BASE + '/', { waitUntil: 'networkidle', timeout: 45_000 });
  const scripts = await page.evaluate(() =>
    [...document.querySelectorAll('script[src]')].map((s) => (s as HTMLScriptElement).src),
  );
  let leaked = 0;
  for (const s of scripts.slice(0, 30)) {
    const r = await page.request.get(s);
    const body = await r.text();
    if (/127\.0\.0\.1:8787|localhost:8787|curation\/verdict/.test(body)) leaked++;
  }
  checks.push({
    name: '管理APIのURLが混ざっていない',
    ok: leaked === 0,
    detail: leaked === 0 ? `${scripts.length}本を確認` : `${leaked}本に混入`,
  });

  await page.screenshot({ path: 'screenshots/deployed.png' });
  await browser.close();

  console.log(`\n公開サイトの検証: ${BASE}\n`);
  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(28)} ${c.detail}`);
  }
  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(`\n✗ ${failed.length}件が失敗しました`);
    process.exit(1);
  }
  console.log('\n✓ 公開サイトが正しく動いています。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
