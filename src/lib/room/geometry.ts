// 방 배치 규칙 (9.3): 1,000×750 논리 좌표, 회전·액자 여백을 포함한 경계 상자 검사, 기본 슬롯 배치.
// 클라이언트와 서버가 같은 함수를 쓰고, DB 함수(save_room)도 같은 규칙을 다시 검사한다.

import { ROOM } from "@/lib/contracts/limits";
import type { ItemStyle, RoomItem } from "@/lib/contracts/types";

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 슬롯(액자 포함 정사각형)을 회전했을 때의 축 정렬 경계 상자, 방 픽셀 단위. */
export function itemBounds(item: Pick<RoomItem, "x" | "y" | "size" | "rotationDeg">): Box {
  const side = item.size * ROOM.width;
  const r = (item.rotationDeg * Math.PI) / 180;
  const half = (side / 2) * (Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)));
  const cx = item.x * ROOM.width;
  const cy = item.y * ROOM.height;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}

const EPS = 1e-6;

export function fitsInRoom(item: Pick<RoomItem, "x" | "y" | "size" | "rotationDeg">): boolean {
  const b = itemBounds(item);
  return b.minX >= -EPS && b.minY >= -EPS && b.maxX <= ROOM.width + EPS && b.maxY <= ROOM.height + EPS;
}

/** 크기·회전을 유지한 채 중심을 방 안쪽으로 당긴다. 크기 자체가 너무 크면 null. */
export function clampIntoRoom<T extends Pick<RoomItem, "x" | "y" | "size" | "rotationDeg">>(item: T): T | null {
  const b = itemBounds(item);
  const halfW = (b.maxX - b.minX) / 2;
  const halfH = (b.maxY - b.minY) / 2;
  if (halfW * 2 > ROOM.width || halfH * 2 > ROOM.height) return null;
  // 소수 4자리로 반올림하되, 반올림이 경계 밖으로 밀어내지 않도록 허용 범위를 안쪽으로 올림/내림한다.
  const x = clamp(round4(item.x), ceil4(halfW / ROOM.width), floor4((ROOM.width - halfW) / ROOM.width));
  const y = clamp(round4(item.y), ceil4(halfH / ROOM.height), floor4((ROOM.height - halfH) / ROOM.height));
  return { ...item, x, y };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;
const ceil4 = (n: number) => Math.ceil(n * 1e4 - 1e-9) / 1e4;
const floor4 = (n: number) => Math.floor(n * 1e4 + 1e-9) / 1e4;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

function overlaps(a: Box, b: Box) {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 기본 슬롯: 5열 × 4행 격자. DB 함수 create_artwork_and_place와 같은 순서·크기를 쓴다. */
export const DEFAULT_SLOTS: ReadonlyArray<{ x: number; y: number }> = Array.from({ length: 20 }, (_, i) => ({
  x: 0.1 + (i % 5) * 0.2,
  y: 0.125 + Math.floor(i / 5) * 0.25,
}));

export const DEFAULT_STYLE: ItemStyle = { strokeColor: "#0A72D6", strokeWidth: 0.026, frame: "paper" };

/**
 * 첫 작품은 중앙(0.3), 이후 작품은 기존 작품과 겹치지 않는 첫 기본 슬롯(0.16).
 * 빈 슬롯이 없으면 첫 슬롯에 겹쳐 놓는다. 전시 한도에 도달했으면 null (보관 목록에만 추가).
 */
export function nextPlacement(existing: RoomItem[]): Pick<RoomItem, "x" | "y" | "size" | "rotationDeg" | "zIndex"> | null {
  if (existing.length >= ROOM.maxDisplayed) return null;
  const zIndex = nextZIndex(existing);
  if (existing.length === 0) return { x: 0.5, y: 0.5, size: ROOM.firstItemSize, rotationDeg: 0, zIndex };
  const boxes = existing.map(itemBounds);
  for (const s of DEFAULT_SLOTS) {
    const cand = { ...s, size: ROOM.slotItemSize, rotationDeg: 0 };
    const b = itemBounds(cand);
    if (!boxes.some((o) => overlaps(b, o))) return { ...cand, zIndex };
  }
  return { ...DEFAULT_SLOTS[0], size: ROOM.slotItemSize, rotationDeg: 0, zIndex };
}

export function nextZIndex(items: RoomItem[]): number {
  const used = new Set(items.map((i) => i.zIndex));
  for (let z = 0; z < ROOM.maxDisplayed; z++) if (!used.has(z)) return z;
  return -1;
}

/** 겹침 순서를 0..n-1로 다시 매긴다(고유성 유지). */
export function compactZ(items: RoomItem[]): RoomItem[] {
  const order = [...items].sort((a, b) => a.zIndex - b.zIndex).map((i) => i.id);
  return items.map((i) => ({ ...i, zIndex: order.indexOf(i.id) }));
}
