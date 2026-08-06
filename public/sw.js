/* eslint-disable no-restricted-globals */
/**
 * Service Worker。
 *
 * 会場（インテックス大阪・幕張メッセ）は会期中に回線が飽和して
 * まともに通信できなくなる。下調べを持ち込めなければ道具として意味がないので、
 * オフライン閲覧は飾りではなく必須機能。
 *
 * 方針:
 *  - サイト本体（HTML/JS/CSS）は stale-while-revalidate。
 *    まずキャッシュを返して即座に表示し、裏で更新する。
 *  - お品書き画像（pbs.twimg.com）は cache-first。
 *    一度読んだものは会場で二度読み込まない。
 *  - 「オフライン保存」ボタンからのプリフェッチは
 *    メッセージ経由で受けて、進捗を返す。
 */

// キャッシュ名に含める。上げると旧キャッシュを破棄して作り直す。
// 利用者はオフライン保存をやり直す必要があるので、会期直前には上げないこと。
const VERSION = 'v3';
const SHELL_CACHE = `mm-shell-${VERSION}`;
const IMAGE_CACHE = `mm-images-${VERSION}`;

self.addEventListener('install', (event) => {
  // 新しい SW を即座に有効化する（更新を持ち越さない）
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 旧バージョンのキャッシュを捨てる
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('mm-') && !k.endsWith(VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

function isImageRequest(url) {
  return url.hostname === 'pbs.twimg.com' || url.hostname === 'magicalmirai.com';
}

/** 画像: キャッシュ優先。会場で同じ画像を二度取りに行かない */
async function cacheFirst(request) {
  const cache = await caches.open(IMAGE_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    // opaque レスポンス(status 0)も保存する。twimg は CORS ヘッダを返さない
    if (res && (res.ok || res.type === 'opaque')) {
      await cache.put(request, res.clone());
    }
    return res;
  } catch (err) {
    // オフラインでキャッシュにも無い場合。呼び出し側で代替表示に落ちる
    return new Response('', { status: 504, statusText: 'offline' });
  }
}

/** 本体: まずキャッシュを返し、裏で更新する */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);

  const update = fetch(request)
    .then((res) => {
      if (res && res.ok) void cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);

  if (hit) {
    void update; // 裏で走らせる
    return hit;
  }
  const res = await update;
  if (res) return res;

  // オフラインかつ未キャッシュ。ナビゲーションならトップを返す
  if (request.mode === 'navigate') {
    const shell = await cache.match('/');
    if (shell) return shell;
  }
  return new Response('オフラインのため表示できません', {
    status: 504,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  if (isImageRequest(url)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

/**
 * HTML から同一オリジンのアセット URL を拾う。
 *
 * これが無いとオフラインで JavaScript が動かない。
 * 初回ロード時のチャンク取得は Service Worker が制御を握る前に走るため、
 * fetch ハンドラでは拾えず一度もキャッシュされない。結果、オフラインでは
 * HTML だけが表示されてハイドレーションが起きず、
 * お気に入り・メモ・検索が使えない状態になる（会場では致命的）。
 */
function extractAssetUrls(html) {
  const found = new Set();
  // src="..." / href="..." のうち /_next/ 配下のものを拾う
  const re = /(?:src|href)="((?:\/_next\/|\/)[^"]*?\.(?:js|css|woff2?|svg))"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

/**
 * 「オフライン保存」からのプリフェッチ。
 * ページ側から URL の一覧を受け取り、少しずつ取得して進捗を返す。
 * HTML を取ったら、その中で参照されているアセットも続けて取り込む。
 */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'prefetch') return;

  const requested = Array.isArray(data.urls) ? data.urls : [];
  // ページ側が把握している「サイトの動作に必須のファイル」。
  // これを取り逃すとオフラインで JavaScript が動かず、
  // お気に入り・メモ・検索が使えない（会場では致命的）。
  const critical = Array.isArray(data.criticalUrls) ? data.criticalUrls : [];
  const port = event.ports && event.ports[0];

  event.waitUntil(
    (async () => {
      const imageCache = await caches.open(IMAGE_CACHE);
      const shellCache = await caches.open(SHELL_CACHE);
      let done = 0;
      let failed = 0;
      let total = critical.length + requested.length;
      const assetUrls = new Set();
      const seen = new Set();
      const failures = { image: 0, page: 0, asset: 0 };

      const report = (type) => {
        if (port) port.postMessage({ type, done, failed, total, failures });
      };

      /** 1件取得してキャッシュする。HTML ならアセットも収集する */
      const fetchOne = async (raw, collectAssets) => {
        if (seen.has(raw)) return;
        seen.add(raw);
        try {
          const u = new URL(raw, self.location.origin);
          const isImg = isImageRequest(u);
          const cache = isImg ? imageCache : shellCache;
          const req = new Request(raw, { mode: isImg ? 'no-cors' : 'same-origin' });

          let res = await cache.match(req);
          if (!res) {
            res = await fetch(req);
            if (!res || !(res.ok || res.type === 'opaque')) {
              failed += 1;
              failures[isImg ? 'image' : collectAssets ? 'page' : 'asset'] += 1;
              return;
            }
            await cache.put(req, res.clone());
          }
          done += 1;

          if (collectAssets && !isImg) {
            const ct = res.headers.get('content-type') ?? '';
            if (ct.includes('text/html')) {
              for (const a of extractAssetUrls(await res.clone().text())) {
                assetUrls.add(a);
              }
            }
          }
        } catch {
          failed += 1;
          try {
            const u = new URL(raw, self.location.origin);
            failures[isImageRequest(u) ? 'image' : 'asset'] += 1;
          } catch {
            failures.asset += 1;
          }
        }
      };

      // 会場の細い回線でも詰まらないよう、少数ずつ順に取る。
      // 画像（pbs.twimg.com）は数が多く、一気に投げると弾かれるので更に絞る。
      const runBatches = async (list, collectAssets, concurrency = 4) => {
        for (let i = 0; i < list.length; i += concurrency) {
          const batch = list.slice(i, i + concurrency);
          await Promise.all(batch.map((raw) => fetchOne(raw, collectAssets)));
          report('progress');
        }
      };

      /** 弾かれたものを一度だけ取り直す。一時的な失敗が多いので効果が大きい */
      const retryFailed = async (list, concurrency) => {
        const missing = [];
        for (const raw of list) {
          try {
            const u = new URL(raw, self.location.origin);
            const cache = isImageRequest(u) ? imageCache : shellCache;
            const req = new Request(raw, {
              mode: isImageRequest(u) ? 'no-cors' : 'same-origin',
            });
            if (!(await cache.match(req))) missing.push(raw);
          } catch {
            /* URL として壊れているものは諦める */
          }
        }
        if (missing.length === 0) return;
        for (const raw of missing) seen.delete(raw);
        // 取り直すぶんは失敗カウントから戻す
        failed -= missing.length;
        failures.image -= missing.filter((u) => {
          try {
            return isImageRequest(new URL(u, self.location.origin));
          } catch {
            return false;
          }
        }).length;
        if (failures.image < 0) failures.image = 0;
        if (failed < 0) failed = 0;
        await runBatches(missing, false, concurrency);
      };

      // 取得順が重要。Service Worker は長時間の処理の途中で止められることがあり、
      // 後回しにしたものほど取り逃す。サイトが動かなくなるものから先に取る。
      //
      //   1. 動作に必須のファイル（JS/CSS）… 無いとオフラインで何も操作できない
      //   2. ページ本体（HTML）           … 無いとページが開けない
      //   3. ページから見つけた追加アセット … 個別ページの表示に必要
      //   4. 画像                         … 無くても代替表示に落ちる（最も後回しで良い）

      // 1. 必須ファイル
      await runBatches(critical, false);

      // 2. ページ（同時に追加アセットを収集）
      const pages = requested.filter((u) => {
        try {
          return !isImageRequest(new URL(u, self.location.origin));
        } catch {
          return false;
        }
      });
      await runBatches(pages, true);

      // 3. ページから見つけた追加アセット
      const assets = [...assetUrls].filter((a) => !seen.has(a));
      total += assets.length;
      report('progress');
      await runBatches(assets, false);

      // 4. 画像（最後。途中で止まっても代替表示に落ちるだけ）
      const images = requested.filter((u) => {
        try {
          return isImageRequest(new URL(u, self.location.origin));
        } catch {
          return false;
        }
      });
      await runBatches(images, false, 2);
      // 弾かれたぶんを一度だけ取り直す
      await retryFailed(images, 1);

      report('complete');
    })(),
  );
});
