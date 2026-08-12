'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Lightbox } from '@/components/Lightbox';
import { ShareButton } from '@/components/ShareButton';
import type { CreatorSummary } from '@/lib/data';
import {
  PRIORITY_COLORS,
  PURCHASE_STATUS_LABEL,
  type PriorityColor,
  type PurchaseStatus,
} from '@/lib/store';

function dayLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

type Props = {
  creator: CreatorSummary;
  favorite: boolean;
  visited: boolean;
  hasMemo: boolean;
  memo: string;
  status: PurchaseStatus;
  color: PriorityColor;
  onToggleFavorite: () => void;
  onSetMemo: (memo: string) => void;
  onSetStatus: (status: PurchaseStatus) => void;
  onSetColor: (color: PriorityColor) => void;
};

export function CreatorCard({
  creator: c,
  favorite,
  visited,
  hasMemo,
  memo,
  status,
  color,
  onToggleFavorite,
  onSetMemo,
  onSetStatus,
  onSetColor,
}: Props) {
  // お品書きサムネ → 失敗したらサークルロゴ → それも失敗したら文字
  const sources = [c.thumbUrl, c.logoUrl].filter((s): s is string => Boolean(s));
  const [srcIndex, setSrcIndex] = useState(0);
  const src = sources[srcIndex] ?? null;

  // 一覧に直接出すお品書き。確定分が無ければ参考（浜松）を出す。
  // 縦に長くなりすぎないよう1サークルあたり4枚まで。
  const [lightbox, setLightbox] = useState<number | null>(null);
  // メモ欄は既定で畳む。一覧が縦に伸びると本来の下調べがしにくくなる
  const [panel, setPanel] = useState(false);
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
            {shown.map((m, i) => (
              <button
                key={m.largeUrl}
                type="button"
                onClick={() => setLightbox(i)}
                className="block w-full overflow-hidden rounded-lg"
                style={{ background: 'var(--surface2)' }}
                aria-label="お品書きを拡大する"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.largeUrl}
                  alt={m.altText ?? 'お品書き'}
                  loading="lazy"
                  decoding="async"
                  width={m.width || undefined}
                  height={m.height || undefined}
                  className="w-full object-contain"
                  style={{ opacity: isReference ? 0.92 : 1, maxHeight: 'min(70vh, 560px)' }}
                />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 一覧だけで用が済むようにする。
          メモや購入状況のためにいちいち詳細ページを開かせない。
          既定は畳んでおき、押したときだけ開く（一覧が縦に伸びるのを防ぐ）。 */}
      <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPanel((v) => !v)}
            className="rounded-lg border px-2 py-1 text-xs"
            style={{
              borderColor: hasMemo ? 'var(--color-mm-accent2)' : 'var(--border)',
              color: hasMemo ? 'var(--color-mm-accent2)' : 'var(--muted)',
            }}
            aria-expanded={panel}
          >
            {hasMemo ? '📝 メモあり' : '📝 メモ'}
          </button>
          <div className="flex gap-1">
            {(['none', 'bought', 'skipped'] as PurchaseStatus[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSetStatus(s)}
                aria-pressed={status === s}
                className="rounded-lg border px-2 py-1 text-xs"
                style={{
                  borderColor: status === s ? 'var(--color-mm-accent)' : 'var(--border)',
                  color: status === s ? 'var(--color-mm-accent)' : 'var(--muted)',
                }}
              >
                {PURCHASE_STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="ml-auto flex gap-1">
            {PRIORITY_COLORS.map((pc) => (
              <button
                key={pc.value}
                type="button"
                onClick={() => onSetColor(pc.value)}
                aria-label={`優先度: ${pc.label}`}
                aria-pressed={color === pc.value}
                title={pc.label}
                className="size-4 rounded-full"
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
        </div>
        {panel && (
          <textarea
            value={memo}
            onChange={(e) => onSetMemo(e.target.value)}
            rows={2}
            placeholder="ここで直接メモできます（買うもの・予算・待ち合わせなど）"
            className="mt-2 w-full resize-y rounded-lg border p-2 text-sm"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg)',
              color: 'var(--fg)',
            }}
          />
        )}
      </div>

      {lightbox !== null && (
        <Lightbox
          images={shown}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndexChange={setLightbox}
        />
      )}

      {/* お気に入りと共有は Link の外に出す（カード遷移と衝突させない） */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        <button
          type="button"
          onClick={onToggleFavorite}
          aria-pressed={favorite}
          aria-label={`${c.circleName} をお気に入り${favorite ? 'から外す' : 'に追加'}`}
          className="flex size-9 items-center justify-center rounded-full text-lg transition-colors"
          style={{
            background: 'color-mix(in srgb, var(--surface2) 90%, transparent)',
            color: favorite ? 'var(--color-mm-accent2)' : 'var(--muted)',
          }}
        >
          {favorite ? '★' : '☆'}
        </button>
        <ShareButton
          compact
          path={`/creator/${encodeURIComponent(c.id)}/`}
          title={`${c.circleName}${c.boothId ? `（${c.boothId}）` : ''}`}
          text={`マジカルミライ2026 ${c.venue === 'osaka' ? '大阪' : '東京'} ${c.boothId ?? ''} ${c.circleName}`}
          className="flex size-9 items-center justify-center rounded-full text-base"
        />
      </div>
    </li>
  );
}
