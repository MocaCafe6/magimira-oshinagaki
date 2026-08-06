'use client';

/**
 * お品書き画像のサムネイル。
 *
 * 画像は自サーバに再ホストせず pbs.twimg.com を直接参照している。
 * つまりクリエイターが投稿を削除すれば画像も消える（意図した挙動）。
 * そのときレイアウトが潰れないよう、比率を確保して明示的な代替表示を出す。
 */

import { useState } from 'react';

type Props = {
  src: string;
  alt: string | null;
  /** 元画像の比率を保つために使う。0 のときは正方形にする */
  width: number;
  height: number;
  postUrl: string;
  onOpen?: () => void;
};

export function OshinagakiImage({ src, alt, width, height, postUrl, onOpen }: Props) {
  const [state, setState] = useState<'loading' | 'loaded' | 'error'>('loading');

  const ratio = width > 0 && height > 0 ? `${width} / ${height}` : '1 / 1';

  if (state === 'error') {
    return (
      <div
        className="flex flex-col items-center justify-center gap-1.5 rounded-lg p-3 text-center"
        style={{ aspectRatio: ratio, background: 'var(--surface2)' }}
      >
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          画像を読み込めませんでした
        </p>
        {alt && (
          <p className="line-clamp-3 text-xs" style={{ color: 'var(--muted)' }}>
            {alt}
          </p>
        )}
        <a
          href={postUrl}
          target="_blank"
          rel="noreferrer"
          className="text-xs underline"
          style={{ color: 'var(--color-mm-accent)' }}
          onClick={(e) => e.stopPropagation()}
        >
          X で確認 →
        </a>
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          投稿が削除された可能性があります
        </p>
      </div>
    );
  }

  const img = (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={src}
      alt={alt ?? 'お品書き'}
      loading="lazy"
      decoding="async"
      onLoad={() => setState('loaded')}
      onError={() => setState('error')}
      className="block w-full rounded-lg"
      style={{
        aspectRatio: state === 'loaded' ? undefined : ratio,
        objectFit: 'cover',
        background: 'var(--surface2)',
      }}
    />
  );

  if (!onOpen) return img;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full overflow-hidden rounded-lg"
      aria-label="お品書きを原寸で表示"
    >
      {img}
    </button>
  );
}
