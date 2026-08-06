'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

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
};

/**
 * 全サークルのお品書きを1画面に並べる。
 *
 * 商品名・価格の抽出（items.json）が無くても、お品書きそのものを
 * 一覧で読めれば下調べには足りる。抽出ができたらそちらに切り替わる。
 */
export function OshinagakiGallery({ items }: { items: GalleryItem[] }) {
  const [venue, setVenue] = useState<Venue | 'all'>('all');
  const [includeReference, setIncludeReference] = useState(true);
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((i) => {
      if (venue !== 'all' && i.venue !== venue) return false;
      if (!includeReference && i.isReference) return false;
      if (q && !`${i.circleName} ${i.boothId ?? ''}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, venue, includeReference, query]);

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
