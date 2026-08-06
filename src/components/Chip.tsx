'use client';

type Props = {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  /** 押されたときの色。既定はミクカラー */
  accent?: string;
  title?: string;
};

/** フィルタ用のトグルチップ。指で押しやすい高さを確保する */
export function Chip({ active, onClick, children, accent, title }: Props) {
  const color = accent ?? 'var(--color-mm-accent)';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className="shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors"
      style={
        active
          ? { borderColor: color, background: color, color: '#0f1115' }
          : { borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--muted)' }
      }
    >
      {children}
    </button>
  );
}
