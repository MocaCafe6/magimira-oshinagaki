import type { NextConfig } from 'next';

/**
 * 静的エクスポート構成。
 * 成果物は out/ に出るので、wrangler pages deploy / vercel deploy /
 * 任意の静的ホスティングにそのまま置ける（git 不要）。
 */
/**
 * admin 画面をビルド対象から外す仕組み。
 *
 * ページを `page.admin.tsx` と命名し、pageExtensions に `admin.tsx` を
 * 含めるかどうかで出力を切り替える。公開ビルドでは Next がそのファイルを
 * ページとして認識しないため、HTML もクライアント JS チャンクも一切生成されない。
 *
 * 実行時に notFound() で弾く方式では、HTML は 404 になってもクライアント
 * チャンクは出荷されてしまう（localhost の管理APIのURLが公開成果物に混ざる）。
 */
const isAdminBuild = process.env.NEXT_PUBLIC_ADMIN === '1';

const nextConfig: NextConfig = {
  output: 'export',
  pageExtensions: isAdminBuild ? ['admin.tsx', 'tsx', 'ts'] : ['tsx', 'ts'],
  // 画像は pbs.twimg.com を直接参照する。自サーバに再ホストしないため
  // Next.js の最適化は使わない（静的エクスポートでは動かない）。
  images: { unoptimized: true },
  // 静的ホスティングで /creator/xxx が 404 にならないようにする
  trailingSlash: true,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
