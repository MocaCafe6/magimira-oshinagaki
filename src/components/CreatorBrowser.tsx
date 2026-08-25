'use client';

/**
 * サークル一覧の閲覧・絞り込み。
 * 会場切替はクライアント側で行う（ページ遷移せず、下調べ中の往復を速くする）。
 */

import { useMemo, useState } from 'react';

import { Chip } from '@/components/Chip';
import { CreatorCard } from '@/components/CreatorCard';
import { OfflineSetup } from '@/components/OfflineSetup';
import type { CreatorSummary } from '@/lib/data';
import { useFavorites } from '@/lib/use-favorites';
import type { Venue } from '@shared/types';

export type VenueIndex = {
  venue: Venue;
  label: string;
  hall: string;
  days: string[];
  /** 会期が終わっているか（ビルド時に決めている） */
  isOver: boolean;
  creators: CreatorSummary[];
  withOshinagaki: number;
  totalOshinagaki: number;
  offlineUrls: string[];
  largeByCreator: Record<string, string[]>;
};

type Props = {
  indexes: VenueIndex[];
  /**
   * 最初に選んでおく会場。ページ側がビルド時の日付から決める。
   * ここで `new Date()` を見てはいけない——SSR 済みの HTML と食い違う。
   */
  initialVenue?: Venue;
};

function dayLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const wd = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${wd})`;
}

export function CreatorBrowser({ indexes, initialVenue }: Props) {
  const [venue, setVenue] = useState<Venue>(
    initialVenue ?? indexes[0]?.venue ?? 'osaka',
  );
  const [day, setDay] = useState<string | null>(null);
  const [onlyOshinagaki, setOnlyOshinagaki] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [includeSponsors, setIncludeSponsors] = useState(true);
  const [query, setQuery] = useState('');

  const fav = useFavorites();
  const current = indexes.find((i) => i.venue === venue) ?? indexes[0];

  const filtered = useMemo(() => {
    if (!current) return [];
    const q = query.trim().toLowerCase();
    return current.creators.filter((c) => {
      if (!includeSponsors && c.kind === 'sponsor') return false;
      if (day && !c.days.includes(day)) return false;
      if (onlyOshinagaki && c.oshinagakiCount === 0) return false;
      if (onlyFavorites && !fav.isFavorite(c.id)) return false;
      if (q && !c.searchText.includes(q)) return false;
      return true;
    });
  }, [current, query, day, onlyOshinagaki, onlyFavorites, includeSponsors, fav]);

  if (!current) {
    return (
      <main className="mx-auto max-w-7xl p-4">
        <p style={{ color: 'var(--muted)' }}>
          データがありません。<code>npm run scrape-official</code> を実行してください。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-7xl">
      {/* ヘッダ: 会場切替 */}
      <header
        className="sticky top-0 z-30 border-b px-4 pt-3 pb-2 backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 90%, transparent)',
        }}
      >
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-bold">マジミラお品書き一覧</h1>
          <div className="flex gap-1">
            {indexes.map((i) => (
              <Chip
                key={i.venue}
                active={i.venue === venue}
                onClick={() => {
                  setVenue(i.venue);
                  setDay(null);
                }}
                title={i.isOver ? `${i.label}は会期が終了しました` : undefined}
              >
                {i.label}
                {i.isOver && (
                  <span className="ml-1 text-[10px] font-normal opacity-70">終了</span>
                )}
              </Chip>
            ))}
          </div>
        </div>

        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          {current.hall} ／ {current.creators.length}件中 {current.withOshinagaki}件でお品書き確認
          （計 {current.totalOshinagaki}枚）
        </p>

        {/* 検索 */}
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="サークル名・作者名・ブース番号・商品名で検索"
          className="mt-2 w-full rounded-lg border px-3 py-2 text-sm outline-none"
          style={{
            borderColor: 'var(--border)',
            background: 'var(--surface)',
            color: 'var(--text)',
          }}
        />

        {/* フィルタ */}
        <div className="scroll-x -mx-4 mt-2 flex gap-1.5 px-4 pb-1">
          <Chip active={day === null} onClick={() => setDay(null)}>
            全日
          </Chip>
          {current.days.map((d) => (
            <Chip key={d} active={day === d} onClick={() => setDay(d)}>
              {dayLabel(d)}
            </Chip>
          ))}
          <span className="w-2" aria-hidden />
          <Chip active={onlyOshinagaki} onClick={() => setOnlyOshinagaki((v) => !v)}>
            お品書きあり
          </Chip>
          <Chip
            active={onlyFavorites}
            onClick={() => setOnlyFavorites((v) => !v)}
            accent="var(--color-mm-accent2)"
          >
            ★のみ{fav.favoriteCount > 0 ? ` (${fav.favoriteCount})` : ''}
          </Chip>
          <Chip active={includeSponsors} onClick={() => setIncludeSponsors((v) => !v)}>
            企業ブース含む
          </Chip>
        </div>
      </header>

      {/* 一覧 */}
      <div className="px-4 py-3">
        <p className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          {filtered.length}件
        </p>

        {filtered.length === 0 ? (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
            条件に合うサークルがありません
          </p>
        ) : (
          <ul
              className="grid grid-cols-1 items-start gap-3 md:grid-cols-2 xl:grid-cols-3"
              data-testid="creator-list"
            >
            {filtered.map((c) => (
              <CreatorCard
                key={c.id}
                creator={c}
                favorite={fav.isFavorite(c.id)}
                visited={fav.isVisited(c.id)}
                hasMemo={fav.memoOf(c.id).trim().length > 0}
                memo={fav.memoOf(c.id)}
                status={fav.statusOf(c.id)}
                color={fav.colorOf(c.id)}
                onToggleFavorite={() => fav.toggleFavorite(c.id)}
                onSetMemo={(m) => fav.setMemo(c.id, m)}
                onSetStatus={(s) => fav.setStatus(c.id, s)}
                onSetColor={(col) => fav.setColor(c.id, col)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 pb-4">
        <OfflineSetup
          urls={current.offlineUrls}
          largeByCreator={current.largeByCreator}
          venueLabel={current.label}
        />
      </div>

      <footer className="px-4 pb-6 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        <p>
          出店者情報は
          <a
            href="https://magicalmirai.com/2026/"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            マジカルミライ公式サイト
          </a>
          より取得。お品書き画像は各クリエイターの X 投稿を参照しています（画像は X
          のサーバから直接読み込んでおり、当サイトでは保持していません）。
        </p>
        <p className="mt-1">
          非公式のファン制作ツールです。掲載の停止をご希望のクリエイター様は
          お手数ですがご連絡ください。
        </p>
      </footer>
    </main>
  );
}
