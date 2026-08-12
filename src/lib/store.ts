'use client';

/**
 * お気に入り・メモ・訪問済みの保存層。
 *
 * 実装は IndexedDB(Dexie) だが、インターフェースを切ってあるので
 * 東京（8/28）までにクラウド同期実装へ差し替えられる。
 * 呼び出し側は FavoriteStore だけを見る。
 */

import Dexie, { type Table } from 'dexie';

/**
 * そのサークルをどうしたか。
 * 会場を回りながら「買った／見送った」を潰していくために使う。
 */
export type PurchaseStatus = 'none' | 'bought' | 'skipped';

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  none: '未購入',
  bought: '購入済み',
  skipped: '見送り',
};

/**
 * 優先度の色。マップ上のピンとリストの番号に付く。
 *
 * 「絶対に買う」「余裕があれば」を色で分けたいという要望から。
 * 番号だけだと回る順しか分からず、優先度が読み取れない。
 */
export type PriorityColor = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple';

export const PRIORITY_COLORS: { value: PriorityColor; label: string; hex: string }[] = [
  { value: 'none', label: '色なし', hex: '#7fd3e8' },
  { value: 'red', label: '最優先', hex: '#ff5470' },
  { value: 'orange', label: '高', hex: '#ff9f45' },
  { value: 'yellow', label: '中', hex: '#ffdd55' },
  { value: 'green', label: '低', hex: '#5ad48a' },
  { value: 'blue', label: '保留', hex: '#5aa9ff' },
  { value: 'purple', label: 'その他', hex: '#c07fff' },
];

export const PRIORITY_HEX: Record<PriorityColor, string> = Object.fromEntries(
  PRIORITY_COLORS.map((c) => [c.value, c.hex]),
) as Record<PriorityColor, string>;

export type FavoriteRecord = {
  /** creator id */
  creatorId: string;
  favorite: boolean;
  memo: string;
  visited: boolean;
  /** 購入状況。既存データには無いので読み出し側で 'none' に倒す */
  status?: PurchaseStatus;
  /** 周回ルートの手動並べ替え順。未設定は null */
  routeOrder: number | null;
  /** 優先度の色。既存データには無いので読み出し側で 'none' に倒す */
  color?: PriorityColor;
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
  setStatus(creatorId: string, status: PurchaseStatus): Promise<void>;
  setRouteOrder(creatorId: string, order: number | null): Promise<void>;
  setColor(creatorId: string, color: PriorityColor): Promise<void>;

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
    // 購入状況を追加。既存レコードは status 未設定のままでよく、
    // 読み出し側で 'none' に倒すので移行処理は要らない。
    this.version(2).stores({
      favorites: 'creatorId, favorite, visited, status',
      itemFavorites: 'key, creatorId, postId',
    });
    // 優先度の色を追加。既存レコードは color 未設定のままでよく、
    // 読み出し側で 'none' に倒すので移行処理は要らない。
    this.version(3).stores({
      favorites: 'creatorId, favorite, visited, status, color',
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
    status: 'none',
    routeOrder: null,
    color: 'none',
    updatedAt: now(),
  };
}

/** 中身が空になったレコードは残さない（エクスポートを軽く保つ） */
function isEmpty(r: FavoriteRecord): boolean {
  return (
    !r.favorite &&
    r.memo.trim() === '' &&
    !r.visited &&
    (r.status ?? 'none') === 'none' &&
    r.routeOrder === null &&
    (r.color ?? 'none') === 'none'
  );
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

  async setStatus(creatorId: string, status: PurchaseStatus): Promise<void> {
    await this.update(creatorId, (r) => {
      r.status = status;
      // 買った・見送ったなら、その場所はもう回り終えている
      if (status !== 'none') r.visited = true;
    });
  }

  async setRouteOrder(creatorId: string, order: number | null): Promise<void> {
    await this.update(creatorId, (r) => {
      r.routeOrder = order;
    });
  }

  async setColor(creatorId: string, color: PriorityColor): Promise<void> {
    await this.update(creatorId, (r) => {
      r.color = color;
      // 色を付けるのは「回る対象として意識している」ということなので
      // お気に入りにも入れる。マップから消えると意味がない。
      if (color !== 'none') r.favorite = true;
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
