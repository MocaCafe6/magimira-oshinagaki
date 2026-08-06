import type { Metadata, Viewport } from 'next';

import './globals.css';
import { BottomNav } from '@/components/BottomNav';

export const metadata: Metadata = {
  title: 'マジミラお品書き一覧',
  description:
    'マジカルミライ2026 クリエイターズマーケットのお品書きを一覧で確認し、お気に入りとメモを残せる非公式ツールです。',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'お品書き一覧' },
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 原寸のお品書きを読むためピンチズームを許可する
  maximumScale: 5,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
    { media: '(prefers-color-scheme: light)', color: '#f6f7f9' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-dvh antialiased">
        {/* 下部ナビのぶんだけ本文に余白を取る */}
        <div className="pb-24">{children}</div>
        <BottomNav />
      </body>
    </html>
  );
}
