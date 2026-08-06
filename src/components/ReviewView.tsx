'use client';

/**
 * お品書き候補のレビュー（ローカル専用）。
 *
 * 完璧な自動判定は狙わない設計なので、ここで人間が採否を決める。
 * 判断は data/curation.json に永続化され、次回クロールを跨いで保持される。
 */

import { useMemo, useState } from 'react';

import { Chip } from '@/components/Chip';
import type { CurationVerdict, Post, Venue } from '@shared/types';
import { VENUES } from '@shared/types';

export type ReviewCandidate = {
  post: Post;
  circleName: string;
  boothIds: string[];
  venues: string[];
  verdict: CurationVerdict | null;
  /** 人手で指定した会場 */
  manualVenues: Venue[];
};

const VENUE_LABEL: Record<Venue, string> = { osaka: '大阪', tokyo: '東京' };

const ADMIN_API = 'http://127.0.0.1:8787';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ReviewView({
  candidates,
  excludedHandles,
}: {
  candidates: ReviewCandidate[];
  excludedHandles: string[];
}) {
  const [verdicts, setVerdicts] = useState<Map<string, CurationVerdict | null>>(
    () => new Map(candidates.map((c) => [c.post.id, c.verdict])),
  );
  const [filter, setFilter] = useState<'undecided' | 'adopted' | 'rejected' | 'all'>('undecided');
  const [minScore, setMinScore] = useState(50);
  const [onlyHamamatsu, setOnlyHamamatsu] = useState(false);
  const [onlyUnresolved, setOnlyUnresolved] = useState(true);
  const [manual, setManual] = useState<Map<string, Venue[]>>(
    () => new Map(candidates.map((c) => [c.post.id, c.manualVenues])),
  );
  /**
   * 「会場未確定のみ」の絞り込みは読み込み時点の状態で固定する。
   * 会場を指定した瞬間にカードが消えると、取り消しも確認もできず、
   * 一覧が飛び跳ねて作業しづらい。作業中は並びを安定させる。
   */
  const [initiallyUnresolved] = useState<Set<string>>(
    () =>
      new Set(
        candidates
          .filter(
            (c) =>
              (c.post.attribution?.provenVenues.length ?? 0) === 0 &&
              c.manualVenues.length === 0,
          )
          .map((c) => c.post.id),
      ),
  );
  const [error, setError] = useState<string | null>(null);
  const excluded = useMemo(
    () => new Set(excludedHandles.map((h) => h.toLowerCase())),
    [excludedHandles],
  );

  const save = async (postId: string, verdict: CurationVerdict | null): Promise<void> => {
    // 画面を即座に反応させ、保存は裏で行う
    setVerdicts((prev) => new Map(prev).set(postId, verdict));
    try {
      const res = await fetch(`${ADMIN_API}/curation/verdict`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, verdict }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setError(null);
    } catch (err) {
      setError(
        `保存に失敗しました（admin サーバが起動していますか？ npm run review で両方起動します）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  /** 人手で会場を指定する。自動判別できなかった投稿を公開する唯一の経路 */
  const saveVenues = async (postId: string, venues: Venue[]): Promise<void> => {
    setManual((prev) => new Map(prev).set(postId, venues));
    try {
      const res = await fetch(`${ADMIN_API}/curation/venues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, venues }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      setError(null);
    } catch (err) {
      setError(
        `保存に失敗しました（admin サーバが起動していますか？）: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  };

  const toggleVenue = (postId: string, venue: Venue): void => {
    const cur = manual.get(postId) ?? [];
    const next = cur.includes(venue) ? cur.filter((v) => v !== venue) : [...cur, venue];
    void saveVenues(postId, next);
  };

  const rows = useMemo(() => {
    return candidates.filter((c) => {
      const v = verdicts.get(c.post.id) ?? null;
      if (filter === 'undecided' && v !== null) return false;
      if (filter === 'adopted' && v !== 'adopted') return false;
      if (filter === 'rejected' && v !== 'rejected') return false;
      if (c.post.score < minScore) return false;
      if (onlyHamamatsu && !/浜松|HAMAMATSU/i.test(c.post.text)) return false;
      if (onlyUnresolved && !initiallyUnresolved.has(c.post.id)) return false;
      return true;
    });
  }, [candidates, verdicts, filter, minScore, onlyHamamatsu, onlyUnresolved, initiallyUnresolved]);

  const counts = useMemo(() => {
    let unresolved = 0;
    let published = 0;
    let rejected = 0;
    for (const c of candidates) {
      if ((verdicts.get(c.post.id) ?? null) === 'rejected') {
        rejected += 1;
        continue;
      }
      const resolved =
        (c.post.attribution?.provenVenues.length ?? 0) > 0 ||
        (manual.get(c.post.id)?.length ?? 0) > 0;
      if (resolved) published += 1;
      else unresolved += 1;
    }
    return { unresolved, published, rejected };
  }, [candidates, verdicts, manual]);

  return (
    <main className="mx-auto max-w-4xl">
      <header
        className="sticky top-0 z-30 border-b px-4 pt-3 pb-2 backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
        }}
      >
        <h1 className="flex items-baseline gap-2 text-base font-bold">
          <span>お品書きレビュー</span>
          <span className="text-xs font-normal" style={{ color: 'var(--muted)' }}>
            ローカル専用
          </span>
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          公開中 {counts.published} / <span style={{ color: 'var(--color-mm-accent2)' }}>会場未確定
          {counts.unresolved}</span> / 却下 {counts.rejected}（全 {candidates.length}件）
        </p>
        <p className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
          会場が確定していない投稿は公開されません。会場を指定すると公開されます。
        </p>
        <div className="scroll-x -mx-4 mt-2 flex gap-1.5 px-4 pb-1">
          <Chip
            active={onlyUnresolved}
            onClick={() => setOnlyUnresolved((v) => !v)}
            accent="var(--color-mm-accent2)"
          >
            会場未確定のみ
          </Chip>
          <span className="w-2" aria-hidden />
          <Chip active={filter === 'undecided'} onClick={() => setFilter('undecided')}>
            未判断
          </Chip>
          <Chip active={filter === 'adopted'} onClick={() => setFilter('adopted')}>
            採用
          </Chip>
          <Chip active={filter === 'rejected'} onClick={() => setFilter('rejected')}>
            却下
          </Chip>
          <Chip active={filter === 'all'} onClick={() => setFilter('all')}>
            すべて
          </Chip>
          <span className="w-2" aria-hidden />
          {[0, 30, 50, 70].map((s) => (
            <Chip key={s} active={minScore === s} onClick={() => setMinScore(s)}>
              score≧{s}
            </Chip>
          ))}
          <span className="w-2" aria-hidden />
          <Chip
            active={onlyHamamatsu}
            onClick={() => setOnlyHamamatsu((v) => !v)}
            accent="#e0b34a"
            title="浜松（終了済み）に言及する投稿だけを表示します。浜松専用のお品書きが紛れていないか確認してください。"
          >
            浜松に言及のみ
          </Chip>
        </div>
        {error && (
          <p className="mt-2 rounded-lg px-2 py-1.5 text-xs" style={{ background: '#5a1f1f', color: '#ffd9d9' }}>
            {error}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-3 p-4">
        {candidates.length === 0 && (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
            投稿データがありません。<code>npm run crawl-x</code> を実行してください。
          </p>
        )}

        {rows.map((c) => {
          const v = verdicts.get(c.post.id) ?? null;
          const isExcluded = excluded.has(c.post.handle.toLowerCase());
          return (
            <article
              key={c.post.id}
              className="overflow-hidden rounded-xl border"
              style={{
                borderColor:
                  v === 'adopted'
                    ? 'var(--color-mm-accent)'
                    : v === 'rejected'
                      ? '#7a3b3b'
                      : 'var(--border)',
                background: 'var(--surface)',
                opacity: v === 'rejected' ? 0.5 : 1,
              }}
            >
              <div className="flex flex-wrap items-center gap-2 px-3 pt-3 text-xs">
                <span
                  className="rounded px-1.5 py-0.5 font-bold tabular-nums"
                  style={{ background: 'var(--surface2)', color: 'var(--color-mm-accent)' }}
                >
                  score {c.post.score}
                </span>
                <span className="font-medium">{c.circleName}</span>
                {c.boothIds.length > 0 && (
                  <span style={{ color: 'var(--muted)' }}>{c.boothIds.join(' / ')}</span>
                )}
                <a
                  href={`https://x.com/${c.post.handle}`}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                  style={{ color: 'var(--muted)' }}
                >
                  @{c.post.handle}
                </a>
                <span style={{ color: 'var(--muted)' }}>{formatDateTime(c.post.createdAt)}</span>
                {c.post.isPinned && <span style={{ color: 'var(--color-mm-accent)' }}>固定</span>}
                {c.post.isManual && <span style={{ color: 'var(--color-mm-accent2)' }}>手動追加</span>}
                {isExcluded && <span style={{ color: '#ff9d9d' }}>掲載除外ハンドル</span>}
                {/*
                  浜松（終了済み）に言及する投稿は要確認。
                  「浜松 A-05 大阪 D-06 東京 C-18」のような複数会場のお品書きは
                  対象なので自動では落とせないが、浜松専用のお品書きが
                  紛れ込むことがあるので目印を出す。
                */}
                {/浜松|HAMAMATSU/i.test(c.post.text) && (
                  <span
                    className="rounded px-1.5 py-0.5"
                    style={{ background: '#5a4a1f', color: '#ffe9b0' }}
                    title="浜松（7/24-26・終了済み）に言及しています。浜松専用のお品書きなら却下してください。"
                  >
                    浜松に言及・要確認
                  </span>
                )}
              </div>

              {/* 会場帰属 — 公開されるかどうかを決める */}
              {(() => {
                const auto = c.post.attribution?.provenVenues ?? [];
                const man = manual.get(c.post.id) ?? [];
                const shown = [...new Set([...auto, ...man])];
                return (
                  <div className="px-3 pt-1.5">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      {shown.length > 0 ? (
                        <span style={{ color: 'var(--color-mm-accent)' }}>
                          公開: {shown.map((v) => VENUE_LABEL[v]).join('・')}
                        </span>
                      ) : (
                        <span style={{ color: 'var(--color-mm-accent2)' }}>
                          会場未確定 — 公開されません
                        </span>
                      )}
                      {c.post.attribution && c.post.attribution.source !== 'unresolved' && (
                        <span style={{ color: 'var(--muted)' }}>
                          （判定: {c.post.attribution.source}）
                        </span>
                      )}
                    </div>
                    {c.post.attribution?.evidence.length ? (
                      <ul className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                        {c.post.attribution.evidence.map((e, i) => (
                          <li key={i}>・{e}</li>
                        ))}
                      </ul>
                    ) : null}
                    {/* 人手での会場指定 */}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>
                        会場を指定:
                      </span>
                      {VENUES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => toggleVenue(c.post.id, v)}
                          aria-pressed={man.includes(v)}
                          className="rounded-full border px-2.5 py-1 text-xs"
                          style={
                            man.includes(v)
                              ? {
                                  borderColor: 'var(--color-mm-accent2)',
                                  background: 'var(--color-mm-accent2)',
                                  color: '#0f1115',
                                }
                              : { borderColor: 'var(--border)', color: 'var(--muted)' }
                          }
                          title={
                            auto.includes(v)
                              ? '自動判別で確定済みです（指定は不要）'
                              : `この投稿を${VENUE_LABEL[v]}のお品書きとして公開します`
                          }
                        >
                          {VENUE_LABEL[v]}
                          {auto.includes(v) && ' ✓自動'}
                        </button>
                      ))}
                      {c.boothIds.length > 0 && (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>
                          公式: {c.boothIds.join(' / ')}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* お品書きらしさの根拠 */}
              <p className="px-3 pt-1 text-xs" style={{ color: 'var(--muted)' }}>
                {c.post.matchedSignals.join(' , ')}
              </p>

              {c.post.text && (
                <p className="px-3 pt-2 text-sm whitespace-pre-wrap">{c.post.text}</p>
              )}

              {c.post.media.length > 0 && (
                <div className="scroll-x mt-2 flex gap-1 px-3 pb-1">
                  {c.post.media.map((m) => (
                    <a
                      key={m.baseUrl}
                      href={m.origUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0"
                      title="原寸で開く"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={m.largeUrl}
                        alt={m.altText ?? ''}
                        loading="lazy"
                        className="h-40 w-auto rounded-lg"
                        style={{ background: 'var(--surface2)' }}
                      />
                    </a>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  type="button"
                  onClick={() => void save(c.post.id, v === 'adopted' ? null : 'adopted')}
                  className="rounded-lg px-4 py-2 text-sm font-medium"
                  style={
                    v === 'adopted'
                      ? { background: 'var(--color-mm-accent)', color: '#0f1115' }
                      : { border: '1px solid var(--border)', color: 'var(--text)' }
                  }
                >
                  {v === 'adopted' ? '✓ 採用中' : '採用'}
                </button>
                <button
                  type="button"
                  onClick={() => void save(c.post.id, v === 'rejected' ? null : 'rejected')}
                  className="rounded-lg px-4 py-2 text-sm font-medium"
                  style={
                    v === 'rejected'
                      ? { background: '#7a3b3b', color: '#ffe6e6' }
                      : { border: '1px solid var(--border)', color: 'var(--muted)' }
                  }
                >
                  {v === 'rejected' ? '✕ 却下中' : '却下'}
                </button>
                <a
                  href={c.post.url}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto text-sm underline"
                  style={{ color: 'var(--color-mm-accent)' }}
                >
                  X で開く →
                </a>
              </div>
            </article>
          );
        })}

        {candidates.length > 0 && rows.length === 0 && (
          <p className="py-10 text-center text-sm" style={{ color: 'var(--muted)' }}>
            条件に合う候補がありません
          </p>
        )}
      </div>
    </main>
  );
}
