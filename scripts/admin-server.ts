/**
 * ローカル専用の書き込みサイドカー。
 *
 *   npm run review   … このサーバと next dev を同時に起動する
 *
 * なぜ Next.js の API ルートにしないか:
 *   公開サイトは `output: 'export'`（静的エクスポート）で作る。
 *   静的エクスポートでは POST を受ける Route Handler が使えないため、
 *   書き込みだけを別プロセスに分ける。結果として、公開される成果物には
 *   書き込み経路が一切含まれない。
 *
 * 127.0.0.1 のみで待ち受ける。外部からは到達できない。
 */

import express from 'express';

import { dataPath, readJson, writeJson } from './lib/io';
import type { BoothCoord, Curation, CurationVerdict, Venue, VenueMap } from './lib/types';

const PORT = Number(process.env.ADMIN_PORT ?? 8787);
const HOST = '127.0.0.1';

const app = express();
app.use(express.json({ limit: '5mb' }));

// next dev（既定 3000）からのアクセスを許可する。ローカル限定。
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

const CURATION_PATH = dataPath('curation.json');

async function loadCuration(): Promise<Curation> {
  return await readJson<Curation>(CURATION_PATH, {
    verdicts: {},
    excludedHandles: [],
    updatedAt: '',
  });
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/curation', async (_req, res) => {
  res.json(await loadCuration());
});

/** 1件の採用/却下。判断は次回クロールを跨いで保持される */
app.post('/curation/verdict', async (req, res) => {
  const body = req.body as { postId?: unknown; verdict?: unknown };
  const postId = typeof body.postId === 'string' ? body.postId : null;
  const verdict = body.verdict;
  if (!postId) {
    res.status(400).json({ error: 'postId が必要です' });
    return;
  }
  if (verdict !== 'adopted' && verdict !== 'rejected' && verdict !== null) {
    res.status(400).json({ error: 'verdict は adopted | rejected | null' });
    return;
  }

  const curation = await loadCuration();
  if (verdict === null) {
    delete curation.verdicts[postId];
  } else {
    curation.verdicts[postId] = verdict as CurationVerdict;
  }
  curation.updatedAt = new Date().toISOString();
  await writeJson(CURATION_PATH, curation);
  res.json(curation);
});

/** 複数件まとめて（「この列を全部採用」用） */
app.post('/curation/bulk', async (req, res) => {
  const body = req.body as { verdicts?: unknown };
  if (typeof body.verdicts !== 'object' || body.verdicts === null) {
    res.status(400).json({ error: 'verdicts オブジェクトが必要です' });
    return;
  }
  const curation = await loadCuration();
  for (const [postId, v] of Object.entries(body.verdicts as Record<string, unknown>)) {
    if (v === 'adopted' || v === 'rejected') curation.verdicts[postId] = v;
    else if (v === null) delete curation.verdicts[postId];
  }
  curation.updatedAt = new Date().toISOString();
  await writeJson(CURATION_PATH, curation);
  res.json(curation);
});

/**
 * 人手による会場の指定。
 *
 * 自動判別できなかった投稿を公開する唯一の経路。
 * 「採用」だけでは会場が決まらないので、必ず会場まで指定させる。
 * これにより「公開中の投稿は必ず会場が確定している」が保たれる。
 */
app.post('/curation/venues', async (req, res) => {
  const body = req.body as { postId?: unknown; venues?: unknown };
  const postId = typeof body.postId === 'string' ? body.postId : null;
  if (!postId) {
    res.status(400).json({ error: 'postId が必要です' });
    return;
  }
  if (!Array.isArray(body.venues)) {
    res.status(400).json({ error: 'venues 配列が必要です（空配列で指定を解除）' });
    return;
  }
  const venues = body.venues.filter((v): v is Venue => v === 'osaka' || v === 'tokyo');
  if (venues.length !== body.venues.length) {
    res.status(400).json({ error: 'venues は osaka | tokyo のみ' });
    return;
  }

  const curation = await loadCuration();
  curation.manualVenues ??= {};
  if (venues.length === 0) delete curation.manualVenues[postId];
  else curation.manualVenues[postId] = [...new Set(venues)];
  curation.updatedAt = new Date().toISOString();
  await writeJson(CURATION_PATH, curation);
  res.json(curation);
});

/** 掲載除外ハンドル（削除依頼を受けたとき） */
app.post('/curation/exclude', async (req, res) => {
  const body = req.body as { handle?: unknown; excluded?: unknown };
  const handle = typeof body.handle === 'string' ? body.handle.replace(/^@/, '') : null;
  if (!handle) {
    res.status(400).json({ error: 'handle が必要です' });
    return;
  }
  const curation = await loadCuration();
  const set = new Set(curation.excludedHandles.map((h) => h.toLowerCase()));
  if (body.excluded === false) set.delete(handle.toLowerCase());
  else set.add(handle.toLowerCase());
  curation.excludedHandles = [...set].sort();
  curation.updatedAt = new Date().toISOString();
  await writeJson(CURATION_PATH, curation);
  res.json(curation);
});

/** ブース座標（第2弾のマップエディタ用） */
app.post('/booth-coords/:venue', async (req, res) => {
  const venue = req.params.venue as Venue;
  if (venue !== 'osaka' && venue !== 'tokyo') {
    res.status(400).json({ error: 'venue は osaka | tokyo' });
    return;
  }
  const body = req.body as Partial<VenueMap>;
  if (!Array.isArray(body.coords)) {
    res.status(400).json({ error: 'coords 配列が必要です' });
    return;
  }
  const coords: BoothCoord[] = [];
  for (const c of body.coords as unknown[]) {
    if (typeof c !== 'object' || c === null) continue;
    const rec = c as Record<string, unknown>;
    if (typeof rec.boothId !== 'string') continue;
    if (typeof rec.x !== 'number' || typeof rec.y !== 'number') continue;
    coords.push({
      boothId: rec.boothId,
      x: Math.min(1, Math.max(0, rec.x)),
      y: Math.min(1, Math.max(0, rec.y)),
      verified: rec.verified === true,
    });
  }
  const a = body.boothArea;
  const map: VenueMap = {
    venue,
    imageUrl: typeof body.imageUrl === 'string' ? body.imageUrl : '',
    imageWidth: typeof body.imageWidth === 'number' ? body.imageWidth : 0,
    imageHeight: typeof body.imageHeight === 'number' ? body.imageHeight : 0,
    boothArea:
      a &&
      typeof a.x0 === 'number' &&
      typeof a.y0 === 'number' &&
      typeof a.x1 === 'number' &&
      typeof a.y1 === 'number'
        ? { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 }
        : { x0: 0, y0: 0, x1: 1, y1: 1 },
    coords,
  };
  await writeJson(dataPath(`booth-coords.${venue}.json`), map);
  res.json({ ok: true, count: coords.length });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`admin サーバ起動: http://${HOST}:${PORT}`);
  console.log(`  data/curation.json への書き込みを受け付けます（ローカル限定）`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
  });
}
