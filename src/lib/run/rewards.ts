// 달리기 포인트 (순수 함수, 브라우저 API 없음 → 단위 시험 가능)
// - 코스 달리기: 그림 구간을 따라 100m 지점마다 포인트 객체를 두고, 통과하면 100P
// - 자유 달리기: 달린 거리 100m마다 100P
// 포인트는 항상 100P 단위. 100m에 못 미치는 나머지는 버린다. 하루 적립 상한은 10,000P.

import { pointSegDist } from "@/lib/route/graph";
import { haversineMeters } from "@/lib/gpx/metrics";

export const CHECKPOINT_SPACING_M = 100;
export const POINTS_PER_CHECKPOINT = 100;
export const DAILY_POINT_CAP = 10_000;
/** 객체 반경: 직전 위치→현재 위치 선분이 이 안을 지나면 통과 */
export const CHECKPOINT_RADIUS_M = 25;
/** 객체 사이에 실제로 달려야 하는 최소 거리 (길을 가로질러 객체만 찍고 다니지 않게) */
export const MIN_RUN_BETWEEN_M = 70;
/** 1km 2분 30초보다 빠르면 달리기가 아니라고 보고 적립하지 않는다 (자전거·차량) */
export const MAX_REWARD_SPEED_MS = 1000 / 150;

const R = 6_371_000;
const RAD = Math.PI / 180;

export interface Checkpoint {
  /** 그림 구간만 이어 잰 거리 (100, 200, …) */
  atMeters: number;
  lat: number;
  lon: number;
}

/**
 * 코스의 그림 구간을 따라 100m마다 객체를 둔다. 이동 구간(moves)은 일시정지하고 지나가라고 안내하는 길이라 건너뛴다.
 * 객체 수 = ⌊그림 구간 길이 / 100⌋ (끝의 나머지에는 두지 않는다).
 */
export function placeCheckpoints(latlngs: [number, number][], moves: Array<[number, number]> = []): Checkpoint[] {
  const out: Checkpoint[] = [];
  const inMove = (i: number) => moves.some(([a, b]) => i >= a && i + 1 <= b);
  let walked = 0;
  for (let i = 0; i + 1 < latlngs.length; i++) {
    if (inMove(i)) continue;
    const [aLat, aLon] = latlngs[i], [bLat, bLon] = latlngs[i + 1];
    const len = haversineMeters({ lat: aLat, lon: aLon }, { lat: bLat, lon: bLon });
    while (len > 0 && (out.length + 1) * CHECKPOINT_SPACING_M <= walked + len) {
      const at = (out.length + 1) * CHECKPOINT_SPACING_M;
      const t = (at - walked) / len;
      out.push({ atMeters: at, lat: aLat + (bLat - aLat) * t, lon: aLon + (bLon - aLon) * t });
    }
    walked += len;
  }
  return out;
}

export interface RewardState {
  /** 코스 객체별 획득 여부 (자유 달리기는 빈 배열) */
  got: boolean[];
  /** 마지막으로 획득한 객체 번호 (-1: 아직 없음) */
  lastIdx: number;
  /** 자유 달리기: 적립한 100m 구간 수 */
  freeCount: number;
  /** 자유 달리기: 아직 100m를 채우지 못한 거리 */
  freeCarry: number;
  /** 마지막 획득(또는 출발) 이후 달린 거리·시각 */
  sinceMeters: number;
  sinceTime: number | null;
  /** 직전 채택 위치 (일시정지 뒤 새 구간에서는 이어 붙이지 않는다) */
  last: { lat: number; lon: number } | null;
}

export const emptyRewards = (checkpointCount: number): RewardState => ({
  got: Array.from({ length: checkpointCount }, () => false),
  lastIdx: -1,
  freeCount: 0,
  freeCarry: 0,
  sinceMeters: 0,
  sinceTime: null,
  last: null,
});

export const collectedCount = (s: RewardState) => s.freeCount + s.got.reduce((n, g) => n + (g ? 1 : 0), 0);

/** 지나쳐서 놓친 객체 (마지막 획득 객체보다 앞 번호인데 아직 못 주운 것). 다시 지나가면 주울 수 있다. */
export const isMissed = (s: RewardState, i: number) => !s.got[i] && i < s.lastIdx;

export interface RewardFix {
  lat: number;
  lon: number;
  time: number;
}

/**
 * 기록에 채택된 위치 하나를 반영한다 (tracker.addFix가 받아들인 위치만 넣는다).
 * addedMeters: 이번 위치로 늘어난 기록 거리. newSegment: 일시정지 뒤 새 구간의 첫 위치.
 * 반환 gained: 이번에 얻은 객체 수 (코스는 0 또는 1, 자유 달리기는 0 이상)
 */
export function stepRewards(s: RewardState, checkpoints: Checkpoint[], fix: RewardFix, addedMeters: number, newSegment: boolean): { state: RewardState; gained: number; index: number | null } {
  const prev = newSegment ? null : s.last;
  const st: RewardState = { ...s, last: { lat: fix.lat, lon: fix.lon }, sinceMeters: s.sinceMeters + addedMeters, sinceTime: s.sinceTime ?? fix.time };
  const tooFast = (meters: number) => {
    const dt = (fix.time - (s.sinceTime ?? fix.time)) / 1000;
    return dt > 0 && meters / dt > MAX_REWARD_SPEED_MS;
  };

  if (!checkpoints.length) {
    // 자유 달리기: 100m 채울 때마다 1개. 그 100m를 너무 빨리 지났으면 버린다.
    let carry = s.freeCarry + addedMeters;
    let gained = 0;
    while (carry >= CHECKPOINT_SPACING_M) {
      carry -= CHECKPOINT_SPACING_M;
      if (!tooFast(st.sinceMeters - carry)) gained++;
      st.sinceMeters = carry;
      st.sinceTime = fix.time;
    }
    return { state: { ...st, freeCarry: carry, freeCount: s.freeCount + gained }, gained, index: null };
  }

  let best: { i: number; d: number } | null = null;
  for (let i = 0; i < checkpoints.length; i++) {
    if (s.got[i]) continue;
    // 앞 번호로 건너뛸수록 그만큼 더 달렸어야 한다 (코스가 겹치는 곳에서 먼 뒤쪽 객체를 미리 줍지 않게)
    const need = s.lastIdx >= 0 && i > s.lastIdx ? MIN_RUN_BETWEEN_M * (i - s.lastIdx) : MIN_RUN_BETWEEN_M;
    if (st.sinceMeters < need) continue;
    const d = distToPath(checkpoints[i], prev, fix);
    if (d <= CHECKPOINT_RADIUS_M && (!best || d < best.d)) best = { i, d };
  }
  if (!best || tooFast(st.sinceMeters)) return { state: st, gained: 0, index: null };
  const got = s.got.slice();
  got[best.i] = true;
  return { state: { ...st, got, lastIdx: best.i, sinceMeters: 0, sinceTime: fix.time }, gained: 1, index: best.i };
}

/** 객체에서 직전 위치→현재 위치 선분까지 거리 (m). 위치 갱신 사이에 객체 옆을 지나쳐도 놓치지 않게 */
function distToPath(c: Checkpoint, a: { lat: number; lon: number } | null, b: { lat: number; lon: number }) {
  const k = Math.cos(c.lat * RAD);
  const xy = (p: { lat: number; lon: number }) => [R * k * (p.lon - c.lon) * RAD, R * (p.lat - c.lat) * RAD] as const;
  const [bx, by] = xy(b);
  if (!a) return Math.hypot(bx, by);
  const [ax, ay] = xy(a);
  return pointSegDist(0, 0, ax, ay, bx, by);
}

// ───────────────────────── 하루 적립 ─────────────────────────

/** 한국 시간 기준 날짜 (YYYY-MM-DD) */
export const kstDay = (t: number) => new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);

/** 오늘 이미 받은 포인트를 빼고 이번 달리기에서 실제로 적립되는 포인트 */
export function cappedPoints(collected: number, todayPoints: number) {
  return Math.max(0, Math.min(collected * POINTS_PER_CHECKPOINT, DAILY_POINT_CAP - todayPoints));
}
