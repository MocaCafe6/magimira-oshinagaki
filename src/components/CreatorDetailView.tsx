'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

import { Lightbox, type LightboxImage } from '@/components/Lightbox';
import { OshinagakiImage } from '@/components/OshinagakiImage';
import { ShareButton } from '@/components/ShareButton';
import type { CreatorDetail } from '@/lib/data';
import { useFavorites } from '@/lib/use-favorites';

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd})`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function yen(n: number): string {
  return `¥${n.toLocaleString('ja-JP')}`;
}

export function CreatorDetailView({ detail }: { detail: CreatorDetail }) {
  const fav = useFavorites();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [memoDraft, setMemoDraft] = useState<string | null>(null);

  // 全投稿の画像を1本の配列にして、ライトボックスで前後に送れるようにする
  const images = useMemo<(LightboxImage & { postId: string; mediaIndex: number })[]>(() => {
    const out: (LightboxImage & { postId: string; mediaIndex: number })[] = [];
    for (const p of detail.posts) {
      p.media.forEach((m, mi) => {
        if (m.kind !== 'photo') return;
        out.push({
          origUrl: m.origUrl,
          largeUrl: m.largeUrl,
          altText: m.altText,
          width: m.width,
          height: m.height,
          postUrl: p.url,
          postId: p.id,
          mediaIndex: mi,
        });
      });
    }
    return out;
  }, [detail.posts]);

  const memo = memoDraft ?? fav.memoOf(detail.id);
  const favorite = fav.isFavorite(detail.id);
  const visited = fav.isVisited(detail.id);

  const itemsByPost = useMemo(() => {
    const m = new Map<string, CreatorDetail['items']>();
    for (const e of detail.items) {
      const arr = m.get(e.postId) ?? [];
      arr.push(e);
      m.set(e.postId, arr);
    }
    return m;
  }, [detail.items]);

  return (
    <main className="mx-auto max-w-5xl">
      <header
        className="sticky top-0 z-30 border-b px-4 py-3 backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
        }}
      >
        <Link href="/" className="text-sm underline" style={{ color: 'var(--muted)' }}>
          ← 一覧に戻る
        </Link>
        <div className="mt-2 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {detail.boothId && (
                <span
                  className="rounded px-2 py-0.5 text-sm font-bold tabular-nums"
                  style={{ background: 'var(--surface2)', color: 'var(--color-mm-accent)' }}
                >
                  {detail.boothId}
                </span>
              )}
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {detail.venue === 'osaka' ? '大阪' : '東京'}
                {detail.kind === 'sponsor' ? ' / 企業ブース' : ''}
              </span>
            </div>
            <h1 className="mt-1 text-lg font-bold">{detail.circleName}</h1>
            <div className="mt-1 flex flex-wrap gap-1.5 text-xs">
              {detail.days.map((d) => (
                <span
                  key={d}
                  className="rounded px-1.5 py-0.5 tabular-nums"
                  style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                >
                  {dayLabel(d)}
                </span>
              ))}
            </div>
          </div>

          <div className="flex shrink-0 flex-col gap-1.5">
            <button
              type="button"
              onClick={() => fav.toggleFavorite(detail.id)}
              aria-pressed={favorite}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={
                favorite
                  ? {
                      borderColor: 'var(--color-mm-accent2)',
                      background: 'var(--color-mm-accent2)',
                      color: '#0f1115',
                    }
                  : { borderColor: 'var(--border)', color: 'var(--muted)' }
              }
            >
              {favorite ? '★ 登録済' : '☆ お気に入り'}
            </button>
            <button
              type="button"
              onClick={() => fav.setVisited(detail.id, !visited)}
              aria-pressed={visited}
              className="rounded-lg border px-3 py-2 text-xs"
              style={{
                borderColor: 'var(--border)',
                color: visited ? 'var(--color-mm-accent)' : 'var(--muted)',
              }}
            >
              {visited ? '訪問済み' : '未訪問'}
            </button>
            <ShareButton
              path={`/creator/${encodeURIComponent(detail.id)}/`}
              title={`${detail.circleName}${detail.boothId ? `（${detail.boothId}）` : ''}`}
              text={`マジカルミライ2026 ${detail.venue === 'osaka' ? '大阪' : '東京'} ${detail.boothId ?? ''} ${detail.circleName}`}
              className="rounded-lg border px-3 py-2 text-xs"
            />
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {/* メンバーとリンク */}
        {detail.members.length > 0 && (
          <section
            className="rounded-xl border p-3"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
              参加クリエイター
            </h2>
            <ul className="flex flex-col gap-2">
              {detail.members.map((m, i) => (
                <li key={`${m.name}-${i}`} className="flex flex-wrap items-center gap-2">
                  {m.name && <span className="font-medium">{m.name}</span>}
                  {m.links.map((l) => (
                    <a
                      key={l.url}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded border px-2 py-0.5 text-xs"
                      style={{
                        borderColor: 'var(--border)',
                        color:
                          l.kind === 'x' ? 'var(--color-mm-accent)' : 'var(--muted)',
                      }}
                    >
                      {l.kind === 'x' ? `X @${l.url.split('/').pop()}` : l.label || l.kind}
                    </a>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}

        {detail.note && (
          <section
            className="rounded-xl border p-3 text-sm leading-relaxed"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {detail.note}
          </section>
        )}

        {/* メモ */}
        <section
          className="rounded-xl border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
            メモ
          </h2>
          <textarea
            value={memo}
            onChange={(e) => {
              setMemoDraft(e.target.value);
              fav.setMemo(detail.id, e.target.value);
            }}
            rows={3}
            placeholder="気になったグッズ、予算、優先度など"
            className="w-full resize-y rounded-lg border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: 'var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
            }}
          />
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            この端末に保存されます（サーバには送信されません）
          </p>
        </section>

        {/* お品書き */}
        <section>
          <h2 className="mb-2 text-sm font-semibold" style={{ color: 'var(--muted)' }}>
            お品書き
          </h2>

          {detail.posts.length === 0 ? (
            <div
              className="rounded-xl border p-4 text-sm"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <p style={{ color: 'var(--muted)' }}>
                まだお品書きが確認できていません。
                {detail.xHandles.length > 0 && (
                  <>
                    {' '}
                    X で直接確認できます:{' '}
                    {detail.xHandles.map((h) => (
                      <a
                        key={h}
                        href={`https://x.com/${h}`}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                        style={{ color: 'var(--color-mm-accent)' }}
                      >
                        @{h}
                      </a>
                    ))}
                  </>
                )}
              </p>
              {detail.referencePosts.length > 0 && (
                <ReferenceOshinagaki detail={detail} />
              )}
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {detail.posts.map((p) => {
                const extractions = itemsByPost.get(p.id) ?? [];
                return (
                  <li
                    key={p.id}
                    className="overflow-hidden rounded-xl border"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                  >
                    <div className="flex items-center justify-between gap-2 px-3 pt-3 text-xs">
                      <span style={{ color: 'var(--muted)' }}>
                        {formatDateTime(p.createdAt)}
                        {p.isPinned && (
                          <span className="ml-2" style={{ color: 'var(--color-mm-accent)' }}>
                            固定
                          </span>
                        )}
                      </span>
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline"
                        style={{ color: 'var(--color-mm-accent)' }}
                      >
                        元投稿を開く →
                      </a>
                    </div>

                    {p.text && (
                      <p className="px-3 pt-2 text-sm whitespace-pre-wrap">{p.text}</p>
                    )}

                    {p.media.length > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-1 p-1">
                        {p.media.map((m, mi) => {
                          const globalIndex = images.findIndex(
                            (im) => im.postId === p.id && im.mediaIndex === mi,
                          );
                          if (m.kind !== 'photo') {
                            return (
                              <a
                                key={m.baseUrl}
                                href={p.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex aspect-square items-center justify-center rounded-lg text-xs"
                                style={{ background: 'var(--surface2)', color: 'var(--muted)' }}
                              >
                                動画は X で再生 →
                              </a>
                            );
                          }
                          return (
                            <OshinagakiImage
                              key={m.baseUrl}
                              src={m.largeUrl}
                              alt={m.altText}
                              width={m.width}
                              height={m.height}
                              postUrl={p.url}
                              onOpen={() => setLightboxIndex(globalIndex)}
                            />
                          );
                        })}
                      </div>
                    )}

                    {/* AI が読み取った商品 */}
                    {extractions.some((e) => e.items.length > 0) && (
                      <div className="border-t px-3 py-2" style={{ borderColor: 'var(--border)' }}>
                        <h3 className="mb-1.5 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                          読み取った商品（AI 抽出・要確認）
                        </h3>
                        <ul className="flex flex-col gap-1">
                          {extractions.flatMap((e) =>
                            e.items.map((it, idx) => {
                              const on = fav.isItemFavorite(e.postId, e.mediaIndex, idx);
                              return (
                                <li
                                  key={`${e.postId}-${e.mediaIndex}-${idx}`}
                                  className="flex items-center gap-2 text-sm"
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      fav.toggleItemFavorite({
                                        creatorId: detail.id,
                                        postId: e.postId,
                                        mediaIndex: e.mediaIndex,
                                        itemIndex: idx,
                                        itemName: it.name,
                                      })
                                    }
                                    aria-pressed={on}
                                    className="shrink-0 text-base"
                                    style={{
                                      color: on ? 'var(--color-mm-accent2)' : 'var(--muted)',
                                    }}
                                    aria-label={`${it.name} をお気に入り`}
                                  >
                                    {on ? '★' : '☆'}
                                  </button>
                                  <span className="min-w-0 flex-1 truncate">{it.name}</span>
                                  <span
                                    className="shrink-0 text-xs"
                                    style={{ color: 'var(--muted)' }}
                                  >
                                    {it.category}
                                  </span>
                                  <span className="shrink-0 tabular-nums">
                                    {it.price === null ? '—' : yen(it.price)}
                                  </span>
                                </li>
                              );
                            }),
                          )}
                        </ul>
                        <p className="mt-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                          画像から自動で読み取った内容です。必ず原寸画像でご確認ください。
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {lightboxIndex !== null && images[lightboxIndex] && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onIndexChange={setLightboxIndex}
        />
      )}
    </main>
  );
}

/**
 * 参考として見せる、浜松で頒布されたお品書き。
 *
 * これは**その会場のお品書きではない**。浜松（7/24〜26・終了済み）で
 * 頒布された内容なので、売り切れた物も、この会場から増える物もある。
 * 確定枠と見た目をはっきり分け、何を見ているかが分かるようにする。
 */
function ReferenceOshinagaki({ detail }: { detail: CreatorDetail }) {
  const venueLabel = detail.venue === 'osaka' ? '大阪' : '東京';
  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
      <p
        className="mb-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
        style={{ background: 'var(--surface-2, rgba(127,127,127,0.12))', color: 'var(--muted)' }}
      >
        <span className="font-semibold">参考</span>
        {' — '}
        これは <strong>浜松会場（7/24〜26・終了）</strong> で頒布されたお品書きです。
        {venueLabel}でも同じ内容が並ぶとは限りません（売り切れ・追加があります）。
        {venueLabel}のお品書きが投稿されたら差し替わります。
      </p>
      <ul className="flex flex-col gap-4">
        {detail.referencePosts.map((p) => (
          <li
            key={p.id}
            className="overflow-hidden rounded-xl border opacity-90"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div className="flex items-center justify-between px-3 pt-2">
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                浜松のお品書き
              </span>
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline"
                style={{ color: 'var(--color-mm-accent)' }}
              >
                元投稿を開く →
              </a>
            </div>
            <p className="px-3 pt-1 text-sm whitespace-pre-wrap">{p.text}</p>
            <div className="mt-2 grid grid-cols-2 gap-1 p-1">
              {p.media
                .filter((m) => m.kind === 'photo')
                .map((m) => (
                  <OshinagakiImage
                    key={m.baseUrl}
                    src={m.largeUrl}
                    alt={m.altText ?? '浜松で頒布されたお品書き（参考）'}
                    width={m.width}
                    height={m.height}
                    postUrl={p.url}
                  />
                ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
