'use client';

/**
 * お気に入り・メモの一覧。
 * 「気になったグッズを忘れずに再チェックする」ための画面。
 * 端末内保存なので、PC↔スマホの受け渡し用にエクスポート/インポートを置く。
 */

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';

import { Chip } from '@/components/Chip';
import type { VenueIndex } from '@/components/CreatorBrowser';
import type { CreatorSummary } from '@/lib/data';
import { getStore } from '@/lib/store';
import { useFavorites } from '@/lib/use-favorites';
import type { Venue } from '@shared/types';

function dayLabel(iso: string): string {
  return `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

export function FavoritesView({ indexes }: { indexes: VenueIndex[] }) {
  const fav = useFavorites();
  const [venue, setVenue] = useState<Venue | 'all'>('all');
  const [hideVisited, setHideVisited] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const byId = useMemo(() => {
    const m = new Map<string, CreatorSummary>();
    for (const i of indexes) for (const c of i.creators) m.set(c.id, c);
    return m;
  }, [indexes]);

  const rows = useMemo(() => {
    const out: { creator: CreatorSummary; memo: string; visited: boolean }[] = [];
    for (const [id, rec] of fav.records) {
      if (!rec.favorite && rec.memo.trim() === '') continue;
      const creator = byId.get(id);
      if (!creator) continue; // データ更新で消えたサークル
      if (venue !== 'all' && creator.venue !== venue) continue;
      if (hideVisited && rec.visited) continue;
      out.push({ creator, memo: rec.memo, visited: rec.visited });
    }
    // 会場 → 列 → ブース番号順。会場で回る順序に近い並びにする
    return out.sort((a, b) => {
      if (a.creator.venue !== b.creator.venue) return a.creator.venue < b.creator.venue ? -1 : 1;
      const al = a.creator.line ?? '￿';
      const bl = b.creator.line ?? '￿';
      if (al !== bl) return al < bl ? -1 : 1;
      return (a.creator.boothNo ?? 9999) - (b.creator.boothNo ?? 9999);
    });
  }, [fav.records, byId, venue, hideVisited]);

  const itemFavCount = fav.itemKeys.size;

  const handleExport = async (): Promise<void> => {
    const json = await getStore().exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magimira-favorites-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setMessage('エクスポートしました');
  };

  const handleImport = async (file: File, mode: 'merge' | 'replace'): Promise<void> => {
    try {
      const text = await file.text();
      const res = await getStore().importJson(text, mode);
      fav.reload();
      setMessage(`読み込みました（サークル ${res.favorites}件 / グッズ ${res.items}件）`);
    } catch (err) {
      setMessage(`読み込み失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <main className="mx-auto max-w-3xl">
      <header
        className="sticky top-0 z-30 border-b px-4 pt-3 pb-2 backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
        }}
      >
        <h1 className="text-base font-bold">お気に入り・メモ</h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          サークル {rows.length}件 / 個別グッズ {itemFavCount}件
        </p>
        <div className="scroll-x -mx-4 mt-2 flex gap-1.5 px-4 pb-1">
          <Chip active={venue === 'all'} onClick={() => setVenue('all')}>
            全会場
          </Chip>
          {indexes.map((i) => (
            <Chip key={i.venue} active={venue === i.venue} onClick={() => setVenue(i.venue)}>
              {i.label}
            </Chip>
          ))}
          <span className="w-2" aria-hidden />
          <Chip active={hideVisited} onClick={() => setHideVisited((v) => !v)}>
            未訪問のみ
          </Chip>
        </div>
      </header>

      <div className="flex flex-col gap-3 p-4">
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
            まだお気に入りがありません。
            <br />
            <Link href="/" className="underline" style={{ color: 'var(--color-mm-accent)' }}>
              一覧から ☆ を押して追加
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="favorite-list">
            {rows.map(({ creator: c, memo, visited }) => (
              <li
                key={c.id}
                className="rounded-xl border p-3"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--surface)',
                  opacity: visited ? 0.55 : 1,
                }}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => fav.setVisited(c.id, !visited)}
                    aria-pressed={visited}
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border text-xs"
                    style={{
                      borderColor: visited ? 'var(--color-mm-accent)' : 'var(--border)',
                      color: 'var(--color-mm-accent)',
                    }}
                    aria-label={visited ? '未訪問に戻す' : '訪問済みにする'}
                  >
                    {visited ? '✓' : ''}
                  </button>

                  <div className="min-w-0 flex-1">
                    <Link href={`/creator/${encodeURIComponent(c.id)}/`} className="block">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          {c.venue === 'osaka' ? '大阪' : '東京'}
                        </span>
                        {c.boothId && (
                          <span
                            className="rounded px-1.5 py-0.5 text-xs font-bold tabular-nums"
                            style={{
                              background: 'var(--surface2)',
                              color: 'var(--color-mm-accent)',
                            }}
                          >
                            {c.boothId}
                          </span>
                        )}
                        {c.days.map((d) => (
                          <span key={d} className="text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
                            {dayLabel(d)}
                          </span>
                        ))}
                      </div>
                      <h2 className="mt-0.5 truncate font-semibold">{c.circleName}</h2>
                    </Link>

                    {memo.trim() !== '' && (
                      <p
                        className="mt-1.5 rounded-lg px-2 py-1.5 text-sm whitespace-pre-wrap"
                        style={{ background: 'var(--bg)', color: 'var(--text)' }}
                      >
                        {memo}
                      </p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => fav.toggleFavorite(c.id)}
                    className="shrink-0 text-lg"
                    style={{ color: 'var(--color-mm-accent2)' }}
                    aria-label="お気に入りから外す"
                  >
                    ★
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* 端末間の受け渡し */}
        <section
          className="mt-2 rounded-xl border p-3"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <h2 className="text-sm font-semibold">別の端末に持っていく</h2>
          <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
            お気に入りとメモはこの端末に保存されています。PCで下調べした内容を
            スマホで見る場合は、JSON を書き出して読み込んでください。
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              エクスポート
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: 'var(--border)' }}
            >
              インポート（統合）
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f, 'merge');
                e.target.value = '';
              }}
            />
          </div>
          {message && (
            <p className="mt-2 text-xs" style={{ color: 'var(--color-mm-accent)' }}>
              {message}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
