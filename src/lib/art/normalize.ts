// ArtNormalizer (8.3, 7.2~7.3): 원 좌표 구간 → 기준 위치를 제거한 상대 기준선 + 전시 인덱스.
// 기준점·원 위경도·원 경계 상자는 반환값에 포함하지 않는다 (서버·IndexedDB로 나가지 않음).

import { ART_LIMITS, NORMALIZATION_VERSION } from "@/lib/contracts/limits";
import type { ArtGeometry, Pt } from "@/lib/contracts/types";
import { ImportError } from "@/lib/gpx/errors";
import { EARTH_RADIUS_M } from "@/lib/gpx/metrics";
import type { GpxPoint } from "@/lib/gpx/parser";
import { rdpIndices, type XY } from "./rdp";

const toRad = (d: number) => (d * Math.PI) / 180;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
const clampUv = (n: number) => Math.min(ART_LIMITS.uvMax, Math.max(ART_LIMITS.uvMin, round6(n)));

export function normalizeSegments(segments: GpxPoint[][]): ArtGeometry {
  const all = segments.flat();
  if (all.length === 0) throw new ImportError("no_valid_segment", "점 없음");

  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const p of all) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  // 날짜변경선 통과 트랙은 P0에서 거절한다. 50km 제한에서 경도 폭이 180°를 넘으면 반대편을 도는 경로다.
  if (maxLon - minLon > 180) throw new ImportError("antimeridian", "날짜변경선 통과");

  const φ0 = toRad((minLat + maxLat) / 2);
  const λ0 = toRad((minLon + maxLon) / 2);
  if (Math.abs((minLat + maxLat) / 2) >= ART_LIMITS.maxAbsLatitude) throw new ImportError("polar", "극지 범위");

  const cosφ0 = Math.cos(φ0);
  const projected: XY[][] = segments.map((seg) =>
    seg.map((p) => [EARTH_RADIUS_M * cosφ0 * (toRad(p.lon) - λ0), EARTH_RADIUS_M * (toRad(p.lat) - φ0)] as const),
  );

  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const seg of projected) {
    for (const [x, y] of seg) {
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (y < yMin) yMin = y;
      if (y > yMax) yMax = y;
    }
  }
  const w = xMax - xMin;
  const h = yMax - yMin;
  if (w > ART_LIMITS.maxSpanMeters || h > ART_LIMITS.maxSpanMeters) {
    throw new ImportError("out_of_range", "가로·세로 50km 초과");
  }
  // 수직·수평선은 다른 축 길이로 처리; 모든 점이 같으면 L=0 → 유효 작품 아님.
  const L = Math.max(w, h);
  if (!(L > 0)) throw new ImportError("degenerate", "모든 점이 같은 위치");
  if (!segments.some((seg) => seg.some((p) => p.lat !== seg[0].lat || p.lon !== seg[0].lon))) {
    throw new ImportError("no_valid_segment", "서로 다른 2점 이상인 구간 없음");
  }

  const xc = (xMin + xMax) / 2;
  const yc = (yMin + yMax) / 2;
  const sourceSegments: Pt[][] = projected.map((seg) =>
    seg.map(([x, y]) => [clampUv(0.5 + (0.9 * (x - xc)) / L), clampUv(0.5 - (0.9 * (y - yc)) / L)] as Pt),
  );

  // 전시용 선: 미터 단위 투영 좌표에서 2m 허용 오차로 구간별 단순화.
  const renderIndices = projected.map((seg) => rdpIndices(seg, ART_LIMITS.toleranceMeters));
  const renderCount = renderIndices.reduce((s, a) => s + a.length, 0);
  if (renderCount > ART_LIMITS.maxRenderPoints) {
    // 오차를 몰래 늘리지 않는다.
    throw new ImportError("render_limit", "전시 점 한도 초과", { count: renderCount });
  }

  return {
    schemaVersion: 1,
    normalizationVersion: NORMALIZATION_VERSION,
    sourceSegments,
    renderIndices,
    renderMethod: "rdp",
    toleranceMeters: ART_LIMITS.toleranceMeters,
  };
}

export function renderLines(g: Pick<ArtGeometry, "sourceSegments" | "renderIndices">): Pt[][] {
  return g.sourceSegments.map((seg, i) => g.renderIndices[i].map((k) => seg[k]));
}

export function countPoints(g: Pick<ArtGeometry, "sourceSegments">): number {
  return g.sourceSegments.reduce((s, a) => s + a.length, 0);
}

export function countRenderPoints(g: Pick<ArtGeometry, "renderIndices">): number {
  return g.renderIndices.reduce((s, a) => s + a.length, 0);
}
