'use client';

/**
 * 原寸お品書きビューア。
 * 小さな文字を読む必要があるので name=orig を読み、ピンチズームを許可する。
 * 開くまでは読み込まない（会場の細い回線で無駄に転送しないため）。
 */

import { useCallback, useEffect, useState } from 'react';

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
  const [failed, setFailed] = useState(false);
  const image = images[index];

  const go = useCallback(
    (delta: number) => {
      const next = index + delta;
      if (next < 0 || next >= images.length) return;
      setLoaded(false);
      setFailed(false);
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

  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/95"
      role="dialog"
      aria-modal="true"
      aria-label="お品書き原寸表示"
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
        <div className="flex items-center gap-3">
          <a href={image.postUrl} target="_blank" rel="noreferrer" className="underline">
            元投稿を開く
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

      <div className="zoomable relative flex-1 overflow-auto">
        {!loaded && !failed && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">
            原寸画像を読み込み中…
          </div>
        )}
        {failed ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white/80">
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
            className="mx-auto block h-auto w-full max-w-none"
            style={{ opacity: loaded ? 1 : 0, transition: 'opacity 150ms' }}
          />
        )}
      </div>

      {images.length > 1 && (
        <div className="flex justify-between gap-2 p-3">
          <button
            type="button"
            onClick={() => go(-1)}
            disabled={index === 0}
            className="rounded-lg bg-white/15 px-5 py-3 text-white disabled:opacity-30"
          >
            ← 前
          </button>
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
