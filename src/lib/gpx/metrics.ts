// TrackMetrics (8.3, 7.1): 구간별 GPS 좌표 기반 추정 거리와 날짜 후보.
// 실제 이동거리·측량값·운동 인증이 아니다.

import type { GpxPoint, GpxTrack } from "./parser";

export const EARTH_RADIUS_M = 6_371_000;
const toRad = (d: number) => (d * Math.PI) / 180;

/** 경도 차이를 [-π, π]로 정리한 Haversine 구면 근사. */
export function haversineMeters(a: GpxPoint, b: GpxPoint): number {
  const φ1 = toRad(a.lat);
  const φ2 = toRad(b.lat);
  const dφ = φ2 - φ1;
  let dλ = toRad(b.lon - a.lon);
  if (dλ > Math.PI) dλ -= 2 * Math.PI;
  if (dλ < -Math.PI) dλ += 2 * Math.PI;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 각 구간 안의 인접점 거리 합. 구간 사이 공백은 합산하지 않으며 단일점 구간은 0. */
export function segmentDistances(track: GpxTrack): number[] {
  return track.segments.map((seg) => {
    let d = 0;
    for (let i = 1; i < seg.length; i++) d += haversineMeters(seg[i - 1], seg[i]);
    return d;
  });
}

export function trackDistanceMeters(track: GpxTrack): number {
  return segmentDistances(track).reduce((s, d) => s + d, 0);
}

/**
 * 시간 정보가 있으면 기기 시간대 기준 날짜 후보(YYYY-MM-DD)를 보여준다.
 * 사용자가 선택한 날짜 문자열만 저장하며 점별 시각은 보관하지 않는다.
 */
export function dateCandidates(track: GpxTrack, timeZone?: string): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  const set = new Set<string>();
  for (const seg of track.segments) {
    for (const p of seg) {
      if (!p.time) continue;
      const t = Date.parse(p.time);
      if (Number.isFinite(t)) set.add(fmt.format(new Date(t)));
      if (set.size >= 5) break;
    }
  }
  return [...set].sort();
}

export function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}
