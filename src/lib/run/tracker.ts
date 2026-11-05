// 달리기 중 코스 안내·기록 (순수 함수, 브라우저 API 없음 → 단위 시험 가능)
// GPS 기록은 기기 안에서만 다루며 서버로 보내지 않는다.

import { pointSegDist } from "@/lib/route/graph";
import { rdpIndices } from "@/lib/art/rdp";
import { haversineMeters } from "@/lib/gpx/metrics";

const R = 6_371_000;
const RAD = Math.PI / 180;

export type TurnDir = "left" | "right" | "uturn";
export interface Turn {
  atMeters: number;
  dir: TurnDir;
  angle: number;
}

export const TURN_LABEL: Record<TurnDir, string> = { left: "좌회전", right: "우회전", uturn: "되돌아가기" };

/** 코스 위 진행 추적: 진행 거리·이탈 거리·다음 방향 안내 */
export class RouteTracker {
  readonly total: number;
  readonly turns: Turn[];
  private xs: number[];
  private ys: number[];
  private cum: number[];
  private lat0: number;
  private lon0: number;
  private cos0: number;
  private seg = 0;
  private progress = 0;

  constructor(route: [number, number][]) {
    this.lat0 = route[0][0];
    this.lon0 = route[0][1];
    this.cos0 = Math.cos(this.lat0 * RAD);
    this.xs = [];
    this.ys = [];
    this.cum = [0];
    for (const [lat, lon] of route) {
      const [x, y] = this.proj(lat, lon);
      this.xs.push(x);
      this.ys.push(y);
    }
    for (let i = 1; i < route.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(this.xs[i] - this.xs[i - 1], this.ys[i] - this.ys[i - 1]));
    this.total = this.cum[this.cum.length - 1];
    this.turns = detectTurns(this.xs, this.ys, this.cum);
  }

  private proj(lat: number, lon: number): [number, number] {
    return [R * this.cos0 * (lon - this.lon0) * RAD, R * (lat - this.lat0) * RAD];
  }

  private nearestIn(x: number, y: number, from: number, to: number) {
    let best = { d: Infinity, seg: from, along: 0 };
    for (let i = Math.max(0, from); i < Math.min(this.xs.length - 1, to); i++) {
      const ax = this.xs[i], ay = this.ys[i], bx = this.xs[i + 1], by = this.ys[i + 1];
      const d = pointSegDist(x, y, ax, ay, bx, by);
      if (d < best.d) {
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
        const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2)) : 0;
        best = { d, seg: i, along: this.cum[i] + t * Math.sqrt(l2) };
      }
    }
    return best;
  }

  /**
   * 현재 위치 반영. 왕복·교차 구간에서 뒤로 튀지 않도록 직전 위치 주변 구간을 먼저 찾고,
   * 그 안에서 멀면(코스 이탈 후 복귀) 전체에서 다시 찾는다.
   */
  update(lat: number, lon: number) {
    const [x, y] = this.proj(lat, lon);
    let best = this.nearestIn(x, y, this.seg - 3, this.seg + 80);
    if (best.d > 60) {
      const global = this.nearestIn(x, y, 0, this.xs.length);
      if (global.d < best.d - 20) best = global;
    }
    if (best.d <= 60) {
      this.seg = best.seg;
      // 작은 GPS 흔들림으로 진행이 줄지 않게 단조 증가 (크게 되돌아간 경우만 반영)
      if (best.along > this.progress || this.progress - best.along > 150) this.progress = best.along;
    }
    const next = this.turns.find((t) => t.atMeters > this.progress + 5) ?? null;
    return {
      offRouteMeters: best.d,
      progressMeters: this.progress,
      remainingMeters: Math.max(0, this.total - this.progress),
      nextTurn: next ? { ...next, inMeters: next.atMeters - this.progress } : null,
      nearEnd: this.total - this.progress < 40 && Math.hypot(x - this.xs[this.xs.length - 1], y - this.ys[this.ys.length - 1]) < 50,
    };
  }

  distanceToStart(lat: number, lon: number) {
    return haversineMeters({ lat, lon }, { lat: this.lat0, lon: this.lon0 });
  }
}

/** 코스에서 40° 이상 꺾이는 지점을 방향 안내로 만든다 (y = 북쪽, 반시계 = 좌회전). */
export function detectTurns(xs: number[], ys: number[], cum: number[]): Turn[] {
  const pts = xs.map((x, i) => [x, ys[i]] as const);
  const keep = rdpIndices(pts, 8);
  const raw: Turn[] = [];
  for (let k = 1; k < keep.length - 1; k++) {
    const a = keep[k - 1], b = keep[k], c = keep[k + 1];
    const h1 = Math.atan2(ys[b] - ys[a], xs[b] - xs[a]);
    const h2 = Math.atan2(ys[c] - ys[b], xs[c] - xs[b]);
    let ang = ((h2 - h1) * 180) / Math.PI;
    while (ang > 180) ang -= 360;
    while (ang < -180) ang += 360;
    if (Math.abs(ang) < 40) continue;
    raw.push({ atMeters: cum[b], dir: Math.abs(ang) > 150 ? "uturn" : ang > 0 ? "left" : "right", angle: Math.round(ang) });
  }
  const merged: Turn[] = [];
  for (const t of raw) {
    const last = merged[merged.length - 1];
    if (last && t.atMeters - last.atMeters < 20) {
      if (Math.abs(t.angle) > Math.abs(last.angle)) merged[merged.length - 1] = t;
    } else merged.push(t);
  }
  return merged;
}

// ───────────────────────── 기록 ─────────────────────────

export interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  time: number;
}

export interface RunRecord {
  /** 일시정지 또는 GPS 공백마다 새 구간. 구간 사이는 연결하지 않는다. */
  segments: Array<Array<{ lat: number; lon: number; time: number }>>;
  distanceMeters: number;
  activeMs: number;
  /** 진행 중이면 마지막 재개 시각 */
  resumedAt: number | null;
  startedAt: number | null;
  /** 좌표·정확도·순서 검사를 통과한 마지막 위치 시각. 정지 중 수신도 포함한다. */
  lastFixAt?: number;
  /** 정지 중 수신도 포함한 속도 판정 기준점. 경로 단순화용 마지막 채택점과 구분한다. */
  lastFix?: { lat: number; lon: number; time: number };
}

export const emptyRecord = (): RunRecord => ({ segments: [], distanceMeters: 0, activeMs: 0, resumedAt: null, startedAt: null });

export const MAX_ACCURACY_M = 35;
/** 사람이 달릴 수 없는 순간 이동은 GPS 튐으로 보고 버린다 (≈ 1km 2분) */
export const MAX_SPEED_MS = 8.5;
/** 30초를 넘게 믿을 만한 위치가 없으면 이동 경로를 추측하지 않고 새 구간을 연다. */
export const MAX_FIX_GAP_MS = 30_000;

const validTime = (time: number) => Number.isFinite(time) && time >= 0 && time <= 8.64e15;

function invalidFixReason(f: Fix): "coordinate" | "timestamp" | "accuracy" | null {
  if (!Number.isFinite(f.lat) || !Number.isFinite(f.lon) || Math.abs(f.lat) > 90 || Math.abs(f.lon) > 180) return "coordinate";
  if (!Number.isFinite(f.accuracy) || f.accuracy < 0) return "accuracy";
  if (!validTime(f.time)) return "timestamp";
  return null;
}

/** 지도 표시도 불가능한 잘못된 값만 거른다. 정확도·속도·시각 순서 채택 기준은 addFix에서 적용한다. */
export function isValidFix(f: Fix): boolean {
  return invalidFixReason(f) === null;
}

export function startOrResume(r: RunRecord, now: number): RunRecord {
  if (r.resumedAt !== null || !validTime(now)) return r;
  return { ...r, segments: [...r.segments, []], resumedAt: now, startedAt: r.startedAt ?? now };
}

export function pause(r: RunRecord, now: number): RunRecord {
  if (r.resumedAt === null || !validTime(now)) return r;
  return { ...r, activeMs: elapsedMs(r, now), resumedAt: null };
}

export function elapsedMs(r: RunRecord, now: number) {
  return r.activeMs + (r.resumedAt !== null && validTime(now) ? Math.max(0, now - r.resumedAt) : 0);
}

export type FixRejectionReason = "paused" | "coordinate" | "timestamp" | "accuracy" | "jump" | "still";

/**
 * 위치 하나를 기록에 반영. accepted는 경로 점 채택 여부다.
 * 정지 중에도 정상 수신 시각은 갱신하므로, 호출자는 accepted와 관계없이 반환 record를 보관한다.
 */
export function addFix(r: RunRecord, f: Fix): { record: RunRecord; accepted: boolean; reason?: FixRejectionReason } {
  if (r.resumedAt === null) return { record: r, accepted: false, reason: "paused" };
  const invalid = invalidFixReason(f);
  if (invalid) return { record: r, accepted: false, reason: invalid };
  if (f.accuracy > MAX_ACCURACY_M) return { record: r, accepted: false, reason: "accuracy" };
  const seg = r.segments[r.segments.length - 1] ?? [];
  const last = seg[seg.length - 1];
  // lastFixAt이 없는 이전 저장 형식도 복원할 수 있다. 재개 직후의 캐시 위치도 거절한다.
  const lastFixAt = r.lastFix?.time ?? r.lastFixAt ?? last?.time;
  if (f.time < r.resumedAt || (lastFixAt !== undefined && f.time <= lastFixAt)) {
    return { record: r, accepted: false, reason: "timestamp" };
  }
  const gap = last !== undefined && f.time - (lastFixAt ?? last.time) > MAX_FIX_GAP_MS;
  const point = { lat: f.lat, lon: f.lon, time: f.time };
  let add = 0;
  if (last && !gap) {
    add = haversineMeters({ lat: last.lat, lon: last.lon }, { lat: f.lat, lon: f.lon });
    // 오래 정지한 시간을 나눗셈에 포함하면 직후의 큰 GPS 튐이 정상 속도로 보인다.
    const previous = r.lastFix ?? last;
    const dt = (f.time - previous.time) / 1000;
    if (haversineMeters({ lat: previous.lat, lon: previous.lon }, { lat: f.lat, lon: f.lon }) / dt > MAX_SPEED_MS) return { record: r, accepted: false, reason: "jump" };
    if (add < 3) return { record: { ...r, lastFixAt: f.time, lastFix: point }, accepted: false, reason: "still" };
  }
  const segments = gap
    ? [...r.segments, [point]]
    : r.segments.slice(0, -1).concat([[...seg, point]]);
  return { record: { ...r, segments, distanceMeters: r.distanceMeters + add, lastFixAt: f.time, lastFix: point }, accepted: true };
}

export function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** 음성 안내용 시간 ("1시간 2분 5초") */
export function spokenDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h && `${h}시간`, m && `${m}분`, (sec || !(h || m)) && `${sec}초`].filter(Boolean).join(" ");
}

/** 페이스 (분:초 /km) */
export function formatPace(ms: number, meters: number) {
  if (meters < 50) return "-'--\"";
  const secPerKm = ms / 1000 / (meters / 1000);
  if (!Number.isFinite(secPerKm) || secPerKm > 3600) return "-'--\"";
  return `${Math.floor(secPerKm / 60)}'${String(Math.round(secPerKm % 60)).padStart(2, "0")}"`;
}

// ───────────────────────── GPX 내보내기 ─────────────────────────

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

export function toGpx(name: string, segments: Array<Array<{ lat: number; lon: number; time?: number }>>): string {
  const segXml = segments
    .filter((s) => s.length)
    .map(
      (s) =>
        `<trkseg>${s.map((p) => `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">${p.time !== undefined ? `<time>${new Date(p.time).toISOString()}</time>` : ""}</trkpt>`).join("")}</trkseg>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Yorun" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${esc(name)}</name>${segXml}</trk></gpx>\n`;
}
