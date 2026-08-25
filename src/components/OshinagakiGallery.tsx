'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { useFavorites } from '@/lib/use-favorites';
import { GOODS_CATEGORY_LABEL, type GoodsCategory } from '@shared/goods-category';
import type { Venue } from '@shared/types';

export type GalleryItem = {
  key: string;
  creatorId: string;
  circleName: string;
  boothId: string | null;
  venue: Venue;
  largeUrl: string;
  origUrl: string;
  altText: string | null;
  width: number;
  height: number;
  /** 浜松のお品書きを参考として出しているもの */
  isReference: boolean;
  /** 推定した頒布物の種類。絞り込みに使う */
  categories: GoodsCategory[];
};

/**
 * 全サークルのお品書きを1画面に並べる。
 *
 * 商品名・価格の抽出（items.json）が無くても、お品書きそのものを
 * 一覧で読めれば下調べには足りる。抽出ができたらそちらに切り替わる。
 */
export function OshinagakiGallery({
  items,
  initialVenue,
}: {
  items: GalleryItem[];
  /**
   * 最初に選んでおく会場。ページ側がビルド時の日付から決める。
   * 終わった会場のお品書きが混ざったまま開くと、いま買える物を探しにくい。
   */
  initialVenue?: Venue | 'all';
}) {
  const [venue, setVenue] = useState<Venue | 'all'>(initialVenue ?? 'all');
  const [includeReference, setIncludeReference] = useState(true);
  const [query, setQuery] = useState('');
  /** 選んだ種類。空なら絞らない。複数選んだらどれかに当たるものを出す */
  const [cats, setCats] = useState<Set<GoodsCategory>>(new Set());
  /** メモ欄を開いているサークル */
  const [memoOpen, setMemoOpen] = useState<Record<string, boolean>>({});
  const fav = useFavorites();

  /** 種類の選択肢は、実際に存在するものだけを件数つきで出す */
  const catCounts = useMemo(() => {
    const m = new Map<GoodsCategory, number>();
    for (const i of items) {
      if (venue !== 'all' && i.venue !== venue) continue;
      if (!includeReference && i.isReference) continue;
      for (const c of i.categories) m.set(c, (m.get(c) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [items, venue, includeReference]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (venue !== 'all' && i.venue !== venue) return false;
      if (!includeReference && i.isReference) return false;
      if (cats.size > 0 && !i.categories.some((c) => cats.has(c))) return false;
      if (q && !`${i.circleName} ${i.boothId ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, venue, includeReference, query, cats]);

  const toggleCat = (c: GoodsCategory) => {
    const next = new Set(cats);
    if (next.has(c)) next.delete(c);
    else next.add(c);
    setCats(next);
  };

  const confirmed = shown.filter((i) => !i.isReference).length;
  const reference = shown.length - confirmed;

  return (
    <main className="mx-auto max-w-3xl p-4">
      <h1 className="text-base font-bold">お品書き一覧</h1>
      <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
        この会場のお品書き {confirmed}枚
        {reference > 0 && ` / 参考（浜松）${reference}枚`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {(['all', 'osaka', 'tokyo'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setVenue(v)}
            className="rounded-lg border px-3 py-1.5 text-sm"
            style={
              venue === v
                ? {
                    borderColor: 'var(--color-mm-accent)',
                    background: 'var(--color-mm-accent)',
                    color: '#0f1115',
                  }
                : { borderColor: 'var(--border)', color: 'var(--muted)' }
            }
          >
            {v === 'all' ? '両会場' : v === 'osaka' ? '大阪' : '東京'}
          </button>
        ))}
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--muted)' }}>
          <input
            type="checkbox"
            checked={includeReference}
            onChange={(e) => setIncludeReference(e.target.checked)}
          />
          参考（浜松）も表示
        </label>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="サークル名・ブース番号で絞り込む"
        className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
        style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
      />

      {/* 頒布物の種類で絞る。
          このページが一覧の劣化版にならないよう、ここだけでできることを
          増やす。種類は本文・代替テキスト・目視の書き起こしから推定。 */}
      {catCounts.length > 0 && (
        <div className="mt-2">
          <div className="flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              頒布物の種類で絞る
            </span>
            {cats.size > 0 && (
              <button
                type="button"
                onClick={() => setCats(new Set())}
                className="text-xs underline"
                style={{ color: 'var(--muted)' }}
              >
                絞り込みを解除
              </button>
            )}
          </div>
          <div className="scroll-x -mx-4 mt-1 flex gap-1.5 px-4 pb-1">
            {catCounts.map(([c, n]) => (
              <button
                key={c}
                type="button"
                onClick={() => toggleCat(c)}
                aria-pressed={cats.has(c)}
                className="shrink-0 rounded-lg border px-2.5 py-1 text-xs whitespace-nowrap"
                style={
                  cats.has(c)
                    ? {
                        borderColor: 'var(--color-mm-accent)',
                        background: 'var(--color-mm-accent)',
                        color: '#0f1115',
                      }
                    : { borderColor: 'var(--border)', color: 'var(--muted)' }
                }
              >
                {GOODS_CATEGORY_LABEL[c]} {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="mt-6 text-sm" style={{ color: 'var(--muted)' }}>
          該当するお品書きがありません。
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-5">
          {shown.map((i) => (
            <li key={i.key}>
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                {i.boothId && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
                    style={{ background: 'var(--surface2)', color: 'var(--color-mm-accent)' }}
                  >
                    {i.boothId}
                  </span>
                )}
                <Link
                  href={`/creator/${encodeURIComponent(i.creatorId)}/`}
                  className="truncate text-sm font-semibold underline"
                >
                  {i.circleName}
                </Link>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {i.venue === 'osaka' ? '大阪' : '東京'}
                </span>
                {i.isReference && (
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                  >
                    参考・浜松のお品書き
                  </span>
                )}
                {/* このページだけで用が済むように、お気に入りとメモを置く */}
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => fav.toggleFavorite(i.creatorId)}
                    aria-pressed={fav.isFavorite(i.creatorId)}
                    aria-label="お気に入り"
                    className="rounded-lg border px-2 py-1 text-xs"
                    style={{
                      borderColor: fav.isFavorite(i.creatorId)
                        ? 'var(--color-mm-accent)'
                        : 'var(--border)',
                      color: fav.isFavorite(i.creatorId) ? 'var(--color-mm-accent)' : 'var(--muted)',
                    }}
                  >
                    {fav.isFavorite(i.creatorId) ? '★' : '☆'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMemoOpen((s) => ({ ...s, [i.creatorId]: !s[i.creatorId] }))}
                    className="rounded-lg border px-2 py-1 text-xs"
                    style={{
                      borderColor: fav.memoOf(i.creatorId).trim()
                        ? 'var(--color-mm-accent2)'
                        : 'var(--border)',
                      color: fav.memoOf(i.creatorId).trim()
                        ? 'var(--color-mm-accent2)'
                        : 'var(--muted)',
                    }}
                  >
                    📝
                  </button>
                </span>
              </div>
              {memoOpen[i.creatorId] && (
                <textarea
                  value={fav.memoOf(i.creatorId)}
                  onChange={(e) => fav.setMemo(i.creatorId, e.target.value)}
                  rows={2}
                  placeholder="メモ（買うもの・予算など）"
                  className="mb-1.5 w-full resize-y rounded-lg border p-2 text-sm"
                  style={{
                    borderColor: 'var(--border)',
                    background: 'var(--bg)',
                    color: 'var(--fg)',
                  }}
                />
              )}
              <div className="mb-1.5 flex flex-wrap gap-1">
                {i.categories
                  .filter((c) => c !== 'other')
                  .map((c) => (
                    <span
                      key={c}
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                    >
                      {GOODS_CATEGORY_LABEL[c]}
                    </span>
                  ))}
              </div>
              <a
                href={i.origUrl}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-xl border"
                style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={i.largeUrl}
                  alt={i.altText ?? 'お品書き'}
                  loading="lazy"
                  decoding="async"
                  width={i.width || undefined}
                  height={i.height || undefined}
                  className="w-full"
                  style={{ opacity: i.isReference ? 0.92 : 1 }}
                />
              </a>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
