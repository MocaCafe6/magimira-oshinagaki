'use client';

import Link from 'next/link';
import { useState } from 'react';

import type { CreatorSummary } from '@/lib/data';

function dayLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

type Props = {
  creator: CreatorSummary;
  favorite: boolean;
  visited: boolean;
  hasMemo: boolean;
  onToggleFavorite: () => void;
};

export function CreatorCard({ creator: c, favorite, visited, hasMemo, onToggleFavorite }: Props) {
  // お品書きサムネ → 失敗したらサークルロゴ → それも失敗したら文字
  const sources = [c.thumbUrl, c.logoUrl].filter((s): s is string => Boolean(s));
  const [srcIndex, setSrcIndex] = useState(0);
  const src = sources[srcIndex] ?? null;

  // 一覧に直接出すお品書き。確定分が無ければ参考（浜松）を出す。
  // 縦に長くなりすぎないよう1サークルあたり4枚まで。
  const isReference = c.images.length === 0 && c.referenceImages.length > 0;
  const shown = (c.images.length > 0 ? c.images : c.referenceImages).slice(0, 4);

  return (
    <li
      className="relative overflow-hidden rounded-xl border transition-opacity"
      style={{
        borderColor: favorite ? 'var(--color-mm-accent)' : 'var(--border)',
        background: 'var(--surface)',
        opacity: visited ? 0.55 : 1,
      }}
    >
      <Link href={`/creator/${encodeURIComponent(c.id)}/`} className="flex gap-3 p-3">
        {/* サムネイル: お品書き画像があればそれ、無ければサークルロゴ */}
        <div
          className="relative size-20 shrink-0 overflow-hidden rounded-lg"
          style={{ background: 'var(--surface2)' }}
        >
          {src ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              decoding="async"
              // 投稿が削除されてお品書き画像が消えたらロゴに退避する
              onError={() => setSrcIndex((i) => i + 1)}
              className="size-full object-cover"
            />
          ) : (
            <div
              className="flex size-full items-center justify-center text-xs"
              style={{ color: 'var(--muted)' }}
            >
              画像なし
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {c.boothId && (
              <span
                className="rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
                style={{ background: 'var(--surface2)', color: 'var(--color-mm-accent)' }}
              >
                {c.boothId}
              </span>
            )}
            {c.kind === 'sponsor' && (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                企業
              </span>
            )}
            {visited && (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                訪問済み
              </span>
            )}
          </div>

          <h3 className="mt-0.5 truncate font-semibold">{c.circleName}</h3>

          {c.memberNames.length > 0 && (
            <p className="truncate text-sm" style={{ color: 'var(--muted)' }}>
              {c.memberNames.join(' / ')}
            </p>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
            {c.days.map((d) => (
              <span
                key={d}
                className="rounded px-1.5 py-0.5 tabular-nums"
                style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
              >
                {dayLabel(d)}
              </span>
            ))}
            {c.oshinagakiCount > 0 ? (
              <span style={{ color: 'var(--color-mm-accent)' }}>
                お品書き {c.oshinagakiCount}枚
              </span>
            ) : (
              <span style={{ color: 'var(--muted)' }}>お品書き未確認</span>
            )}
            {hasMemo && <span style={{ color: 'var(--color-mm-accent2)' }}>メモあり</span>}
          </div>
        </div>
      </Link>

      {/* お品書きは一覧でそのまま読めるようにする。
          詳細を開かないと品揃えが分からないのでは下調べにならない。 */}
      {shown.length > 0 && (
        <div className="px-3 pb-3">
          {isReference && (
            <p
              className="mb-1.5 rounded px-2 py-1 text-xs leading-snug"
              style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
            >
              <span className="font-semibold">参考</span> — 浜松（7/24〜26・終了）のお品書きです。
              {c.venue === 'osaka' ? '大阪' : '東京'}でも同じ内容とは限りません
            </p>
          )}
          <div className={shown.length > 1 ? 'grid grid-cols-2 gap-1' : ''}>
            {shown.map((m) => (
              <a
                key={m.largeUrl}
                href={m.origUrl}
                target="_blank"
                rel="noreferrer"
                className="block overflow-hidden rounded-lg"
                style={{ background: 'var(--surface2)' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.largeUrl}
                  alt={m.altText ?? 'お品書き'}
                  loading="lazy"
                  decoding="async"
                  width={m.width || undefined}
                  height={m.height || undefined}
                  className="w-full"
                  style={{ opacity: isReference ? 0.92 : 1 }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* お気に入りは Link の外に出す（カード遷移と衝突させない） */}
      <button
        type="button"
        onClick={onToggleFavorite}
        aria-pressed={favorite}
        aria-label={`${c.circleName} をお気に入り${favorite ? 'から外す' : 'に追加'}`}
        className="absolute top-2 right-2 flex size-9 items-center justify-center rounded-full text-lg transition-colors"
        style={{
          background: 'color-mix(in srgb, var(--surface2) 90%, transparent)',
          color: favorite ? 'var(--color-mm-accent2)' : 'var(--muted)',
        }}
      >
        {favorite ? '★' : '☆'}
      </button>
    </li>
  );
}
