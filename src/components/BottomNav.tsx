'use client';

/**
 * 下部ナビゲーション。
 * 会場で片手で回すため、主要な移動は画面下に置く。
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/', label: '一覧', icon: '☰' },
  { href: '/items/', label: 'グッズ', icon: '🏷' },
  { href: '/map/', label: 'マップ', icon: '🗺' },
  { href: '/favorites/', label: 'お気に入り', icon: '★' },
] as const;

export function BottomNav() {
  const pathname = usePathname() ?? '/';

  // 管理画面（ローカル専用）では出さない。
  // 閲覧者向けの導線ではないし、レビューは縦に長いので画面を潰したくない。
  if (pathname.startsWith('/admin')) return null;

  const isActive = (href: string): boolean => {
    if (href === '/') return pathname === '/' || pathname.startsWith('/creator');
    return pathname.startsWith(href.replace(/\/$/, ''));
  };

  return (
    <nav
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur"
      style={{
        borderColor: 'var(--border)',
        background: 'color-mix(in srgb, var(--surface) 88%, transparent)',
      }}
      aria-label="メインナビゲーション"
    >
      <ul className="mx-auto flex max-w-3xl">
        {TABS.map((t) => {
          const active = isActive(t.href);
          return (
            <li key={t.href} className="flex-1">
              <Link
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className="flex flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors"
                style={{ color: active ? 'var(--color-mm-accent)' : 'var(--muted)' }}
              >
                <span aria-hidden className="text-lg leading-none">
                  {t.icon}
                </span>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
