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
import { formatEventDay } from '@/lib/format';
import { estimateTextWidth, layoutLabels, type LabelBox } from '@/lib/label-layout';
import { PRIORITY_COLORS, PRIORITY_HEX, type PriorityColor } from '@/lib/store';
import { useFavorites } from '@/lib/use-favorites';
import { buildSerpentineRoute } from '@shared/route';
import type { Venue, VenueMap, VenueMeta } from '@shared/types';

// 既定表示では 1000px 幅の画像をスマホの 430px に収めるので、
// 画像座標のフォントサイズは実寸の 0.43 倍になる。22 だと 9px 相当で読めない。
// 30 にして 13px 相当を確保する（重なりは layoutLabels が避ける）。
const NAME_FONT = 30;
const NAME_MAX_CHARS = 9;

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

const dayLabel = formatEventDay;

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
  const [reordering, setReordering] = useState(false);
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

    // 手で順番を決めているものは、その順を優先する。
    //
    // 蛇行順は通路の構造としては妥当だが、「開場直後は混むところから」
    // 「連れと合流する時間がある」など事情で変えたいことがある。
    // routeOrder が入っているものを先に、その中では小さい順に並べ、
    // 残りは蛇行順のまま後ろに続ける。
    const withManual = route.stops.map((s) => ({
      s,
      manual: fav.records.get(s.item.id)?.routeOrder ?? null,
    }));
    const hasManual = withManual.some((x) => x.manual !== null);
    const ordered = hasManual
      ? [...withManual]
          .sort((a, b) => {
            if (a.manual !== null && b.manual !== null) return a.manual - b.manual;
            if (a.manual !== null) return -1;
            if (b.manual !== null) return 1;
            return a.s.order - b.s.order;
          })
          .map((x, i) => ({ ...x.s, order: i + 1 }))
      : route.stops;

    const coordMap = new Map((current.map?.coords ?? []).map((c) => [c.boothId, c]));
    const missing = ordered.filter((s) => !coordMap.has(s.boothId)).map((s) => s.boothId);

    return { stops: ordered, unplaced: route.unplaced, missingCoords: missing };
  }, [current, fav.records, day]);

  const coordMap = useMemo(
    () => new Map((current?.map?.coords ?? []).map((c) => [c.boothId, c])),
    [current],
  );

  /** 重なりを避けたサークル名の配置 */
  const labels = useMemo(() => {
    if (!current?.map) return [];
    const boxes: (LabelBox & { text: string })[] = [];
    for (const s of stops) {
      const c = coordMap.get(s.boothId);
      if (!c) continue;
      const text =
        s.item.circleName.length > NAME_MAX_CHARS
          ? `${s.item.circleName.slice(0, NAME_MAX_CHARS)}…`
          : s.item.circleName;
      boxes.push({
        id: s.item.id,
        x: c.x * current.map.imageWidth,
        y: c.y * current.map.imageHeight,
        w: estimateTextWidth(text, NAME_FONT),
        h: NAME_FONT + 6,
        text,
      });
    }
    // 既定表示ではブース領域だけを切り出しているので、その外に文字を
    // 置くと端で切れる（最前列 A 列の名前が半分消えていた）。
    const placed = layoutLabels(boxes, {
      minY: area.y0 * current.map.imageHeight + NAME_FONT,
      maxY: area.y1 * current.map.imageHeight - NAME_FONT * 0.5,
    });
    const textById = new Map(boxes.map((b) => [b.id, b.text]));
    return placed.map((p) => ({ ...p, text: textById.get(p.id) ?? '' }));
  }, [stops, coordMap, current, area]);

  /**
   * 周回順を1つ上／下に入れ替える。
   *
   * 表示中の並びをそのまま保存する。一部だけ手で動かしたときも、
   * 全件に番号を振り直すことで「手で決めた順が優先」の状態を作る。
   */
  const move = (index: number, delta: number) => {
    const ids = stops.map((s) => s.item.id);
    const to = index + delta;
    if (to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    fav.setRouteOrders(next);
  };

  if (!current) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p style={{ color: 'var(--muted)' }}>データがありません。</p>
      </main>
    );
  }

  const remaining = stops.filter((s) => !fav.isVisited(s.item.id)).length;

  return (
    <main className="mx-auto max-w-6xl">
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
                      const color = fav.colorOf(s.item.id);
                      const x = c.x * current.map!.imageWidth;
                      const y = c.y * current.map!.imageHeight;
                      return (
                        <g key={s.item.id}>
                          <circle
                            cx={x}
                            cy={y}
                            r={22}
                            fill={visited ? '#7a8290' : PRIORITY_HEX[color]}
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
                          <text
                            x={x}
                            y={y + 46}
                            textAnchor="middle"
                            fontSize={20}
                            fontWeight="bold"
                            fill="#ffffff"
                            stroke="#0f1115"
                            strokeWidth={5}
                            paintOrder="stroke"
                          >
                            {s.boothId}
                          </text>
                        </g>
                      );
                    })}

                    {/* サークル名。
                        丸に番号だけではどこが誰なのか分からないので名前を出すが、
                        隣り合うブースを両方お気に入りにすると重なって読めなくなる。
                        重なりを避けて上下にずらし、離れたものには引き出し線を引く。
                        ピンより後に描いて名前が隠れないようにする。 */}
                    {labels.map((l) => (
                      <g key={`label-${l.id}`}>
                        {l.needsLeader && (
                          <line
                            x1={l.x}
                            y1={l.y}
                            x2={l.labelX}
                            y2={l.labelY + l.h / 2}
                            stroke="#ffffff"
                            strokeWidth={2}
                            strokeOpacity={0.6}
                            strokeDasharray="4 4"
                          />
                        )}
                        <text
                          x={l.labelX}
                          y={l.labelY}
                          textAnchor="middle"
                          fontSize={NAME_FONT}
                          fontWeight="bold"
                          fill="#ffffff"
                          stroke="#0f1115"
                          strokeWidth={6}
                          paintOrder="stroke"
                        >
                          {l.text}
                        </text>
                      </g>
                    ))}
                    </svg>
                  </div>
                </div>
              </div>
              {/* 色の凡例。ピンの色が何を意味するかマップ上で分かるように */}
              {stops.some((s) => fav.colorOf(s.item.id) !== 'none') && (
                <div
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-2 text-xs"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {PRIORITY_COLORS.filter(
                    (pc) => pc.value !== 'none' && stops.some((s) => fav.colorOf(s.item.id) === pc.value),
                  ).map((pc) => (
                    <span key={pc.value} className="flex items-center gap-1">
                      <span className="size-3 rounded-full" style={{ background: pc.hex }} />
                      <span style={{ color: 'var(--muted)' }}>{pc.label}</span>
                    </span>
                  ))}
                </div>
              )}
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
                <div className="mb-2 flex items-baseline justify-between gap-2">
                  <h2 className="text-sm font-semibold">周回順（{stops.length}件）</h2>
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      未訪問 {remaining}件
                    </span>
                    <button
                      type="button"
                      onClick={() => setReordering((v) => !v)}
                      className="rounded-lg border px-2 py-1 text-xs"
                      style={{
                        borderColor: reordering ? 'var(--color-mm-accent)' : 'var(--border)',
                        color: reordering ? 'var(--color-mm-accent)' : 'var(--fg)',
                      }}
                    >
                      {reordering ? '完了' : '順番を変える'}
                    </button>
                  </div>
                </div>

                {reordering && (
                  <div
                    className="mb-2 rounded-lg border p-2 text-xs"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                  >
                    <p style={{ color: 'var(--muted)' }}>
                      ▲▼ で入れ替えます。既定は入口からの蛇行順です。
                    </p>
                    <button
                      type="button"
                      onClick={() => fav.clearRouteOrders(stops.map((s) => s.item.id))}
                      className="mt-1.5 rounded border px-2 py-1"
                      style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                    >
                      蛇行順に戻す
                    </button>
                  </div>
                )}

                <ol className="flex flex-col gap-1.5">
                  {stops.map((s, i) => {
                    const visited = fav.isVisited(s.item.id);
                    const color = fav.colorOf(s.item.id);
                    return (
                      <li
                        key={s.item.id}
                        className="flex flex-col gap-1.5 rounded-lg border p-2"
                        style={{
                          borderColor: 'var(--border)',
                          background: 'var(--surface)',
                          opacity: visited ? 0.5 : 1,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold tabular-nums"
                            style={{
                              background: visited ? 'var(--surface2)' : PRIORITY_HEX[color],
                              color: visited ? 'var(--muted)' : '#0f1115',
                            }}
                          >
                            {s.order}
                          </span>
                          <span
                            className="shrink-0 rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
                            style={{
                              background: 'var(--surface2)',
                              color: 'var(--color-mm-accent)',
                            }}
                          >
                            {s.boothId}
                          </span>
                          <Link
                            href={`/creator/${encodeURIComponent(s.item.id)}/`}
                            className="min-w-0 flex-1 truncate text-sm"
                          >
                            {s.item.circleName}
                          </Link>
                          {reordering ? (
                            <span className="flex shrink-0 gap-1">
                              <button
                                type="button"
                                onClick={() => move(i, -1)}
                                disabled={i === 0}
                                className="rounded border px-2 py-1 text-xs disabled:opacity-30"
                                style={{ borderColor: 'var(--border)' }}
                                aria-label="上へ"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => move(i, 1)}
                                disabled={i === stops.length - 1}
                                className="rounded border px-2 py-1 text-xs disabled:opacity-30"
                                style={{ borderColor: 'var(--border)' }}
                                aria-label="下へ"
                              >
                                ▼
                              </button>
                            </span>
                          ) : (
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
                          )}
                        </div>

                        {/* 優先度の色。マップのピンに反映される */}
                        <div className="flex items-center gap-1.5 pl-9">
                          {PRIORITY_COLORS.map((pc) => (
                            <button
                              key={pc.value}
                              type="button"
                              onClick={() => fav.setColor(s.item.id, pc.value)}
                              aria-label={pc.label}
                              aria-pressed={color === pc.value}
                              title={pc.label}
                              className="size-5 rounded-full"
                              style={{
                                background: pc.hex,
                                outline:
                                  color === pc.value ? '2px solid var(--fg)' : '1px solid var(--border)',
                                outlineOffset: 1,
                                opacity: pc.value === 'none' ? 0.5 : 1,
                              }}
                            />
                          ))}
                        </div>
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
