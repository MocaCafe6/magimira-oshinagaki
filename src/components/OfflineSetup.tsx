'use client';

/**
 * Service Worker の登録と「オフライン保存」。
 *
 * インテックス大阪・幕張メッセは会期中に回線が飽和する。
 * 事前に会場ぶんの画像とページをキャッシュへ入れておかないと、
 * 現地でお品書きを開けず道具として機能しない。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useFavorites } from '@/lib/use-favorites';
import { useReachability } from '@/lib/use-reachability';

type Progress = { done: number; failed: number; total: number } | null;

type Props = {
  /** 既定の保存対象（ページとサムネイル） */
  urls: string[];
  /** サークルごとの large 画像。お気に入りのぶんだけ追加で保存する */
  largeByCreator: Record<string, string[]>;
  venueLabel: string;
};

export function OfflineSetup({ urls, largeByCreator, venueLabel }: Props) {
  const [supported, setSupported] = useState(false);
  const [ready, setReady] = useState(false);
  const [progress, setProgress] = useState<Progress>(null);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { state: reach, recheck } = useReachability();
  const fav = useFavorites();

  // お気に入りに入れたサークルは、詳細ページと large 画像も保存する。
  // 会場で本当に開くのはここなので、お品書きの有無に関わらず対象にする。
  // 全サークルの large を入れると 30MB を超え、X 側にも弾かれるので入れない
  // （一覧のサムネイルは全件保存済み。詳細は通信できれば自動で読み込まれる）。
  const targets = useMemo(() => {
    const extra: string[] = [];
    for (const r of fav.records.values()) {
      if (!r.favorite && r.memo.trim() === '') continue;
      extra.push(`/creator/${encodeURIComponent(r.creatorId)}/`);
      for (const u of largeByCreator[r.creatorId] ?? []) extra.push(u);
    }
    return [...new Set([...urls, ...extra])];
  }, [urls, largeByCreator, fav.records]);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    setSupported(true);
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then(() => navigator.serviceWorker.ready)
      .then(() => setReady(true))
      .catch(() => setMessage('オフライン機能を有効にできませんでした'));
  }, []);

  /**
   * このページが動くのに実際に使っているファイルを集める。
   *
   * Service Worker は制御を握る前のリクエストを observe できないため、
   * 初回ロード時のチャンクはキャッシュに入っていない。ページ側は
   * 自分が何を読み込んだか正確に知っているので、そこから渡すのが確実。
   */
  const collectCriticalUrls = useCallback((): string[] => {
    const urls = new Set<string>();
    const sameOrigin = (u: string): boolean => {
      try {
        return new URL(u, location.href).origin === location.origin;
      } catch {
        return false;
      }
    };
    for (const el of document.querySelectorAll<HTMLScriptElement>('script[src]')) {
      if (sameOrigin(el.src)) urls.add(el.src);
    }
    for (const el of document.querySelectorAll<HTMLLinkElement>(
      'link[rel="stylesheet"], link[as="script"], link[as="style"], link[as="font"]',
    )) {
      if (el.href && sameOrigin(el.href)) urls.add(el.href);
    }
    // 実際に読み込まれたリソース（動的 import のチャンクも拾える）
    for (const e of performance.getEntriesByType('resource')) {
      const name = e.name;
      if (!sameOrigin(name)) continue;
      if (/\/_next\/.*\.(js|css|woff2?)$/.test(name)) urls.add(name);
    }
    return [...urls];
  }, []);

  const start = useCallback(() => {
    const sw = navigator.serviceWorker.controller;
    if (!sw) {
      setMessage('準備中です。数秒後にもう一度お試しください。');
      return;
    }
    setRunning(true);
    setMessage(null);
    setProgress({ done: 0, failed: 0, total: targets.length });

    const channel = new MessageChannel();
    channel.port1.onmessage = (e: MessageEvent) => {
      const data = e.data as {
        type: string;
        done: number;
        failed: number;
        total: number;
        failures?: { image: number; page: number; asset: number };
      };
      if (data.type === 'progress') {
        setProgress({ done: data.done, failed: data.failed, total: data.total });
      } else if (data.type === 'complete') {
        setProgress({ done: data.done, failed: data.failed, total: data.total });
        setRunning(false);
        if (data.failed === 0) {
          setMessage(`保存しました（${data.done}件）`);
        } else {
          // 画像が取れなくても代替表示に落ちるだけなので、深刻度を分けて伝える
          const f = data.failures;
          const detail = f
            ? `画像 ${f.image}件 / ページ ${f.page}件 / その他 ${f.asset}件`
            : `${data.failed}件`;
          setMessage(`保存しました（${data.done}件成功、取得できず: ${detail}）`);
        }
      }
    };
    sw.postMessage(
      { type: 'prefetch', criticalUrls: collectCriticalUrls(), urls: targets },
      [channel.port2],
    );
  }, [targets, collectCriticalUrls]);

  if (!supported) return null;

  const pct =
    progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  const offline = reach === 'offline';

  return (
    <section
      className="rounded-xl border p-3"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <h2 className="text-sm font-semibold">会場用にオフライン保存</h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
        会期中の会場は回線が非常に混雑します。{venueLabel}
        ぶんのお品書きと、お気に入りに入れたサークルのページを、
        あらかじめこの端末に保存しておけます。
        {targets.length > 0 &&
          `（ページと画像 ${targets.length}件。表示に必要なファイルも併せて保存します）`}
      </p>

      {offline && (
        <div
          className="mt-2 rounded-lg px-2 py-1.5 text-xs"
          style={{ background: 'var(--surface2)', color: 'var(--color-mm-accent2)' }}
          role="status"
        >
          通信できていません。保存済みの内容を表示しています。
          <button
            type="button"
            onClick={recheck}
            className="ml-2 underline"
            style={{ color: 'var(--color-mm-accent)' }}
          >
            再確認
          </button>
        </div>
      )}

      {progress && (
        <div className="mt-2">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--surface2)' }}
          >
            <div
              className="h-full rounded-full transition-[width]"
              style={{ width: `${pct}%`, background: 'var(--color-mm-accent)' }}
            />
          </div>
          <p className="mt-1 text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            {progress.done} / {progress.total}
            {progress.failed > 0 && ` （取得できず ${progress.failed}件）`}
          </p>
        </div>
      )}

      <button
        type="button"
        onClick={start}
        disabled={running || !ready || offline || targets.length === 0}
        className="mt-2 rounded-lg border px-3 py-2 text-sm disabled:opacity-40"
        style={{ borderColor: 'var(--border)' }}
      >
        {running ? '保存中…' : `${venueLabel}ぶんを保存`}
      </button>

      {message && (
        <p className="mt-2 text-xs" style={{ color: 'var(--color-mm-accent)' }}>
          {message}
        </p>
      )}
      <p className="mt-2 text-xs" style={{ color: 'var(--muted)' }}>
        保存先はこの端末のブラウザキャッシュです。画像は X のサーバから取得し、
        当サイトでは保持していません。
      </p>
    </section>
  );
}
