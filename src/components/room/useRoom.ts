"use client";
// RoomEditor 상태 (8.3, 5.1~5.3): 임시(비로그인) 방과 계정 방을 같은 편집 모델로 다룬다.
// - 드래그 중에는 브라우저 상태만 갱신하고, 저장은 전체 배치 + 기대 버전을 한 요청으로 보낸다.
// - 성공 응답 뒤에만 "저장됨". 저장 중 추가 편집은 미저장으로 남는다(편집 순번 추적).
// - 버전 충돌은 자동 덮어쓰지 않는다.

import { useCallback, useEffect, useRef, useState } from "react";
import { toCreateRequest } from "@/lib/art/artwork";
import { RoadMapStore } from "@/lib/art/roadMap";
import { ROOM, type Theme } from "@/lib/contracts/limits";
import type { ArtworkView, MyRoomDto, RoomItem, ShareStatusDto } from "@/lib/contracts/types";
import { DraftRepository } from "@/lib/draft/DraftRepository";
import { clampIntoRoom, compactZ, DEFAULT_STYLE, nextPlacement } from "@/lib/room/geometry";
import { ApiError, api } from "@/lib/client/api";
import { track } from "@/lib/client/analytics";

export type Session = { kind: "loading" } | { kind: "guest" } | { kind: "account"; userId: string; email: string | null };
export type SaveStatus = "saved" | "dirty" | "saving" | "failed";

export interface RoomModel {
  theme: Theme;
  items: RoomItem[];
  artworks: Record<string, ArtworkView>;
  roomId: string | null;
  revision: number;
  artworkCount: number;
  share: ShareStatusDto | null;
}

const EMPTY: RoomModel = { theme: "light", items: [], artworks: {}, roomId: null, revision: 0, artworkCount: 0, share: null };

export type Notice = { tone: "info" | "warn" | "error"; text: string } | null;

/** 기기 보관 상태: 저장되었다고 거짓으로 표시하지 않기 위해 결과를 그대로 보여준다. */
export type DeviceKeep = "unknown" | "kept" | "tab_only";

export function useRoom(session: Session) {
  const [model, setModel] = useState<RoomModel>(EMPTY);
  const modelRef = useRef(model);
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState(false);
  const [deviceKeep, setDeviceKeep] = useState<DeviceKeep>("unknown");
  const [busy, setBusy] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const editSeq = useRef(0);
  const draftId = useRef<string>("");
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commit = useCallback((next: RoomModel) => {
    modelRef.current = next;
    setModel(next);
  }, []);

  // ───────── 기기 초안 보관 ─────────
  const persistNow = useCallback(async () => {
    const m = modelRef.current;
    try {
      if (session.kind === "guest") {
        if (!draftId.current) draftId.current = crypto.randomUUID();
        await DraftRepository.saveGuest({ draftId: draftId.current, theme: m.theme, items: m.items, artworks: Object.values(m.artworks) });
      } else if (session.kind === "account" && m.roomId) {
        await DraftRepository.saveAccountRoom({
          userId: session.userId,
          roomId: m.roomId,
          baseRevision: m.revision,
          theme: m.theme,
          items: m.items,
          savedAt: Date.now(),
        });
      }
      setDeviceKeep("kept");
      return true;
    } catch {
      setDeviceKeep("tab_only");
      return false;
    }
  }, [session]);

  const schedulePersist = useCallback(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => void persistNow(), 400);
  }, [persistNow]);

  const markDirty = useCallback(
    (next: RoomModel) => {
      editSeq.current++;
      commit(next);
      setStatus("dirty");
      schedulePersist();
    },
    [commit, schedulePersist],
  );

  // ───────── 서버 방 불러오기 ─────────
  const loadServer = useCallback(async (): Promise<MyRoomDto> => {
    const dto = await api<MyRoomDto>("/api/me/room");
    const artworks: Record<string, ArtworkView> = {};
    for (const a of dto.artworks) artworks[a.id] = a;
    commit({
      theme: dto.room?.theme ?? "light",
      items: dto.items,
      artworks,
      roomId: dto.room?.id ?? null,
      revision: dto.room?.revision ?? 0,
      artworkCount: dto.artworkCount,
      share: dto.share,
    });
    editSeq.current++;
    setStatus("saved");
    setConflict(false);
    return dto;
  }, [commit]);

  // ───────── 비로그인: 작품 추가 ─────────
  const addLocal = useCallback(
    (view: ArtworkView) => {
      const m = modelRef.current;
      if (Object.keys(m.artworks).length >= ROOM.maxArtworksPerAccount) {
        setNotice({ tone: "warn", text: `임시 작품은 ${ROOM.maxArtworksPerAccount}개까지 만들 수 있어요.` });
        return;
      }
      const place = nextPlacement(m.items);
      const items = place
        ? [...m.items, { id: crypto.randomUUID(), artworkId: view.id, ...place, style: { ...DEFAULT_STYLE } }]
        : m.items;
      if (!place) setNotice({ tone: "info", text: "전시 한도(20개)에 도달해 보관 목록에만 추가했어요. 기존 작품은 그대로예요." });
      markDirty({ ...m, items, artworks: { ...m.artworks, [view.id]: view }, artworkCount: m.artworkCount + 1 });
    },
    [markDirty],
  );

  // ───────── 저장 ─────────
  const save = useCallback(async (): Promise<boolean> => {
    if (session.kind !== "account") return false;
    const m = modelRef.current;
    if (!m.roomId) return true;
    const seq = editSeq.current;
    setStatus("saving");
    try {
      const r = await api<{ revision: number }>(`/api/rooms/${m.roomId}`, {
        method: "PUT",
        body: { expectedRevision: m.revision, theme: m.theme, items: m.items },
      });
      const cur = modelRef.current;
      commit({ ...cur, revision: r.revision });
      if (editSeq.current === seq) {
        setStatus("saved");
        await DraftRepository.clearAccountRoom(session.userId).catch(() => undefined);
      } else {
        setStatus("dirty");
        schedulePersist();
      }
      track({ name: "room_edit_saved" });
      setNotice(null);
      return true;
    } catch (e) {
      setStatus("failed");
      const kept = await persistNow();
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        setNotice({ tone: "warn", text: "다른 창에서 방이 바뀌었어요. 자동으로 덮어쓰지 않았어요." });
      } else if (e instanceof ApiError && e.status === 401) {
        setNotice({ tone: "error", text: "로그인이 만료됐어요. 다시 로그인한 뒤 저장해 주세요. 편집 내용은 유지돼요." });
      } else {
        setNotice({
          tone: "error",
          text: kept
            ? "저장하지 못했어요. 현재 편집 내용은 이 기기에 남아 있어요. 다시 시도해 주세요."
            : "저장하지 못했어요. 이 기기에도 보관하지 못해 현재 탭에만 남아 있어요. 탭을 닫지 마세요.",
        });
      }
      return false;
    }
  }, [session, commit, persistNow, schedulePersist]);

  /** 서버 작업이 방 revision을 정확히 1 올렸다면 로컬 편집을 그 위로 옮기고, 아니면 충돌로 본다. */
  const rebase = useCallback(
    (roomRevision: number, apply: (m: RoomModel) => RoomModel) => {
      const m = modelRef.current;
      const next = apply(m);
      if (roomRevision === m.revision + 1) {
        commit({ ...next, revision: roomRevision });
      } else {
        commit(next);
        setConflict(true);
        setStatus("failed");
        setNotice({ tone: "warn", text: "다른 창에서 방이 바뀌었어요. 서버 버전을 다시 불러와 주세요." });
      }
    },
    [commit],
  );

  // ───────── 작품 추가(계정) ─────────
  const addArtwork = useCallback(
    async (view: ArtworkView) => {
      if (session.kind !== "account") return addLocal(view);
      if (status !== "saved") {
        // 작품 추가는 방 버전을 올리므로 미저장 편집을 먼저 저장한다.
        const okSaved = await save();
        if (!okSaved) return;
      }
      setBusy("작품을 저장하는 중");
      try {
        const before = modelRef.current.artworkCount;
        const r = await api<{ artworkId: string }>(`/api/artworks`, { method: "POST", body: toCreateRequest(view) });
        await RoadMapStore.rename(view.id, r.artworkId);
        await loadServer();
        track({ name: before === 0 ? "first_art_saved" : "second_art_saved" });
        setNotice({ tone: "info", text: "작품을 저장하고 방에 전시했어요." });
      } catch (e) {
        setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "작품을 저장하지 못했어요." });
      } finally {
        setBusy(null);
      }
    },
    [session, status, save, addLocal, loadServer],
  );

  // ───────── 편집 명령 ─────────
  const updateItem = useCallback(
    (itemId: string, patch: Partial<Omit<RoomItem, "id" | "artworkId">>) => {
      const m = modelRef.current;
      const items = m.items.map((it) => {
        if (it.id !== itemId) return it;
        const merged = { ...it, ...patch, style: { ...it.style, ...(patch.style ?? {}) } };
        merged.size = Math.min(ROOM.sizeMax, Math.max(ROOM.sizeMin, merged.size));
        merged.rotationDeg = normalizeDeg(merged.rotationDeg);
        return clampIntoRoom(merged) ?? it;
      });
      markDirty({ ...m, items });
    },
    [markDirty],
  );

  const reorder = useCallback(
    (itemId: string, dir: "forward" | "backward" | "front" | "back") => {
      const m = modelRef.current;
      const sorted = [...m.items].sort((a, b) => a.zIndex - b.zIndex);
      const i = sorted.findIndex((x) => x.id === itemId);
      if (i < 0) return;
      const [it] = sorted.splice(i, 1);
      const j = dir === "front" ? sorted.length : dir === "back" ? 0 : dir === "forward" ? Math.min(sorted.length, i + 1) : Math.max(0, i - 1);
      sorted.splice(j, 0, it);
      const z = new Map(sorted.map((x, k) => [x.id, k]));
      markDirty({ ...m, items: m.items.map((x) => ({ ...x, zIndex: z.get(x.id)! })) });
    },
    [markDirty],
  );

  const removeFromRoom = useCallback(
    (itemId: string) => {
      const m = modelRef.current;
      markDirty({ ...m, items: compactZ(m.items.filter((i) => i.id !== itemId)) });
    },
    [markDirty],
  );

  const setTheme = useCallback((theme: Theme) => markDirty({ ...modelRef.current, theme }), [markDirty]);

  /** 보관 목록의 작품을 방에 전시. 계정 작품은 전시용 선을 상세 API에서 받아 온다. */
  const displayArtwork = useCallback(
    async (artworkId: string) => {
      const m = modelRef.current;
      if (m.items.some((i) => i.artworkId === artworkId)) return;
      const place = nextPlacement(m.items);
      if (!place) {
        setNotice({ tone: "warn", text: "전시 한도(20개)에 도달했어요. 다른 작품을 방에서 뺀 뒤 전시해 주세요." });
        return;
      }
      let view = m.artworks[artworkId];
      if (!view && session.kind === "account") {
        try {
          view = await api<ArtworkView>(`/api/artworks/${artworkId}`);
        } catch (e) {
          setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "작품을 불러오지 못했어요." });
          return;
        }
      }
      if (!view) return;
      const cur = modelRef.current;
      markDirty({
        ...cur,
        artworks: { ...cur.artworks, [artworkId]: view },
        items: [...cur.items, { id: crypto.randomUUID(), artworkId, ...place, style: { ...DEFAULT_STYLE } }],
      });
    },
    [session, markDirty],
  );

  const renameArtwork = useCallback(
    async (artworkId: string, title: string) => {
      const t = title.trim();
      if (!t || t.length > 60) return;
      const m = modelRef.current;
      const a = m.artworks[artworkId];
      if (!a) return;
      if (session.kind !== "account") {
        markDirty({ ...m, artworks: { ...m.artworks, [artworkId]: { ...a, title: t } } });
        return;
      }
      try {
        const r = await api<{ artworkRevision: number; roomRevision: number }>(`/api/artworks/${artworkId}`, {
          method: "PATCH",
          body: { title: t, expectedRevision: a.revision },
        });
        rebase(r.roomRevision, (cur) => ({
          ...cur,
          artworks: { ...cur.artworks, [artworkId]: { ...cur.artworks[artworkId], title: t, revision: r.artworkRevision } },
        }));
      } catch (e) {
        setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "제목을 바꾸지 못했어요." });
      }
    },
    [session, markDirty, rebase],
  );

  /** 기록 삭제: 작품·배치를 지우고 관련 공유를 폐기한다(서버 트랜잭션). 되돌릴 수 없다. */
  const deleteArtwork = useCallback(
    async (artworkId: string) => {
      const m = modelRef.current;
      const strip = (cur: RoomModel): RoomModel => {
        const artworks = { ...cur.artworks };
        delete artworks[artworkId];
        return {
          ...cur,
          artworks,
          items: compactZ(cur.items.filter((i) => i.artworkId !== artworkId)),
          artworkCount: Math.max(0, cur.artworkCount - 1),
        };
      };
      if (session.kind !== "account") {
        markDirty(strip(m));
        void RoadMapStore.remove(artworkId);
        return true;
      }
      try {
        const r = await api<{ roomRevision: number }>(`/api/artworks/${artworkId}`, { method: "DELETE" });
        rebase(r.roomRevision, strip);
        void RoadMapStore.remove(artworkId);
        // 공유에 이 작품이 있었다면 서버가 폐기했다. 상태를 다시 확인한다.
        if (m.share) {
          const dto = await api<MyRoomDto>("/api/me/room").catch(() => null);
          if (dto) commit({ ...modelRef.current, share: dto.share });
        }
        return true;
      } catch (e) {
        setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "삭제하지 못했어요." });
        return false;
      }
    },
    [session, markDirty, rebase, commit],
  );

  const loadDetail = useCallback(
    async (artworkId: string): Promise<ArtworkView | null> => {
      const a = modelRef.current.artworks[artworkId];
      if (a?.geometry) return a;
      if (session.kind !== "account") return a ?? null;
      try {
        const v = await api<ArtworkView>(`/api/artworks/${artworkId}`);
        const cur = modelRef.current;
        // 상세는 화면 캐시에만 둔다(편집 상태 아님).
        commit({ ...cur, artworks: { ...cur.artworks, [artworkId]: { ...cur.artworks[artworkId], geometry: v.geometry } } });
        return v;
      } catch {
        return null;
      }
    },
    [session, commit],
  );

  const setShare = useCallback((share: ShareStatusDto | null) => commit({ ...modelRef.current, share }), [commit]);

  // ───────── 충돌·기기 초안 복원 ─────────
  const reloadFromServer = useCallback(async () => {
    await persistNow(); // 현재 초안은 기기에 백업한 뒤 서버 버전을 불러온다.
    try {
      await loadServer();
      setNotice({ tone: "info", text: "서버 버전을 불러왔어요. 이전 편집은 이 기기에 백업했어요." });
      return true;
    } catch (e) {
      setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "불러오지 못했어요." });
      return false;
    }
  }, [persistNow, loadServer]);

  /** 기기에 남은 계정 방 초안을 현재 서버 버전 위에 다시 적용 (사용자가 명시적으로 선택). */
  const applyAccountDraft = useCallback(async () => {
    if (session.kind !== "account") return;
    const d = await DraftRepository.loadAccountRoom(session.userId).catch(() => null);
    const m = modelRef.current;
    if (!d || d.roomId !== m.roomId) return;
    const artworks = { ...m.artworks };
    const items: RoomItem[] = [];
    for (const it of d.items) {
      if (!artworks[it.artworkId]) {
        const v = await api<ArtworkView>(`/api/artworks/${it.artworkId}`).catch(() => null);
        if (!v) continue; // 삭제된 작품은 건너뛴다.
        artworks[it.artworkId] = v;
      }
      items.push(it);
    }
    markDirty({ ...m, theme: d.theme, items: compactZ(items), artworks });
    setConflict(false);
  }, [session, markDirty]);

  const discardAccountDraft = useCallback(async () => {
    if (session.kind === "account") await DraftRepository.clearAccountRoom(session.userId).catch(() => undefined);
  }, [session]);

  /**
   * 로그인 복귀 후 임시 작품을 현재 계정에 저장 (사용자 확인 뒤 호출).
   * clientRequestId를 고정해 재시도해도 중복 생성되지 않는다. 기존 방은 덮어쓰지 않고 작품만 추가한다.
   */
  const importGuestDraft = useCallback(async () => {
    if (session.kind !== "account") return;
    const d = await DraftRepository.loadGuest().catch(() => null);
    if (!d) {
      setNotice({ tone: "warn", text: "임시 작품을 복원하지 못했어요(기기 보관 실패·브라우저 데이터 삭제·다른 브라우저). 파일을 다시 선택해 주세요." });
      return;
    }
    setBusy("임시 작품을 계정에 저장하는 중");
    const idMap = new Map<string, string>();
    let wasEmpty = true;
    try {
      const startCount = modelRef.current.artworkCount;
      wasEmpty = modelRef.current.items.length === 0;
      for (const a of d.artworks) {
        if (!a.geometry || !a.clientRequestId) continue;
        const r = await api<{ artworkId: string }>("/api/artworks", { method: "POST", body: toCreateRequest(a) });
        idMap.set(a.id, r.artworkId);
        await RoadMapStore.rename(a.id, r.artworkId);
      }
      const dto = await loadServer();
      // 원래 빈 방이었다면 임시 방에서 꾸민 배치·스타일을 그대로 옮긴다.
      if (wasEmpty && dto.room && d.items.length) {
        const items = d.items
          .filter((it) => idMap.has(it.artworkId))
          .map((it) => ({ ...it, artworkId: idMap.get(it.artworkId)! }));
        const cur = modelRef.current;
        commit({ ...cur, theme: d.theme, items: compactZ(items) });
        editSeq.current++;
        await save();
      }
      await DraftRepository.clearGuest().catch(() => undefined);
      track({ name: startCount === 0 ? "first_art_saved" : "second_art_saved" });
      setNotice({ tone: "info", text: `임시 작품 ${idMap.size}개를 계정에 저장했어요.` });
    } catch (e) {
      setNotice({
        tone: "error",
        text: `${idMap.size}개까지 저장했어요. ${e instanceof ApiError ? e.message : "나머지는 저장하지 못했어요."} 다시 시도하면 중복 없이 이어서 저장해요.`,
      });
    } finally {
      setBusy(null);
    }
  }, [session, loadServer, commit, save]);

  const discardGuestDraft = useCallback(async () => {
    await DraftRepository.clearGuest().catch(() => undefined);
  }, []);

  // ───────── 초기화 ─────────
  useEffect(() => {
    if (session.kind === "loading") return;
    let cancelled = false;
    (async () => {
      if (session.kind === "guest") {
        const d = await DraftRepository.loadGuest().catch(() => null);
        if (cancelled) return;
        if (d) {
          draftId.current = d.draftId;
          const artworks: Record<string, ArtworkView> = {};
          for (const a of d.artworks) artworks[a.id] = a;
          commit({ ...EMPTY, theme: d.theme, items: d.items, artworks, artworkCount: d.artworks.length });
          setDeviceKeep("kept");
          setStatus(d.artworks.length ? "dirty" : "saved");
        }
      } else {
        try {
          await loadServer();
        } catch (e) {
          if (!cancelled) setNotice({ tone: "error", text: e instanceof ApiError ? e.message : "작품방을 불러오지 못했어요." });
        }
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [session, commit, loadServer]);

  // 미저장 상태로 페이지를 떠나려 하면 경고
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (status === "dirty" || status === "saving" || status === "failed") e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [status]);

  return {
    model,
    status,
    notice,
    setNotice,
    conflict,
    deviceKeep,
    busy,
    ready,
    draftId,
    persistNow,
    addArtwork,
    updateItem,
    reorder,
    removeFromRoom,
    setTheme,
    displayArtwork,
    renameArtwork,
    deleteArtwork,
    loadDetail,
    setShare,
    save,
    reloadFromServer,
    applyAccountDraft,
    discardAccountDraft,
    importGuestDraft,
    discardGuestDraft,
  };
}

export function normalizeDeg(d: number) {
  let x = ((d + 180) % 360 + 360) % 360 - 180;
  if (x === -180 && d > 0) x = 180;
  return Math.round(x * 10) / 10;
}

export type RoomApi = ReturnType<typeof useRoom>;
