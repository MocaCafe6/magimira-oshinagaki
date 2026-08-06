/**
 * X のブラウザセッション管理。
 * x-login.ts と crawl-x.ts で共有する。
 */

import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';

import { SECRETS_DIR } from './io';

export const STORAGE_STATE_PATH = resolve(SECRETS_DIR, 'x-storage-state.json');

/** ログイン画面・フロー画面のURLパターン */
const LOGIN_URL_RE = /x\.com\/(login|i\/flow\/)/;

/**
 * ログイン済みかを判定する。
 * DOM のクラス名は難読化されて変わるので、まず auth_token Cookie を見る。
 */
export async function isLoggedIn(page: Page): Promise<boolean> {
  const cookies = await page.context().cookies('https://x.com');
  const hasAuth = cookies.some((c) => c.name === 'auth_token' && c.value.length > 0);
  if (!hasAuth) return false;
  // Cookie があってもログインフロー中の可能性があるので URL も見る
  return !LOGIN_URL_RE.test(page.url());
}

/** ログイン画面にリダイレクトされた＝セッション切れ */
export function looksLoggedOut(url: string): boolean {
  return LOGIN_URL_RE.test(url);
}

export async function hasSavedSession(): Promise<boolean> {
  try {
    await access(STORAGE_STATE_PATH);
    return true;
  } catch {
    return false;
  }
}

export class SessionMissingError extends Error {
  constructor() {
    super(
      'X のログインセッションが見つかりません。先に `npm run x-login` を実行してください。\n' +
        `  期待するパス: ${STORAGE_STATE_PATH}`,
    );
    this.name = 'SessionMissingError';
  }
}

export class SessionExpiredError extends Error {
  constructor() {
    super(
      'X のログインセッションが切れています（ログイン画面にリダイレクトされました）。\n' +
        '  `npm run x-login` を再実行してセッションを更新してください。',
    );
    this.name = 'SessionExpiredError';
  }
}

/** 保存済みセッションを読み込んだコンテキストを作る */
export async function createLoggedInContext(browser: Browser): Promise<BrowserContext> {
  if (!(await hasSavedSession())) throw new SessionMissingError();
  return await browser.newContext({
    storageState: STORAGE_STATE_PATH,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    viewport: { width: 1280, height: 1200 },
    // 画像・動画・フォントを読まない。表示は不要で、必要なのは GraphQL の JSON だけ。
    // 転送量とレート消費を大幅に削減できる。
    serviceWorkers: 'block',
  });
}

/** 画像・メディア・フォントのリクエストを落とす */
export async function blockHeavyResources(context: BrowserContext): Promise<void> {
  await context.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'media' || type === 'font') {
      return route.abort();
    }
    return route.continue();
  });
}
