'use client';

/**
 * お気に入り・メモ・訪問済みの保存層。
 *
 * 実装は IndexedDB(Dexie) だが、インターフェースを切ってあるので
 * 東京（8/28）までにクラウド同期実装へ差し替えられる。
 * 呼び出し側は FavoriteStore だけを見る。
 */

import Dexie, { type Table } from 'dexie';

export type FavoriteRecord = {
  /** creator id */
  creatorId: string;
  favorite: boolean;
  memo: string;
  visited: boolean;
  /** 周回ルートの手動並べ替え順。未設定は null */
  routeOrder: number | null;
  updatedAt: string;
};

export type ItemFavoriteRecord = {
  /** `${postId}:${mediaIndex}:${itemIndex}` */
  key: string;
  creatorId: string;
  postId: string;
  mediaIndex: number;
  itemIndex: number;
  itemName: string;
  updatedAt: string;
};

export type ExportPayload = {
  version: 1;
  exportedAt: string;
  favorites: FavoriteRecord[];
  itemFavorites: ItemFavoriteRecord[];
};

export interface FavoriteStore {
  getAll(): Promise<FavoriteRecord[]>;
  get(creatorId: string): Promise<FavoriteRecord | undefined>;
  toggleFavorite(creatorId: string): Promise<boolean>;
  setMemo(creatorId: string, memo: string): Promise<void>;
  setVisited(creatorId: string, visited: boolean): Promise<void>;
  setRouteOrder(creatorId: string, order: number | null): Promise<void>;

  getItemFavorites(): Promise<ItemFavoriteRecord[]>;
  toggleItemFavorite(rec: Omit<ItemFavoriteRecord, 'updatedAt'>): Promise<boolean>;

  exportJson(): Promise<string>;
  importJson(json: string, mode: 'merge' | 'replace'): Promise<{ favorites: number; items: number }>;
  clear(): Promise<void>;
}

class OshinagakiDb extends Dexie {
  favorites!: Table<FavoriteRecord, string>;
  itemFavorites!: Table<ItemFavoriteRecord, string>;

  constructor() {
    super('magimira-oshinagaki');
    this.version(1).stores({
      favorites: 'creatorId, favorite, visited',
      itemFavorites: 'key, creatorId, postId',
    });
  }
}

function now(): string {
  return new Date().toISOString();
}

function emptyRecord(creatorId: string): FavoriteRecord {
  return {
    creatorId,
    favorite: false,
    memo: '',
    visited: false,
    routeOrder: null,
    updatedAt: now(),
  };
}

/** 中身が空になったレコードは残さない（エクスポートを軽く保つ） */
function isEmpty(r: FavoriteRecord): boolean {
  return !r.favorite && r.memo.trim() === '' && !r.visited && r.routeOrder === null;
}

class DexieFavoriteStore implements FavoriteStore {
  private db = new OshinagakiDb();

  async getAll(): Promise<FavoriteRecord[]> {
    return await this.db.favorites.toArray();
  }

  async get(creatorId: string): Promise<FavoriteRecord | undefined> {
    return await this.db.favorites.get(creatorId);
  }

  private async update(
    creatorId: string,
    mutate: (r: FavoriteRecord) => void,
  ): Promise<FavoriteRecord> {
    const rec = (await this.db.favorites.get(creatorId)) ?? emptyRecord(creatorId);
    mutate(rec);
    rec.updatedAt = now();
    if (isEmpty(rec)) {
      await this.db.favorites.delete(creatorId);
    } else {
      await this.db.favorites.put(rec);
    }
    return rec;
  }

  async toggleFavorite(creatorId: string): Promise<boolean> {
    const rec = await this.update(creatorId, (r) => {
      r.favorite = !r.favorite;
    });
    return rec.favorite;
  }

  async setMemo(creatorId: string, memo: string): Promise<void> {
    await this.update(creatorId, (r) => {
      r.memo = memo;
    });
  }

  async setVisited(creatorId: string, visited: boolean): Promise<void> {
    await this.update(creatorId, (r) => {
      r.visited = visited;
    });
  }

  async setRouteOrder(creatorId: string, order: number | null): Promise<void> {
    await this.update(creatorId, (r) => {
      r.routeOrder = order;
    });
  }

  async getItemFavorites(): Promise<ItemFavoriteRecord[]> {
    return await this.db.itemFavorites.toArray();
  }

  async toggleItemFavorite(rec: Omit<ItemFavoriteRecord, 'updatedAt'>): Promise<boolean> {
    const existing = await this.db.itemFavorites.get(rec.key);
    if (existing) {
      await this.db.itemFavorites.delete(rec.key);
      return false;
    }
    await this.db.itemFavorites.put({ ...rec, updatedAt: now() });
    return true;
  }

  async exportJson(): Promise<string> {
    const payload: ExportPayload = {
      version: 1,
      exportedAt: now(),
      favorites: await this.getAll(),
      itemFavorites: await this.getItemFavorites(),
    };
    return JSON.stringify(payload, null, 2);
  }

  async importJson(
    json: string,
    mode: 'merge' | 'replace',
  ): Promise<{ favorites: number; items: number }> {
    const parsed = JSON.parse(json) as unknown;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (parsed as ExportPayload).version !== 1
    ) {
      throw new Error('対応していない形式です（version 1 の JSON を読み込んでください）');
    }
    const payload = parsed as ExportPayload;
    const favorites = Array.isArray(payload.favorites) ? payload.favorites : [];
    const items = Array.isArray(payload.itemFavorites) ? payload.itemFavorites : [];

    if (mode === 'replace') {
      await this.db.favorites.clear();
      await this.db.itemFavorites.clear();
      await this.db.favorites.bulkPut(favorites);
      await this.db.itemFavorites.bulkPut(items);
      return { favorites: favorites.length, items: items.length };
    }

    // merge: updatedAt が新しい方を採用する
    for (const incoming of favorites) {
      const existing = await this.db.favorites.get(incoming.creatorId);
      if (!existing || incoming.updatedAt > existing.updatedAt) {
        await this.db.favorites.put(incoming);
      }
    }
    for (const incoming of items) {
      const existing = await this.db.itemFavorites.get(incoming.key);
      if (!existing || incoming.updatedAt > existing.updatedAt) {
        await this.db.itemFavorites.put(incoming);
      }
    }
    return { favorites: favorites.length, items: items.length };
  }

  async clear(): Promise<void> {
    await this.db.favorites.clear();
    await this.db.itemFavorites.clear();
  }
}

let singleton: FavoriteStore | null = null;

/** ブラウザ側でのみ使う。SSR/ビルド時に呼ぶと IndexedDB が無くて落ちる */
export function getStore(): FavoriteStore {
  if (typeof window === 'undefined') {
    throw new Error('getStore() はブラウザでのみ呼べます');
  }
  singleton ??= new DexieFavoriteStore();
  return singleton;
}

export function itemFavoriteKey(postId: string, mediaIndex: number, itemIndex: number): string {
  return `${postId}:${mediaIndex}:${itemIndex}`;
}
