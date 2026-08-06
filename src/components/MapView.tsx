'use client';

/**
 * 会場マップと周回ルート。
 *
 * 公式のマップ画像に SVG を重ね、お気に入りのブースをピン表示する。
 * 周回順は蛇行順（列を順に、1列ごとに向きを反転）。即売会の通路構造では
 * 最短経路探索よりこちらのほうが実際の歩き方に合う。
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Chip } from '@/components/Chip';
import { useFavorites } from '@/lib/use-favorites';
import { buildSerpentineRoute } from '@shared/route';
import type { Venue, VenueMap, VenueMeta } from '@shared/types';

export type MapCreator = {
  id: string;
  boothId: string | null;
  line: string | null;
  boothNo: number | null;
  circleName: string;
  days: string[];
  kind: 'creators-market' | 'sponsor';
  oshinagakiCount: number;
};

export type MapVenueData = {
  venue: Venue;
  label: string;
  hall: string;
  days: string[];
  route: VenueMeta['route'];
  map: VenueMap | null;
  creators: MapCreator[];
};

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd})`;
}

const ENTRANCE_LABEL: Record<VenueMeta['route']['entrance'], string> = {
  'top-right': '右上',
  'bottom-right': '右下',
  'top-left': '左上',
  'bottom-left': '左下',
};

export function MapView({ data }: { data: MapVenueData[] }) {
  const [venue, setVenue] = useState<Venue>(data[0]?.venue ?? 'osaka');
  const [day, setDay] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const fav = useFavorites();

  const current = data.find((d) => d.venue === venue) ?? data[0];
  // 古い booth-coords.json（boothArea 無し）でも壊れないようにする
  const area = current?.map?.boothArea ?? { x0: 0, y0: 0, x1: 1, y1: 1 };

  const { stops, unplaced, missingCoords } = useMemo(() => {
    if (!current) return { stops: [], unplaced: [], missingCoords: [] as string[] };

    // お気に入り or メモがあるサークルを対象にする
    const targets = current.creators.filter((c) => {
      const rec = fav.records.get(c.id);
      if (!rec || (!rec.favorite && rec.memo.trim() === '')) return false;
      if (day && !c.days.includes(day)) return false;
      return true;
    });

    const route = buildSerpentineRoute(
      current.venue,
      targets.map((c) => ({
        item: c,
        // 出展ブース（企業）は "A6" のように同じ列記号を使うが、
        // クリエイターズマーケットのマップとは別のエリアにある。
        // ルートに混ぜると誤った場所へ案内するので座標対象から外す。
        boothId: c.kind === 'creators-market' ? c.boothId : null,
        line: c.kind === 'creators-market' ? c.line : null,
        boothNo: c.kind === 'creators-market' ? c.boothNo : null,
      })),
    );

    const coordMap = new Map((current.map?.coords ?? []).map((c) => [c.boothId, c]));
    const missing = route.stops
      .filter((s) => !coordMap.has(s.boothId))
      .map((s) => s.boothId);

    return { stops: route.stops, unplaced: route.unplaced, missingCoords: missing };
  }, [current, fav.records, day]);

  const coordMap = useMemo(
    () => new Map((current?.map?.coords ?? []).map((c) => [c.boothId, c])),
    [current],
  );

  if (!current) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p style={{ color: 'var(--muted)' }}>データがありません。</p>
      </main>
    );
  }

  const remaining = stops.filter((s) => !fav.isVisited(s.item.id)).length;

  return (
    <main className="mx-auto max-w-3xl">
      <header
        className="sticky top-0 z-30 border-b px-4 pt-3 pb-2 backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold">会場マップ・周回ルート</h1>
          <div className="flex gap-1">
            {data.map((d) => (
              <Chip
                key={d.venue}
                active={d.venue === venue}
                onClick={() => {
                  setVenue(d.venue);
                  setDay(null);
                }}
              >
                {d.label}
              </Chip>
            ))}
          </div>
        </div>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          {current.hall} ／ 入口は{ENTRANCE_LABEL[current.route.entrance]}／
          {current.route.lineOrder.join('→')}列の順に蛇行
        </p>
        <div className="scroll-x -mx-4 mt-2 flex gap-1.5 px-4 pb-1">
          <Chip active={day === null} onClick={() => setDay(null)}>
            全日
          </Chip>
          {current.days.map((d) => (
            <Chip key={d} active={day === d} onClick={() => setDay(d)}>
              {dayLabel(d)}
            </Chip>
          ))}
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {!current.map ? (
          <div
            className="rounded-xl border p-4 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <p style={{ color: 'var(--muted)' }}>
              {current.label}のブース座標がまだありません。
              <br />
              <code>npm run detect-booths</code> を実行すると公式マップ画像から生成されます。
            </p>
          </div>
        ) : (
          <>
            {/* マップ本体 */}
            <section
              className="overflow-hidden rounded-xl border"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <div className={zoomed ? 'scroll-x' : ''}>
                {/*
                  既定は「ブース領域だけを画面幅に収める」表示。
                  公式画像には撮影禁止の告知と広い余白が入っており、
                  そのまま出すとスマホではピンが画面外に出てしまう。
                  拡大表示に切り替えると横スクロールで細部を見られる。
                */}
                <div
                  className="relative overflow-hidden"
                  style={
                    zoomed
                      ? { width: current.venue === 'tokyo' ? '1400px' : '1000px' }
                      : {
                          width: '100%',
                          aspectRatio: `${(area.x1 - area.x0) * current.map.imageWidth} / ${
                            (area.y1 - area.y0) * current.map.imageHeight
                          }`,
                        }
                  }
                >
                  <div
                    className="absolute"
                    style={
                      zoomed
                        ? { inset: 0 }
                        : {
                            width: `${100 / (area.x1 - area.x0)}%`,
                            height: `${100 / (area.y1 - area.y0)}%`,
                            left: `${(-area.x0 * 100) / (area.x1 - area.x0)}%`,
                            top: `${(-area.y0 * 100) / (area.y1 - area.y0)}%`,
                          }
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={current.map.imageUrl}
                      alt={`${current.label}会場のブース配置図`}
                      className="block w-full"
                    />
                    <svg
                      className="pointer-events-none absolute inset-0 size-full"
                      viewBox={`0 0 ${current.map.imageWidth} ${current.map.imageHeight}`}
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                    {/* ルートの線 */}
                    {stops.length > 1 && (
                      <polyline
                        fill="none"
                        stroke="var(--color-mm-accent)"
                        strokeWidth={6}
                        strokeLinejoin="round"
                        strokeOpacity={0.75}
                        points={stops
                          .map((s) => {
                            const c = coordMap.get(s.boothId);
                            if (!c) return null;
                            return `${c.x * current.map!.imageWidth},${c.y * current.map!.imageHeight}`;
                          })
                          .filter(Boolean)
                          .join(' ')}
                      />
                    )}
                    {/* ピン */}
                    {stops.map((s) => {
                      const c = coordMap.get(s.boothId);
                      if (!c) return null;
                      const visited = fav.isVisited(s.item.id);
                      const x = c.x * current.map!.imageWidth;
                      const y = c.y * current.map!.imageHeight;
                      return (
                        <g key={s.item.id}>
                          <circle
                            cx={x}
                            cy={y}
                            r={22}
                            fill={visited ? '#7a8290' : 'var(--color-mm-accent2)'}
                            stroke="#0f1115"
                            strokeWidth={4}
                            fillOpacity={visited ? 0.7 : 1}
                          />
                          <text
                            x={x}
                            y={y + 8}
                            textAnchor="middle"
                            fontSize={24}
                            fontWeight="bold"
                            fill="#0f1115"
                          >
                            {s.order}
                          </text>
                        </g>
                      );
                    })}
                    </svg>
                  </div>
                </div>
              </div>
              <div
                className="flex items-center justify-between gap-2 border-t px-3 py-2"
                style={{ borderColor: 'var(--border)' }}
              >
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {zoomed ? '横にスクロールできます' : 'ブース部分のみ表示中'}
                </span>
                <button
                  type="button"
                  onClick={() => setZoomed((v) => !v)}
                  className="rounded-lg border px-3 py-1.5 text-xs"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {zoomed ? '全体に戻す' : '拡大する'}
                </button>
              </div>
            </section>

            {stops.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--muted)' }}>
                お気に入りに入れたサークルがマップ上に表示されます。
                <br />
                <Link href="/" className="underline" style={{ color: 'var(--color-mm-accent)' }}>
                  一覧から ☆ を押して追加
                </Link>
              </p>
            )}

            {/* 周回順のリスト */}
            {stops.length > 0 && (
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-sm font-semibold">
                    周回順（{stops.length}件）
                  </h2>
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    未訪問 {remaining}件
                  </span>
                </div>
                <ol className="flex flex-col gap-1.5">
                  {stops.map((s) => {
                    const visited = fav.isVisited(s.item.id);
                    return (
                      <li
                        key={s.item.id}
                        className="flex items-center gap-2 rounded-lg border p-2"
                        style={{
                          borderColor: 'var(--border)',
                          background: 'var(--surface)',
                          opacity: visited ? 0.5 : 1,
                        }}
                      >
                        <span
                          className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums"
                          style={{
                            background: visited ? 'var(--surface2)' : 'var(--color-mm-accent2)',
                            color: visited ? 'var(--muted)' : '#0f1115',
                          }}
                        >
                          {s.order}
                        </span>
                        <span
                          className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
                          style={{ background: 'var(--surface2)', color: 'var(--color-mm-accent)' }}
                        >
                          {s.boothId}
                        </span>
                        <Link
                          href={`/creator/${encodeURIComponent(s.item.id)}/`}
                          className="min-w-0 flex-1 truncate text-sm"
                        >
                          {s.item.circleName}
                        </Link>
                        <button
                          type="button"
                          onClick={() => fav.setVisited(s.item.id, !visited)}
                          aria-pressed={visited}
                          className="shrink-0 rounded border px-2 py-1 text-xs"
                          style={{
                            borderColor: visited ? 'var(--color-mm-accent)' : 'var(--border)',
                            color: visited ? 'var(--color-mm-accent)' : 'var(--muted)',
                          }}
                        >
                          {visited ? '済' : '未'}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}

            {/* マップに載らないもの */}
            {unplaced.length > 0 && (
              <section
                className="rounded-xl border p-3"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <h2 className="text-sm font-semibold">マップ外（{unplaced.length}件）</h2>
                <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                  企業ブースなど、クリエイターズマーケットのマップに載らないものです。
                </p>
                <ul className="mt-2 flex flex-col gap-1">
                  {unplaced.map((c) => (
                    <li key={c.id} className="text-sm">
                      <Link href={`/creator/${encodeURIComponent(c.id)}/`} className="truncate">
                        {c.boothId ? `${c.boothId} ` : ''}
                        {c.circleName}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {missingCoords.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--color-mm-accent2)' }}>
                座標が見つからないブース: {missingCoords.join(', ')}
                （<code>npm run detect-booths</code> の再実行が必要かもしれません）
              </p>
            )}
          </>
        )}
      </div>
    </main>
  );
}
