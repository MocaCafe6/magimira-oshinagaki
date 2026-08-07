'use client';

import { useState } from 'react';

type Props = {
  /** 共有する相対パス（例: /creator/osaka-A-1/） */
  path: string;
  title: string;
  /** 共有シートに載せる一言 */
  text?: string;
  className?: string;
  /** アイコンだけにする（一覧のカードなど、幅が取れない場所用） */
  compact?: boolean;
};

/**
 * サークルのページを友達に送るためのボタン。
 *
 * スマホでは OS の共有シート（Web Share API）を開く。
 * 対応していない環境ではクリップボードにコピーする。
 * どちらも使えない場合に備えて、最後は入力欄を出して手で選べるようにする。
 */
export function ShareButton({ path, title, text, className, compact }: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle');
  const [url, setUrl] = useState('');

  const share = async () => {
    const full = new URL(path, window.location.origin).toString();
    setUrl(full);

    if (navigator.share) {
      try {
        await navigator.share({ title, text: text ?? title, url: full });
        return;
      } catch (e) {
        // ユーザーが共有シートを閉じただけなら何もしない
        if ((e as Error).name === 'AbortError') return;
      }
    }

    try {
      await navigator.clipboard.writeText(full);
      setState('copied');
      setTimeout(() => setState('idle'), 2000);
    } catch {
      // クリップボードが使えない（HTTP など）ときは手で選んでもらう
      setState('manual');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={share}
        className={className ?? 'rounded-lg border px-3 py-2 text-sm'}
        style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        aria-label={`${title} のURLを共有`}
      >
        {compact ? (state === 'copied' ? '✓' : '🔗') : state === 'copied' ? '✓ コピーしました' : '🔗 共有'}
      </button>

      {state === 'manual' && (
        <input
          type="text"
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="mt-1 w-full rounded border px-2 py-1 text-xs"
          style={{ borderColor: 'var(--border)', background: 'var(--bg)', color: 'var(--text)' }}
        />
      )}
    </>
  );
}
