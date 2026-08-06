/** data/ ディレクトリへの読み書きヘルパー。 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROJECT_ROOT = resolve(HERE, '..', '..');
export const DATA_DIR = resolve(PROJECT_ROOT, 'data');
export const SECRETS_DIR = resolve(PROJECT_ROOT, 'secrets');

export function dataPath(...parts: string[]): string {
  return resolve(DATA_DIR, ...parts);
}

/** JSON を整形して書き出す。ディレクトリが無ければ作る。 */
export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** JSON を読む。存在しなければ fallback を返す。 */
export async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

/** 公式サイトを取得する。UA を明示し、失敗時は即座に落とす。 */
export async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36',
      'accept-language': 'ja,en;q=0.8',
    },
  });
  if (!res.ok) {
    throw new Error(`取得失敗 ${res.status} ${res.statusText}: ${url}`);
  }
  return await res.text();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 3〜6秒のようなレンジからジッタ付きの待ち時間を作る */
export function jitter(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}
