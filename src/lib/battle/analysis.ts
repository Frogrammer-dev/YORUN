// 달리기 기록 → 대결 능력치 재료 (순수 함수, 기기 안에서만 계산한다)
// 코스 자체의 유사도가 아니라 실제로 달린 선이 코스와 얼마나 맞는지를 잰다.

import { pointSegDist } from "@/lib/route/graph";
import { detectTurns, type RunRecord } from "@/lib/run/tracker";

const R = 6_371_000;
const RAD = Math.PI / 180;

/** 이 거리 안이면 온전히 맞은 것으로, 이 거리 밖이면 벗어난 것으로 본다. 사이는 비례한다. GPS 오차를 고려한 값이다. */
export const FULL_MATCH_M = 15;
export const NO_MATCH_M = 40;
export const COURSE_SAMPLE_M = 10;
export const PACE_SPLITS = 10;
export const MIN_BATTLE_DISTANCE_M = 1_000;
export const MIN_BATTLE_COVERAGE = 0.5;
/** 1km 2분 30초보다 빠른 평균은 달리기로 보지 않는다 (포인트 적립 기준과 같다) */
export const MIN_PACE_SEC_PER_KM = 150;

export interface BattleCourse {
  latlngs: [number, number][];
  /** latlngs 중 그림이 아닌 이동 구간 [시작, 끝] 인덱스 */
  moves?: Array<[number, number]>;
  /** 코스 오르막 합계. 고도를 못 받았으면 null */
  ascentM: number | null;
}

export type IneligibleReason = "no-course" | "too-short" | "too-fast" | "off-course";

export interface RunStats {
  distanceM: number;
  /** 코스 그림 구간 중 실제로 지나간 비율 (0~1) */
  coverage: number;
  /** 달린 선 중 코스 위에 있었던 비율 (0~1) */
  onCourse: number;
  /** coverage와 onCourse의 조화 평균 (0~1). 일부만 달리거나 벗어나면 함께 낮아진다 */
  adherence: number;
  /** 구간별 초/km (거리 기준 등분). 기록이 없으면 빈 배열 */
  paceSplits: number[];
  avgPaceSecPerKm: number;
  /** 코스 꺾임마다 달린 선이 지나간 정도 (0~1) */
  corners: number[];
  /** corners 평균. 꺾임이 없는 코스는 adherence */
  cornering: number;
  /** km당 오르막. 고도를 모르면 null */
  climbMPerKm: number | null;
  eligible: boolean;
  ineligibleReason: IneligibleReason | null;
}

type Pt = [number, number];
const closeness = (d: number) => (d <= FULL_MATCH_M ? 1 : d >= NO_MATCH_M ? 0 : (NO_MATCH_M - d) / (NO_MATCH_M - FULL_MATCH_M));

function nearest(p: Pt, lines: Pt[][]): number {
  let best = Infinity;
  for (const line of lines) {
    if (line.length === 1) best = Math.min(best, Math.hypot(p[0] - line[0][0], p[1] - line[0][1]));
    for (let i = 1; i < line.length; i++) {
      const d = pointSegDist(p[0], p[1], line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
      if (d < best) best = d;
    }
  }
  return best;
}

/** 일정 간격 표본. 시작점과 끝점을 포함한다. */
function samples(line: Pt[], step: number): Pt[] {
  const out: Pt[] = line.length ? [line[0]] : [];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const len = Math.hypot(bx - ax, by - ay);
    let at = step - carry;
    while (at <= len && len > 0) {
      out.push([ax + ((bx - ax) * at) / len, ay + ((by - ay) * at) / len]);
      at += step;
    }
    carry = len > 0 ? (carry + len) % step : carry;
  }
  if (line.length > 1) out.push(line[line.length - 1]);
  return out;
}

/** 거리 기준으로 등분한 구간별 초/km. 일시정지로 나뉜 구간 사이는 거리·시간 모두 세지 않는다. */
function paceSplitsOf(segments: RunRecord["segments"], xy: Pt[][], total: number, n: number): number[] {
  if (total <= 0) return [];
  const size = total / n;
  const secs = new Array<number>(n).fill(0);
  let walked = 0;
  segments.forEach((seg, s) => {
    for (let i = 1; i < seg.length; i++) {
      let len = Math.hypot(xy[s][i][0] - xy[s][i - 1][0], xy[s][i][1] - xy[s][i - 1][1]);
      const dt = (seg[i].time - seg[i - 1].time) / 1000;
      if (len <= 0) {
        secs[Math.min(n - 1, Math.floor(walked / size))] += dt;
        continue;
      }
      const rate = dt / len;
      while (len > 1e-9) {
        const k = Math.min(n - 1, Math.floor(walked / size + 1e-9));
        const room = k === n - 1 ? len : Math.max((k + 1) * size - walked, 1e-9);
        const take = Math.min(room, len);
        secs[k] += take * rate;
        walked += take;
        len -= take;
      }
    }
  });
  return secs.map((sec) => (sec / size) * 1000);
}

export function analyzeRun(record: RunRecord, course: BattleCourse | null): RunStats {
  const first = course?.latlngs[0] ?? record.segments.find((s) => s.length)?.[0];
  const lat0 = first ? (Array.isArray(first) ? first[0] : first.lat) : 0;
  const lon0 = first ? (Array.isArray(first) ? first[1] : first.lon) : 0;
  const cos0 = Math.cos(lat0 * RAD);
  const proj = (lat: number, lon: number): Pt => [R * cos0 * (lon - lon0) * RAD, R * (lat - lat0) * RAD];

  const ranLines = record.segments.map((seg) => seg.map((f) => proj(f.lat, f.lon)));
  let ranMeters = 0, ranSeconds = 0;
  record.segments.forEach((seg, s) => {
    for (let i = 1; i < seg.length; i++) {
      ranMeters += Math.hypot(ranLines[s][i][0] - ranLines[s][i - 1][0], ranLines[s][i][1] - ranLines[s][i - 1][1]);
      ranSeconds += (seg[i].time - seg[i - 1].time) / 1000;
    }
  });
  const avgPaceSecPerKm = ranMeters > 0 ? (ranSeconds / ranMeters) * 1000 : 0;
  const paceSplits = paceSplitsOf(record.segments, ranLines, ranMeters, PACE_SPLITS);

  if (!course || course.latlngs.length < 2) {
    return {
      distanceM: ranMeters, coverage: 0, onCourse: 0, adherence: 0, paceSplits, avgPaceSecPerKm, corners: [], cornering: 0,
      climbMPerKm: null, eligible: false, ineligibleReason: "no-course",
    };
  }

  const courseLine = course.latlngs.map(([lat, lon]) => proj(lat, lon));
  const moves = course.moves ?? [];
  const inMove = (i: number) => moves.some(([a, b]) => i >= a && i + 1 <= b);
  // 그림 구간만 이어진 조각들 (이동 구간은 지나가지 않아도 감점하지 않는다)
  const drawn: Pt[][] = [];
  let piece: Pt[] = [];
  for (let i = 0; i + 1 < courseLine.length; i++) {
    if (inMove(i)) {
      if (piece.length) drawn.push(piece);
      piece = [];
      continue;
    }
    if (!piece.length) piece.push(courseLine[i]);
    piece.push(courseLine[i + 1]);
  }
  if (piece.length) drawn.push(piece);
  const drawnSamples = drawn.flatMap((line) => samples(line, COURSE_SAMPLE_M));
  const coverage = drawnSamples.length ? drawnSamples.reduce((sum, p) => sum + closeness(nearest(p, ranLines)), 0) / drawnSamples.length : 0;

  // 달린 선은 이동 구간 위에 있어도 벗어난 것이 아니다
  const ranSamples = ranLines.flatMap((line) => samples(line, COURSE_SAMPLE_M));
  const onCourse = ranSamples.length ? ranSamples.reduce((sum, p) => sum + closeness(nearest(p, [courseLine])), 0) / ranSamples.length : 0;
  const adherence = coverage + onCourse > 0 ? (2 * coverage * onCourse) / (coverage + onCourse) : 0;

  const xs = courseLine.map((p) => p[0]), ys = courseLine.map((p) => p[1]);
  const cum = [0];
  for (let i = 1; i < courseLine.length; i++) cum.push(cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]));
  const pointAt = (m: number): { p: Pt; seg: number } => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < m) i++;
    const len = cum[i] - cum[i - 1] || 1;
    const t = (m - cum[i - 1]) / len;
    return { p: [xs[i - 1] + (xs[i] - xs[i - 1]) * t, ys[i - 1] + (ys[i] - ys[i - 1]) * t], seg: i - 1 };
  };
  const corners = detectTurns(xs, ys, cum)
    .map((turn) => pointAt(turn.atMeters))
    .filter(({ seg }) => !inMove(seg))
    .map(({ p }) => closeness(nearest(p, ranLines)));
  const cornering = corners.length ? corners.reduce((a, b) => a + b, 0) / corners.length : adherence;

  const courseKm = cum[cum.length - 1] / 1000;
  const climbMPerKm = course.ascentM === null || courseKm <= 0 ? null : course.ascentM / courseKm;

  let ineligibleReason: IneligibleReason | null = null;
  if (ranMeters < MIN_BATTLE_DISTANCE_M) ineligibleReason = "too-short";
  else if (avgPaceSecPerKm < MIN_PACE_SEC_PER_KM) ineligibleReason = "too-fast";
  else if (coverage < MIN_BATTLE_COVERAGE) ineligibleReason = "off-course";

  return {
    distanceM: ranMeters, coverage, onCourse, adherence, paceSplits, avgPaceSecPerKm, corners, cornering, climbMPerKm,
    eligible: ineligibleReason === null, ineligibleReason,
  };
}
