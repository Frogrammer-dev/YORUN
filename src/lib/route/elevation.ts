// 코스 고도: 코스 위 최대 60점의 높이를 Open-Meteo 고도 API(Copernicus DEM, 약 90m 해상도)로 받아 오르막을 계산한다.
// 지도 길 데이터와 달리 코스 좌표가 외부 서버로 전송되므로, 사용자가 코스를 골랐을 때만 요청한다.

export interface ElevationProfile {
  /** 출발점부터 거리 (m) */
  dist: number[];
  /** 높이 (m) */
  elev: number[];
  /** 오르막 합계 (m) */
  ascent: number;
  min: number;
  max: number;
}

const ENDPOINT = "https://api.open-meteo.com/v1/elevation";

function meters(a: [number, number], b: [number, number]): number {
  const k = Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * 111_195, (a[1] - b[1]) * 111_195 * k);
}

/** 거리 기준으로 고르게 n개 점 */
export function sampleAlong(latlngs: [number, number][], n = 100): { pts: [number, number][]; dist: number[] } {
  const cum = [0];
  for (let i = 1; i < latlngs.length; i++) cum.push(cum[i - 1] + meters(latlngs[i - 1], latlngs[i]));
  const total = cum[cum.length - 1];
  const pts: [number, number][] = [], dist: number[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const d = (total * k) / (n - 1);
    while (j < cum.length - 1 && cum[j] < d) j++;
    const seg = cum[j] - cum[j - 1] || 1;
    const t = Math.max(0, Math.min(1, (d - cum[j - 1]) / seg));
    const a = latlngs[j - 1], b = latlngs[j] ?? a;
    pts.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    dist.push(d);
  }
  return { pts, dist };
}

export type SlopeKind = "up" | "flat" | "down";
export interface SlopeSegment { kind: SlopeKind; latlngs: [number, number][]; meters: number }

/** 경사 구분 기준: 이 이상 오르면 오르막, 이 이상 내려가면 내리막 (%) */
export const SLOPE_THRESHOLD = 4;
/** 고도 자료가 약 90m 격자라 짧은 구간 경사는 잡음이 크다: 이 거리 이상으로 묶어 잰다 */
const SLOPE_WINDOW_M = 120;

/** 코스를 고도 그래프에 맞춰 오르막·평지·내리막 구간으로 나눈다 (지도 선 색칠용) */
export function slopeSegments(latlngs: [number, number][], p: Pick<ElevationProfile, "dist" | "elev">): SlopeSegment[] {
  if (latlngs.length < 2 || p.dist.length < 2) return [];
  const cum = [0];
  for (let i = 1; i < latlngs.length; i++) cum.push(cum[i - 1] + meters(latlngs[i - 1], latlngs[i]));
  const total = cum[cum.length - 1];
  const at = (d: number): [number, number] => {
    let j = 1;
    while (j < cum.length - 1 && cum[j] < d) j++;
    const t = Math.max(0, Math.min(1, (d - cum[j - 1]) / (cum[j] - cum[j - 1] || 1)));
    const a = latlngs[j - 1], b = latlngs[j];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  // 고도 점 사이 구간마다, 앞뒤로 SLOPE_WINDOW_M 이상 떨어진 점으로 경사를 잰다
  const kinds: { from: number; to: number; kind: SlopeKind }[] = [];
  for (let i = 0; i < p.dist.length - 1; i++) {
    const mid = (p.dist[i] + p.dist[i + 1]) / 2;
    let a = i, b = i + 1;
    while (p.dist[b] - p.dist[a] < SLOPE_WINDOW_M && (a > 0 || b < p.dist.length - 1)) {
      if (a > 0 && (b === p.dist.length - 1 || mid - p.dist[a - 1] <= p.dist[b + 1] - mid)) a--;
      else b++;
    }
    const grade = ((p.elev[b] - p.elev[a]) / Math.max(1, p.dist[b] - p.dist[a])) * 100;
    const kind: SlopeKind = grade >= SLOPE_THRESHOLD ? "up" : grade <= -SLOPE_THRESHOLD ? "down" : "flat";
    const last = kinds[kinds.length - 1];
    if (last && last.kind === kind) last.to = p.dist[i + 1];
    else kinds.push({ from: p.dist[i], to: p.dist[i + 1], kind });
  }
  // 꼭대기·바닥처럼 묶음 길이보다 짧은 조각은 앞 구간에 합친다 (지도에서 잡음처럼 깜빡이지 않게)
  for (let i = 1; i < kinds.length; ) {
    if (kinds[i].to - kinds[i].from < SLOPE_WINDOW_M) {
      kinds[i - 1].to = kinds[i].to;
      kinds.splice(i, 1);
      if (i < kinds.length && kinds[i].kind === kinds[i - 1].kind) { kinds[i - 1].to = kinds[i].to; kinds.splice(i, 1); }
    } else i++;
  }
  // 고도 거리와 코스 거리가 조금 달라도 끝까지 덮는다
  kinds[0].from = 0;
  kinds[kinds.length - 1].to = total;
  return kinds.map(({ from, to, kind }) => {
    const inner = latlngs.filter((_, i) => cum[i] > from && cum[i] < to);
    return { kind, meters: Math.round(to - from), latlngs: [at(from), ...inner, at(to)] };
  });
}

/** 높이 목록 → 오르막 합계. 고도 자료의 잔물결(±hysteresis m)은 오르막으로 세지 않는다 */
export function ascentOf(elev: number[], hysteresis = 2): number {
  let up = 0, ref = elev[0];
  for (const e of elev) {
    if (e > ref + hysteresis) {
      up += e - ref;
      ref = e;
    } else if (e < ref - hysteresis) ref = e;
  }
  return Math.round(up);
}

// Open-Meteo는 분당 요청 한도가 있다(좌표 수만큼 무겁게 센다). 후보 여러 개를 한꺼번에 물으면 429가 나므로
// 요청을 하나씩 차례로 보내고, 한도에 걸리면 기다렸다가 다시 묻는다 (한도는 1분 단위로 풀린다).
let queue: Promise<unknown> = Promise.resolve();

export function fetchElevation(latlngs: [number, number][], signal?: AbortSignal, retryMs = 15_000): Promise<ElevationProfile> {
  const run = queue.then(() => fetchOnce(latlngs, signal, retryMs));
  queue = run.catch(() => undefined);
  return run;
}

async function fetchOnce(latlngs: [number, number][], signal: AbortSignal | undefined, retryMs: number): Promise<ElevationProfile> {
  // 고도 자료가 약 90m 간격이라 60점(8km 코스면 약 130m 간격)으로도 오르막 합계에 충분하다
  const { pts, dist } = sampleAlong(latlngs, Math.min(60, Math.max(2, latlngs.length)));
  const url = `${ENDPOINT}?latitude=${pts.map((p) => p[0].toFixed(5)).join(",")}&longitude=${pts.map((p) => p[1].toFixed(5)).join(",")}`;
  let res = await fetch(url, { signal });
  for (let attempt = 0; res.status === 429 && attempt < 4; attempt++) {
    await new Promise((ok) => setTimeout(ok, retryMs));
    res = await fetch(url, { signal });
  }
  if (!res.ok) throw new Error(`elevation_${res.status}`);
  const j = (await res.json()) as { elevation?: number[] };
  const elev = j.elevation;
  if (!Array.isArray(elev) || elev.length !== pts.length || elev.some((e) => !Number.isFinite(e))) throw new Error("elevation_bad_data");
  return { dist, elev, ascent: ascentOf(elev), min: Math.min(...elev), max: Math.max(...elev) };
}
