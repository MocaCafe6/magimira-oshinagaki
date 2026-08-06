'use client';

/**
 * 全サークル横断のグッズ一覧。
 * 「アクリルスタンドだけ見る」「3000円以下」といった絞り込みができる。
 * AI 抽出（items.json）が無いうちは案内だけを出す。
 */

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Chip } from '@/components/Chip';
import { useFavorites } from '@/lib/use-favorites';
import type { ExtractedItem, Venue } from '@shared/types';

export type ItemRow = {
  key: string;
  creatorId: string;
  circleName: string;
  boothId: string | null;
  venue: Venue;
  days: string[];
  postId: string;
  postUrl: string;
  mediaIndex: number;
  itemIndex: number;
  thumbUrl: string | null;
  name: string;
  price: number | null;
  priceNote: string | null;
  category: string;
  confidence: ExtractedItem['confidence'];
};

const PRICE_BANDS = [
  { label: '〜1000円', max: 1000 },
  { label: '〜3000円', max: 3000 },
  { label: '〜5000円', max: 5000 },
] as const;

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

export function ItemsView({ rows, categories }: { rows: ItemRow[]; categories: string[] }) {
  const fav = useFavorites();
  const [venue, setVenue] = useState<Venue | 'all'>('all');
  const [category, setCategory] = useState<string | null>(null);
  const [maxPrice, setMaxPrice] = useState<number | null>(null);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (venue !== 'all' && r.venue !== venue) return false;
      if (category && r.category !== category) return false;
      if (maxPrice !== null && (r.price === null || r.price > maxPrice)) return false;
      if (onlyFavorites && !fav.isItemFavorite(r.postId, r.mediaIndex, r.itemIndex)) return false;
      if (q && !`${r.name} ${r.circleName} ${r.category}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, venue, category, maxPrice, onlyFavorites, query, fav]);

  if (rows.length === 0) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <h1 className="text-base font-bold">グッズ一覧</h1>
        <div
          className="mt-3 rounded-xl border p-4 text-sm leading-relaxed"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <p style={{ color: 'var(--muted)' }}>
            まだ商品情報が抽出されていません。お品書き画像から商品名・価格を読み取ると、
            全サークル横断で「アクリルスタンドだけ見る」「3000円以下」といった
            絞り込みができるようになります。
          </p>
          <p className="mt-2" style={{ color: 'var(--muted)' }}>
            <code>npm run crawl-x</code> → <code>npm run review</code> →{' '}
            <code>npm run extract-items</code> の順に実行してください。
          </p>
          <Link
            href="/"
            className="mt-3 inline-block underline"
            style={{ color: 'var(--color-mm-accent)' }}
          >
            サークル一覧へ
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl">
      <header
        className="sticky top-0 z-30 border-b px-4 pt-3 pb-2 backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
        }}
      >
        <h1 className="text-base font-bold">グッズ一覧</h1>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="商品名・サークル名で検索"
          className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />
        <div className="scroll-x -mx-4 mt-2 flex gap-1.5 px-4 pb-1">
          <Chip active={venue === 'all'} onClick={() => setVenue('all')}>
            全会場
          </Chip>
          <Chip active={venue === 'osaka'} onClick={() => setVenue('osaka')}>
            大阪
          </Chip>
          <Chip active={venue === 'tokyo'} onClick={() => setVenue('tokyo')}>
            東京
          </Chip>
          <span className="w-2" aria-hidden />
          {PRICE_BANDS.map((b) => (
            <Chip
              key={b.max}
              active={maxPrice === b.max}
              onClick={() => setMaxPrice(maxPrice === b.max ? null : b.max)}
            >
              {b.label}
            </Chip>
          ))}
          <span className="w-2" aria-hidden />
          <Chip
            active={onlyFavorites}
            onClick={() => setOnlyFavorites((v) => !v)}
            accent="var(--color-mm-accent2)"
          >
            ★のみ
          </Chip>
        </div>
        <div className="scroll-x -mx-4 flex gap-1.5 px-4 pb-1">
          <Chip active={category === null} onClick={() => setCategory(null)}>
            全種別
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c}
            </Chip>
          ))}
        </div>
      </header>

      <div className="px-4 py-3">
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          {filtered.length}件（AI が画像から読み取った内容です。必ず原寸画像で確認してください）
        </p>
        <ul className="flex flex-col gap-1.5">
          {filtered.map((r) => {
            const on = fav.isItemFavorite(r.postId, r.mediaIndex, r.itemIndex);
            return (
              <li
                key={r.key}
                className="flex items-center gap-2 rounded-lg border p-2"
                style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
              >
                <button
                  type="button"
                  onClick={() =>
                    fav.toggleItemFavorite({
                      creatorId: r.creatorId,
                      postId: r.postId,
                      mediaIndex: r.mediaIndex,
                      itemIndex: r.itemIndex,
                      itemName: r.name,
                    })
                  }
                  aria-pressed={on}
                  className="shrink-0 text-lg"
                  style={{ color: on ? 'var(--color-mm-accent2)' : 'var(--muted)' }}
                  aria-label={`${r.name} をお気に入り`}
                >
                  {on ? '★' : '☆'}
                </button>

                {r.thumbUrl && (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={r.thumbUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-12 shrink-0 rounded object-cover"
                  />
                )}

                <Link href={`/creator/${encodeURIComponent(r.creatorId)}/`} className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.name}</p>
                  <p className="truncate text-xs" style={{ color: 'var(--muted)' }}>
                    {r.venue === 'osaka' ? '大阪' : '東京'}
                    {r.boothId ? ` ${r.boothId}` : ''} / {r.circleName} / {r.category}
                    {r.confidence === 'low' && ' / 読み取り自信度:低'}
                  </p>
                </Link>

                <span className="shrink-0 text-sm tabular-nums">
                  {r.price === null ? '—' : yen(r.price)}
                  {r.priceNote && (
                    <span className="ml-1 text-xs" style={{ color: 'var(--muted)' }}>
                      {r.priceNote}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
