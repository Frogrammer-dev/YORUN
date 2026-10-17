// DraftRepository (5.1, 8.3): 기기 내 보관·복원. 기한 없이 사용자가 지우거나 로그아웃할 때까지 남는다.
// 원 위치를 제외한 정규화 작품과 배치만 저장한다. 원본 XML·위경도·점별 시간·파일명은 저장하지 않는다.
// IndexedDB를 쓸 수 없으면 실패를 그대로 알리며, 저장된 것처럼 표시하지 않는다.

import type { Theme } from "@/lib/contracts/limits";
import type { ArtworkView, RoomItem } from "@/lib/contracts/types";

const DB_NAME = "runcanvas";
const STORE = "drafts";
const GUEST_KEY = "guest";

export interface GuestDraft {
  draftId: string;
  createdAt: number;
  theme: Theme;
  items: RoomItem[];
  /** geometry·clientRequestId를 포함한 로컬 작품 (기준 위치 없는 상대 형상). */
  artworks: ArtworkView[];
}

export interface AccountRoomDraft {
  userId: string;
  roomId: string;
  baseRevision: number;
  theme: Theme;
  items: RoomItem[];
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("indexeddb_unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error("indexeddb_tx_failed"));
      t.onabort = () => reject(t.error ?? new Error("indexeddb_tx_aborted"));
    });
  } finally {
    db.close();
  }
}

/** 로컬 작품에서 저장 가능한 필드만 남긴다(방어적 화이트리스트). */
function sanitizeArtwork(a: ArtworkView): ArtworkView {
  return {
    id: a.id,
    title: a.title,
    sourceKind: a.sourceKind,
    revision: a.revision,
    stats: { ...a.stats },
    renderLines: a.renderLines,
    renderPointCount: a.renderPointCount,
    geometry: a.geometry,
    clientRequestId: a.clientRequestId,
  };
}

export const DraftRepository = {
  async saveGuest(d: Omit<GuestDraft, "createdAt"> & { createdAt?: number }): Promise<void> {
    const createdAt = d.createdAt ?? Date.now();
    const value: GuestDraft = {
      draftId: d.draftId,
      createdAt,
      theme: d.theme,
      items: d.items,
      artworks: d.artworks.map(sanitizeArtwork),
    };
    await tx("readwrite", (s) => s.put(value, GUEST_KEY));
  },

  async loadGuest(): Promise<GuestDraft | null> {
    return (await tx<GuestDraft>("readonly", (s) => s.get(GUEST_KEY))) ?? null;
  },

  async clearGuest(): Promise<void> {
    await tx("readwrite", (s) => s.delete(GUEST_KEY));
  },

  async saveAccountRoom(d: AccountRoomDraft): Promise<void> {
    await tx("readwrite", (s) => s.put(d, `room:${d.userId}`));
  },

  async loadAccountRoom(userId: string): Promise<AccountRoomDraft | null> {
    return (await tx<AccountRoomDraft>("readonly", (s) => s.get(`room:${userId}`))) ?? null;
  },

  async clearAccountRoom(userId: string): Promise<void> {
    await tx("readwrite", (s) => s.delete(`room:${userId}`));
  },

  /** 로그아웃·계정 전환 시: 다른 계정에 조용히 합치지 않도록 모든 초안을 지운다. */
  async clearAll(): Promise<void> {
    await tx("readwrite", (s) => s.clear());
  },
};
