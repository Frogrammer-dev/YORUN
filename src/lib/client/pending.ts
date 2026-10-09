// 시작 화면에서 만든 첫 작품을 /room으로 넘기는 탭 내부 메모리 전달(IndexedDB 실패 시에도 동작).
import type { ArtworkView } from "@/lib/contracts/types";

let pending: ArtworkView | null = null;

export function setPendingArtwork(v: ArtworkView) {
  pending = v;
}

export function takePendingArtwork(): ArtworkView | null {
  const v = pending;
  pending = null;
  return v;
}
