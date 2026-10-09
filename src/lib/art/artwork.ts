// 선택한 트랙 → 서버로 보낼 수 있는 작품 요청 + 화면용 작품 뷰.
// 반환 객체에는 원 위경도·기준점·XML·파일명·점별 시각이 들어가지 않는다 (9.2).

import { DEFAULT_TITLE } from "@/lib/contracts/limits";
import type { ArtworkView, CreateArtworkRequest, SourceKind } from "@/lib/contracts/types";
import { trackDistanceMeters } from "@/lib/gpx/metrics";
import type { GpxPoint, GpxTrack } from "@/lib/gpx/parser";
import { countPoints, countRenderPoints, normalizeSegments, renderLines } from "./normalize";

export function buildArtwork(
  track: GpxTrack,
  opts: { title?: string; recordedDate?: string | null; sourceKind?: SourceKind } = {},
): { request: CreateArtworkRequest; view: ArtworkView } {
  const geometry = normalizeSegments(track.segments);
  const distance = Math.round(trackDistanceMeters(track) * 10) / 10;
  const request: CreateArtworkRequest = {
    clientRequestId: crypto.randomUUID(),
    title: (opts.title ?? DEFAULT_TITLE).trim() || DEFAULT_TITLE,
    sourceKind: opts.sourceKind ?? "provided_gpx",
    geometry,
    stats: {
      distanceEstimateMeters: distance,
      recordedDate: opts.recordedDate ?? null,
      pointCount: countPoints(geometry),
      segmentCount: geometry.sourceSegments.length,
    },
  };
  const view: ArtworkView = {
    id: crypto.randomUUID(),
    title: request.title,
    sourceKind: request.sourceKind,
    revision: 0,
    stats: request.stats,
    renderLines: renderLines(geometry),
    renderPointCount: countRenderPoints(geometry),
    geometry,
    clientRequestId: request.clientRequestId,
  };
  return { request, view };
}

export function toCreateRequest(view: ArtworkView): CreateArtworkRequest {
  if (!view.geometry || !view.clientRequestId) throw new Error("local_artwork_required");
  return {
    clientRequestId: view.clientRequestId,
    title: view.title,
    sourceKind: view.sourceKind,
    geometry: view.geometry,
    stats: view.stats,
  };
}

/**
 * 예시 기록: 실제 사용자의 활동이 아님을 sourceKind=demo와 제목으로 표시한다 (S-01).
 * 하트 곡선을 약 1.2km 크기로 만든 합성 좌표이며 실제 러닝 측정값이 아니다.
 */
export function demoTrack(): GpxTrack {
  const lat0 = 35.1587;
  const lon0 = 129.1604;
  const pts: GpxPoint[] = [];
  const n = 240;
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    // 1 단위 ≈ 35m
    pts.push({ lat: lat0 + (y * 35) / 111_320, lon: lon0 + (x * 35) / (111_320 * Math.cos((lat0 * Math.PI) / 180)) });
  }
  return { index: 0, name: "예시 기록", segments: [pts], pointCount: pts.length };
}

export function buildDemoArtwork() {
  return buildArtwork(demoTrack(), { title: "예시 기록 · 하트", sourceKind: "demo" });
}
