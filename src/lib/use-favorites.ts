'use client';

/**
 * お気に入り／メモ／訪問済みを React から扱うフック。
 *
 * 状態はモジュールレベルで共有する。
 * useState を各コンポーネントに持たせると、一覧で付けたお気に入りが
 * 同じ画面の別コンポーネント（オフライン保存など）に伝わらない。
 * useSyncExternalStore で単一のスナップショットを購読する形にしている。
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';

import {
  getStore,
  itemFavoriteKey,
  type FavoriteRecord,
  type ItemFavoriteRecord,
} from './store';

type Snapshot = {
  ready: boolean;
  records: Map<string, FavoriteRecord>;
  itemKeys: Set<string>;
};

const EMPTY: Snapshot = { ready: false, records: new Map(), itemKeys: new Set() };

let snapshot: Snapshot = EMPTY;
const listeners = new Set<() => void>();
let loadStarted = false;

function emit(): void {
  for (const l of listeners) l();
}

function setSnapshot(next: Snapshot): void {
  snapshot = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // 最初の購読でだけ初期読み込みとタブ復帰の監視を仕込む
  if (!loadStarted) {
    loadStarted = true;
    void reload();
    // 別タブ（PC で下調べ → 別タブで確認）での変更を拾う
    window.addEventListener('focus', () => void reload());
  }
  return () => listeners.delete(listener);
}

function getSnapshot(): Snapshot {
  return snapshot;
}

/** SSR/ビルド時は IndexedDB が無いので空を返す */
function getServerSnapshot(): Snapshot {
  return EMPTY;
}

export async function reload(): Promise<void> {
  const store = getStore();
  const [favs, items] = await Promise.all([store.getAll(), store.getItemFavorites()]);
  setSnapshot({
    ready: true,
    records: new Map(favs.map((f) => [f.creatorId, f])),
    itemKeys: new Set(items.map((i) => i.key)),
  });
}

/** 画面を即座に反応させるため、保存を待たずにスナップショットを更新する */
function patchRecord(creatorId: string, mutate: (r: FavoriteRecord) => void): void {
  const records = new Map(snapshot.records);
  const cur = records.get(creatorId);
  const next: FavoriteRecord = {
    creatorId,
    favorite: cur?.favorite ?? false,
    memo: cur?.memo ?? '',
    visited: cur?.visited ?? false,
    routeOrder: cur?.routeOrder ?? null,
    updatedAt: new Date().toISOString(),
  };
  mutate(next);
  records.set(creatorId, next);
  setSnapshot({ ...snapshot, records });
}

export type FavoritesApi = {
  ready: boolean;
  records: Map<string, FavoriteRecord>;
  itemKeys: Set<string>;
  isFavorite(creatorId: string): boolean;
  isVisited(creatorId: string): boolean;
  memoOf(creatorId: string): string;
  favoriteCount: number;
  toggleFavorite(creatorId: string): void;
  setMemo(creatorId: string, memo: string): void;
  setVisited(creatorId: string, visited: boolean): void;
  isItemFavorite(postId: string, mediaIndex: number, itemIndex: number): boolean;
  toggleItemFavorite(rec: {
    creatorId: string;
    postId: string;
    mediaIndex: number;
    itemIndex: number;
    itemName: string;
  }): void;
  reload(): void;
};

export function useFavorites(): FavoritesApi {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggleFavorite = useCallback((creatorId: string) => {
    patchRecord(creatorId, (r) => {
      r.favorite = !(snapshot.records.get(creatorId)?.favorite ?? false);
    });
    void getStore().toggleFavorite(creatorId);
  }, []);

  const setMemo = useCallback((creatorId: string, memo: string) => {
    patchRecord(creatorId, (r) => {
      r.memo = memo;
    });
    void getStore().setMemo(creatorId, memo);
  }, []);

  const setVisited = useCallback((creatorId: string, visited: boolean) => {
    patchRecord(creatorId, (r) => {
      r.visited = visited;
    });
    void getStore().setVisited(creatorId, visited);
  }, []);

  const toggleItemFavorite = useCallback(
    (rec: {
      creatorId: string;
      postId: string;
      mediaIndex: number;
      itemIndex: number;
      itemName: string;
    }) => {
      const key = itemFavoriteKey(rec.postId, rec.mediaIndex, rec.itemIndex);
      const itemKeys = new Set(snapshot.itemKeys);
      if (itemKeys.has(key)) itemKeys.delete(key);
      else itemKeys.add(key);
      setSnapshot({ ...snapshot, itemKeys });

      const full: Omit<ItemFavoriteRecord, 'updatedAt'> = { key, ...rec };
      void getStore().toggleItemFavorite(full);
    },
    [],
  );

  const favoriteCount = useMemo(
    () => [...snap.records.values()].filter((r) => r.favorite).length,
    [snap.records],
  );

  return {
    ready: snap.ready,
    records: snap.records,
    itemKeys: snap.itemKeys,
    isFavorite: (id) => snap.records.get(id)?.favorite ?? false,
    isVisited: (id) => snap.records.get(id)?.visited ?? false,
    memoOf: (id) => snap.records.get(id)?.memo ?? '',
    favoriteCount,
    toggleFavorite,
    setMemo,
    setVisited,
    isItemFavorite: (postId, mediaIndex, itemIndex) =>
      snap.itemKeys.has(itemFavoriteKey(postId, mediaIndex, itemIndex)),
    toggleItemFavorite,
    reload: () => void reload(),
  };
}
