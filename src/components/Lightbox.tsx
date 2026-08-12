'use client';

/**
 * 原寸お品書きビューア。
 * 小さな文字を読む必要があるので name=orig を読み、ピンチズームを許可する。
 * 開くまでは読み込まない（会場の細い回線で無駄に転送しないため）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type LightboxImage = {
  origUrl: string;
  largeUrl: string;
  altText: string | null;
  width: number;
  height: number;
  /** 元投稿へのリンク */
  postUrl: string;
};

type Props = {
  images: LightboxImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (i: number) => void;
};

export function Lightbox({ images, index, onClose, onIndexChange }: Props) {
  const [loaded, setLoaded] = useState(false);
  // 既定は画面に収める。原寸のまま横幅いっぱいに出すと、縦長のお品書きは
  // 一部しか見えず「デカすぎて読めない」状態になる。タップで原寸に切り替える。
  const [fit, setFit] = useState(true);
  const [failed, setFailed] = useState(false);
  const image = images[index];

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= images.length) return;
      setLoaded(false);
      setFailed(false);
      setFit(true);
      onIndexChange(next);
    },
    [index, images.length, onIndexChange],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    // 背面のスクロールを止める
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [go, onClose]);

  // 横スワイプで前後に移動する。スマホで「次へ」を押すのは面倒。
  //
  // 原寸表示（fit=false）のときはスワイプを取らない。横スクロールで
  // 画像の端を読んでいる最中に勝手に次へ行ってしまうため。
  const touch = useRef<{ x: number; y: number; t: number } | null>(null);
  const SWIPE_MIN_PX = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0]!;
    touch.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start || !fit) return;
    const t = e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 縦方向のほうが大きい動きは（閉じる意図やスクロール）スワイプにしない
    if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    go(dx < 0 ? 1 : -1);
  };

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="お品書き原寸表示"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <div className="flex items-center justify-between gap-2 p-3 text-sm text-white">
        <span className="tabular-nums">
          {index + 1} / {images.length}
          {image.width > 0 && (
            <span className="ml-2 opacity-60">
              {image.width}×{image.height}
            </span>
          )}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setFit((v) => !v)}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm"
          >
            {fit ? '⤢ 原寸' : '⤡ 全体'}
          </button>
          {/* 保存ボタン。スマホなら長押しでも保存できるが、
              明示的にあったほうが分かりやすい。pbs.twimg.com は別オリジンなので
              download 属性が効かない環境があり、その場合は画像単体で開く。 */}
          <a
            href={image.origUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm"
          >
            ⬇ 保存
          </a>
          <a
            href={image.postUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-white/15 px-3 py-1.5 text-sm"
          >
            元投稿
          </a>
          <button
            type="button"
            onClick={onClose}
            className="flex size-9 items-center justify-center rounded-full bg-white/15 text-lg"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 画像の外側をタップしたら閉じる。
          画像そのもののタップは原寸切替に使うので、img 側で伝播を止める。 */}
      <div
        className={`zoomable relative flex-1 ${fit ? 'flex items-center justify-center overflow-hidden' : 'overflow-auto'}`}
        onClick={onClose}
      >
        {!loaded && !failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            原寸画像を読み込み中…
          </div>
        )}
        {failed ? (
          <div
            className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/80"
            onClick={(e) => e.stopPropagation()}
          >
            <p>原寸画像を読み込めませんでした。</p>
            {image.altText && <p className="text-white/60">{image.altText}</p>}
            <p className="text-white/60">
              クリエイターが投稿を削除した可能性があります。
              <br />
              画像は X のサーバから直接読み込んでいるため、
              <br />
              元投稿が消えると表示できません。
            </p>
            <a href={image.postUrl} target="_blank" rel="noreferrer" className="underline">
              X で確認する →
            </a>
          </div>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            key={image.origUrl}
            src={image.origUrl}
            alt={image.altText ?? 'お品書き'}
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            onClick={(e) => {
              e.stopPropagation(); // 枠外タップの「閉じる」と混ざらないようにする
              setFit((v) => !v);
            }}
            className={
              fit
                ? 'mx-auto block max-h-full max-w-full object-contain'
                : 'mx-auto block h-auto w-full max-w-none'
            }
            style={{
              opacity: loaded ? 1 : 0,
              transition: 'opacity 150ms',
              cursor: fit ? 'zoom-in' : 'zoom-out',
            }}
          />
        )}
      </div>

      {images.length > 1 && (
        <div className="flex items-center justify-between gap-2 p-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="rounded-lg bg-white/15 px-5 py-3 text-white disabled:opacity-30"
          >
            ← 前
          </button>
          <span className="text-xs text-white/50">横にスワイプでも移動できます</span>
          <button
            type="button"
            onClick={() => go(1)}
            disabled={index === images.length - 1}
            className="rounded-lg bg-white/15 px-5 py-3 text-white disabled:opacity-30"
          >
            次 →
          </button>
        </div>
      )}
    </div>
  );
}
