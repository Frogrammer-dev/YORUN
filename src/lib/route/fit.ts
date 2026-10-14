// 드로잉 러닝 루트 탐색 (명세 15.1)
// 1) 그림 모양을 영역 안에 여러 위치·크기·각도로 놓아 보고, 실제 길과 얼마나 겹치는지 빠르게 추정
// 2) 유망한 배치만 골라, 모양의 기준점을 가까운 교차점에 붙이고 기준점 사이를 '모양 선분을 따라가는' A*로 연결
// 3) 연결된 한붓 경로만 후보로 남기고, 유사도·반복 구간·거리로 순위를 매긴다
// 경로를 찾지 못한 구간을 직선으로 메우거나 가짜 연결선을 만들지 않는다.

import { PathFinder, pointSegDist, roadStats, unproject, type RoadGraph, type RoadStats } from "./graph";
import { SHAPE_BY_ID, anchorsOf, polylineLength, resample, type ShapeDef, type ShapeId, type ShapeKey } from "./shapes";
import { rdpIndices } from "@/lib/art/rdp";
import { buildFlexPath, refitPlacement } from "./flex";
import { budgetOf, type Budget } from "./budget";
import type { ParsedRoadReferenceProposal } from "@/lib/art/roadReference";

/** 품질 조정값. 부산 광안리·서면, 서울 강남 실제 OSM 데이터 평가로 정했다 (tests/eval-quality.test.ts). */
export const TUNING = {
  /** 꺾임 1회(90°)를 몇 m 우회와 같게 볼지 */
  turnCost: 30,
  /** 모양 선분에서 벗어나는 데 대한 벌점 가중치 */
  guideWeight: 1.5,
  /** 1km당 불필요한 급회전 1회의 비용 */
  jagCost: 0.006,
  /** 특징점(귀·꼭짓점) 누락 비율의 비용 */
  featureCost: 0.3,
  /** 그림과 무관한 U턴(가시) 1개의 비용 */
  spikeCost: 0.03,
};

/** 급회전(45° 이상)·U턴(150° 이상) 수 (tol m 단순화 후) */
export function turnStats(pts: XY[], tol = 10): { sharp: number; uturn: number } {
  const keep = rdpIndices(pts, tol);
  let sharp = 0, uturn = 0;
  for (let k = 1; k < keep.length - 1; k++) {
    const a = pts[keep[k - 1]], b = pts[keep[k]], c = pts[keep[k + 1]];
    let d = ((Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) >= 45) sharp++;
    if (Math.abs(d) >= 150) uturn++;
  }
  return { sharp, uturn };
}

export interface Region {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Placement {
  cx: number;
  cy: number;
  /** 모양 1단위 = scale 미터 (모양의 긴 변 길이) */
  scale: number;
  rotDeg: number;
}

export interface RouteCandidate {
  id: string;
  shapeId: ShapeKey;
  shapeName: string;
  placement: Placement;
  /** 달릴 전체 경로 (여러 획 그림이면 그림 사이 이동 구간 포함) */
  latlngs: [number, number][];
  /** 원래 그림 외곽선 (여러 획 그림이면 첫 획) */
  outline: [number, number][];
  /** 원래 그림 외곽선 전체 (획마다 하나) */
  outlines: [number, number][][];
  /** latlngs 중 그림이 아닌 이동 구간 [시작, 끝] 인덱스 (끝 포함). 한붓 그림이면 빈 배열 */
  moves: Array<[number, number]>;
  /** 그림을 그리는 거리 (이동 구간 제외) */
  lengthMeters: number;
  /** 그림 사이 이동 거리 */
  moveMeters: number;
  /** 지나는 길의 성격 (큰 차도·비포장·가로등·계단) */
  roadInfo: RoadStats;
  /** 낙서 인식 모델이 붙인 이름 (Quick, Draw! 갈래 이름과 확률) */
  doodle?: { name: string; prob: number; model?: "clip"; margin?: number };
  /** Generated explanation only: never an original scoring outline or a runnable path. */
  semanticExplanation?: ParsedRoadReferenceProposal;
  /** 0~100. 경로가 모양 선에서 평균적으로 벗어난 정도(모양 크기 대비)로 계산 */
  similarity: number;
  meanDeviationMeters: number;
  maxDeviationMeters: number;
  /** 1km당 그림과 무관한 급회전 횟수 */
  zigzagPerKm: number;
  /** 그림과 무관한 U턴(가시) 수 */
  spikes: number;
  /** 귀·꼭짓점 같은 특징점이 코스에 담긴 비율 (0~1) */
  featureCoverage: number;
  /** 같은 길을 두 번 이상 지나는 거리 비율 */
  repeatRatio: number;
  /** (실험) 왕복 가지의 한 방향 길이 합 (m). 가지를 붙인 코스에만 있다 */
  branchMeters?: number;
  cost: number;
}

export interface FindOptions {
  /** 기본 그림 id 또는 직접 그린 그림 */
  shapes: Array<ShapeId | ShapeDef>;
  minMeters: number;
  maxMeters: number;
  region: Region;
  /** 시간 예산(ms). budget을 주면 무시 */
  timeBudgetMs?: number;
  /** 탐색 예산 (테스트는 단계 예산으로 결정적 결과) */
  budget?: Budget;
  resultsPerShape?: number;
  method?: FitMethod;
  onProgress?: (fraction: number, label: string) => void;
}

export interface FindResult {
  candidates: RouteCandidate[];
  partial: boolean;
  evaluated: number;
  /** 낙서 인식으로 이름을 붙여 볼 후보 코스 (동네 추천). 화면 쪽에서 모델로 판정한다 */
  pool?: RouteCandidate[];
}

/** 경로 길이 ≈ 모양 둘레 × 이 비율 (격자 길을 따라가며 생기는 우회) */
const DETOUR = 1.2;
/** 탐색 칸 한 변(m)과 칸마다 실제로 연결해 볼 배치 수 */
const TILE = 4500;
const TOP_PER_TILE = 28;

type XY = [number, number];

export function placeShape(points: readonly (readonly [number, number])[], p: Placement): XY[] {
  const r = (p.rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return points.map(([x, y]) => [p.cx + p.scale * (x * c - y * s), p.cy + p.scale * (x * s + y * c)]);
}

function inside(pts: XY[], r: Region) {
  return pts.every(([x, y]) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY);
}

export function tolerance(scale: number) {
  return Math.min(60, Math.max(15, scale * 0.06));
}

function distToPolyline(px: number, py: number, line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const d = pointSegDist(px, py, line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]);
    if (d < best) best = d;
  }
  return best;
}

function samplesAlong(line: XY[], step: number): XY[] {
  const n = Math.max(8, Math.round(polylineLength(line) / step));
  return resample(line, n);
}

/** A→B→A 형태의 짧은 되돌이(스냅으로 생긴 가시)를 제거. 경로 연결성은 유지된다. */
export function removeSpurs(path: number[]): number[] {
  const out: number[] = [];
  for (const v of path) {
    if (out.length >= 2 && out[out.length - 2] === v) {
      out.pop();
      continue;
    }
    if (out.length && out[out.length - 1] === v) continue;
    out.push(v);
  }
  return out;
}

export interface Evaluated {
  path: number[];
  lengthMeters: number;
  repeatRatio: number;
  meanDev: number;
  maxDev: number;
  similarity: number;
  zigzagPerKm: number;
  /** 그림과 무관한 U턴(가시) 수 */
  spikes: number;
  featureCoverage: number;
  cost: number;
  /** 코스에 다시 맞춘 모양 배치 (평가 기준) */
  fit?: Placement;
}

/** 기준점을 길에 붙이고 기준점 사이를 모양 선분을 따라가는 A*로 잇는다. 하나라도 못 이으면 null. */
function buildPath(g: RoadGraph, finder: PathFinder, shape: ShapeDef, p: Placement): number[] | null {
  const T = tolerance(p.scale);
  const anchors = placeShape(anchorsOf(shape, 40), p);
  const snapped: number[] = [];
  for (const [x, y] of anchors) {
    const v = g.nodeIndex.nearest(x, y, T * 3);
    if (v < 0) return null;
    snapped.push(v);
  }
  const path: number[] = [snapped[0]];
  for (let i = 1; i < snapped.length; i++) {
    const a = snapped[i - 1], b = snapped[i];
    if (a === b) continue;
    const before = path.length >= 2 ? path[path.length - 2] : -1;
    const seg = finder.route(
      a,
      b,
      { ax: anchors[i - 1][0], ay: anchors[i - 1][1], bx: anchors[i][0], by: anchors[i][1], tol: T, weight: TUNING.guideWeight },
      25_000,
      TUNING.turnCost,
      before,
    );
    if (!seg) return null;
    for (let k = 1; k < seg.length; k++) path.push(seg[k]);
  }
  const clean = cutThinSpikes(g, finder, cleanClosedLoop(path));
  return clean.length < 4 ? null : clean;
}

/**
 * 닫힌 코스는 어디서 출발해도 같은 그림이다. 출발점이 모양 밖 교차점에 붙으면
 * ‘나갔다 같은 길로 돌아오는’ 막대가 시작·끝에 걸쳐 남으므로, 출발점을 코스 중간으로 옮긴 뒤 되돌이를 정리한다.
 */
export function cleanClosedLoop(path: number[]): number[] {
  let p = removeSpurs(path);
  if (p.length < 4 || p[0] !== p[p.length - 1]) return p;
  const loop = p.slice(0, -1);
  const mid = Math.floor(loop.length / 2);
  const rotated = [...loop.slice(mid), ...loop.slice(0, mid)];
  p = removeSpurs([...rotated, rotated[0]]);
  return p;
}

/**
 * 얇은 돌출(막대): 나갔다가 30m 이내로 돌아오는데 감싼 면적이 거의 없는 구간.
 * 나란한 두 길(왕복 차로·도로+보행로)로 나갔다 돌아오면 U턴 없이도 막대가 생긴다.
 * 그림의 특징(귀·꼭짓점)은 모양 크기의 8% 이상 폭이 있으므로 이런 구간은 특징이 될 수 없다.
 */
export function findThinSpikes(xy: XY[]): Array<{ i: number; j: number; along: number }> {
  const n = xy.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  const maxLoop = Math.min(600, cum[n - 1] * 0.15);
  const out: Array<{ i: number; j: number; along: number }> = [];
  let i = 0;
  while (i < n - 2) {
    let found = -1, foundAlong = 0;
    // 면적(신발끈 공식)을 j를 늘리며 누적 계산. 조건을 만족하는 가장 먼(긴) j를 고른다.
    let s = 0;
    for (let j = i + 1; j < n && cum[j] - cum[i] <= maxLoop; j++) {
      s += xy[j - 1][0] * xy[j][1] - xy[j][0] * xy[j - 1][1];
      const along = cum[j] - cum[i];
      if (j < i + 2 || along < 50) continue;
      if (Math.hypot(xy[i][0] - xy[j][0], xy[i][1] - xy[j][1]) > 30) continue;
      const area = Math.abs(s + xy[j][0] * xy[i][1] - xy[i][0] * xy[j][1]) / 2;
      // 평균 폭 ≈ 면적 / (길이/2). 25m 미만이면 얇은 막대
      if (area / (along / 2) < 25) {
        found = j;
        foundAlong = along;
      }
    }
    if (found > 0) {
      out.push({ i, j: found, along: foundAlong });
      i = found;
    } else i++;
  }
  return out;
}

/** 얇은 막대를 시작·끝 사이 최단 길로 바꾼다 (비용과 무관하게 항상 제거). */
export function cutThinSpikes(g: RoadGraph, finder: PathFinder, path: number[]): number[] {
  let cur = path;
  let seamChecked = false;
  for (let round = 0; round < 8; round++) {
    const xy: XY[] = cur.map((v) => [g.x[v], g.y[v]]);
    const sp = findThinSpikes(xy);
    if (!sp.length) {
      // 닫힌 코스의 시작·끝 이음매에 걸친 막대는 직선 탐색에 안 잡히므로 출발점을 옮겨 한 번 더 본다
      if (seamChecked || cur[0] !== cur[cur.length - 1]) return cur;
      seamChecked = true;
      const loop = cur.slice(0, -1);
      const mid = Math.floor(loop.length / 2);
      cur = [...loop.slice(mid), ...loop.slice(0, mid), loop[mid]];
      continue;
    }
    let changed = false;
    // 뒤에서부터 잘라야 앞쪽 인덱스가 유지된다
    for (const { i, j } of sp.sort((a, b) => b.i - a.i)) {
      const sub = finder.route(cur[i], cur[j], undefined, 4_000, TUNING.turnCost, i > 0 ? cur[i - 1] : -1);
      if (!sub) continue;
      cur = [...cur.slice(0, i), ...sub, ...cur.slice(j + 1)];
      changed = true;
    }
    cur = cleanClosedLoop(cur);
    if (!changed) return cur;
  }
  return cur;
}

/**
 * 가시 제거: 코스가 한 지점에서 나갔다가 거의 같은 곳(40m 이내)으로 돌아오는 구간을 짧은 길로 바꾼다.
 * 바꾼 결과의 비용이 낮아질 때만 받아들인다 (고양이 귀처럼 필요한 돌출은 특징점 비용 때문에 남는다).
 */
function removeSpikes(g: RoadGraph, finder: PathFinder, shape: ShapeDef, p: Placement, ev: Evaluated, minM: number, maxM: number): Evaluated {
  let best = ev;
  const tried = new Set<string>();
  for (let round = 0; round < 6; round++) {
    const path = best.path;
    const n = path.length;
    const cum = new Float64Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(g.x[path[i]] - g.x[path[i - 1]], g.y[path[i]] - g.y[path[i - 1]]);
    const maxLoop = Math.min(900, cum[n - 1] * 0.2);
    const cands: Array<{ i: number; j: number; gain: number }> = [];
    for (let i = 1; i < n - 2; i++) {
      let bestJ = -1, bestGain = 0;
      for (let j = i + 2; j < n - 1 && cum[j] - cum[i] <= maxLoop; j++) {
        const d = Math.hypot(g.x[path[i]] - g.x[path[j]], g.y[path[i]] - g.y[path[j]]);
        const along = cum[j] - cum[i];
        if (d <= 40 && along >= 3 * d + 60 && along - d > bestGain) {
          bestGain = along - d;
          bestJ = j;
        }
      }
      if (bestJ > 0) cands.push({ i, j: bestJ, gain: bestGain });
    }
    cands.sort((a, b) => b.gain - a.gain);
    let improved = false;
    for (const c of cands.slice(0, 4)) {
      const key = `${path[c.i]}-${path[c.j]}`;
      if (tried.has(key)) continue;
      tried.add(key);
      const sub = finder.route(path[c.i], path[c.j], undefined, 8_000, TUNING.turnCost, path[c.i - 1]);
      if (!sub) continue;
      const np = cutThinSpikes(g, finder, cleanClosedLoop([...path.slice(0, c.i), ...sub, ...path.slice(c.j + 1)]));
      if (np.length < 4) continue;
      const e = evaluatePath(g, shape, p, np, minM, maxM);
      if (e.cost < best.cost) {
        e.fit = best.fit;
        best = e;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }
  return best;
}

/**
 * 배치 하나를 실제 길 위 경로로 만들고 평가. 연결 불가면 null.
 * 가시 제거는 비용이 커서 최종 후보에만 적용한다(cleanSpikes).
 */
export function routePlacement(
  g: RoadGraph,
  finder: PathFinder,
  shape: ShapeDef,
  p: Placement,
  minM: number,
  maxM: number,
  cleanSpikes = false,
  method: FitMethod = "flex",
): Evaluated | null {
  let path: number[] | null = null;
  let fit = p;
  const r = method === "flex" ? buildFlexPath(g, shape, p) : null;
  if (r) {
    path = cutThinSpikes(g, finder, cleanClosedLoop(r.path));
    // 휘어진 코스에 모양을 다시 맞춰(이동·회전·균일 확대만) 그 기준으로 닮음을 잰다
    const refit = refitPlacement(r.pairs);
    // 다시 맞춘 모양이 크게 돌아갔다면 그림이 뒤틀린 것이다 (예: 위를 향한 세모가 옆으로 누움)
    let turn = Math.abs(refit.rotDeg - p.rotDeg) % 360;
    if (turn > 180) turn = 360 - turn;
    if (path.length >= 4 && turn <= 30) fit = refit;
    else path = null;
  }
  // 교차점이 드문 곳 등 유연하게 잇지 못하면 고정된 틀을 따라 잇는다
  if (!path) path = buildPath(g, finder, shape, p);
  if (!path) return null;
  const ev = { ...evaluatePath(g, shape, fit, path, minM, maxM), fit };
  return cleanSpikes ? removeSpikes(g, finder, shape, fit, ev, minM, maxM) : ev;
}

/** flex: 기준점을 근처 교차점 중에서 함께 골라 자연스럽게 잇기, rigid: 고정된 틀을 따라 잇기 */
export type FitMethod = "flex" | "rigid";

/** 동네 도로가 주로 뻗은 방향(도, -45~45). 바둑판 도로에 그림을 맞춰 놓으면 계단 모양이 줄어든다. */
export function dominantGridAngle(g: RoadGraph): number {
  const hist = new Float64Array(90);
  for (let a = 0; a < g.n; a++) {
    for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) {
      const b = g.adjTo[k];
      if (b < a) continue;
      const dx = g.x[b] - g.x[a], dy = g.y[b] - g.y[a];
      const len = Math.hypot(dx, dy);
      if (len < 5) continue;
      const deg = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 90) + 90) % 90;
      hist[Math.floor(deg) % 90] += len;
    }
  }
  let bestBin = 0, bestVal = -1;
  for (let i = 0; i < 90; i++) {
    let v = 0;
    for (let d = -3; d <= 3; d++) v += hist[(i + d + 90) % 90];
    if (v > bestVal) {
      bestVal = v;
      bestBin = i;
    }
  }
  const ang = bestBin + 0.5;
  return ang > 45 ? ang - 90 : ang;
}

/** 경로 평가: 길이·반복·양방향 이탈·지그재그·U턴(가시)·특징점 보존 → 표시 유사도와 순위 비용 */
export function evaluatePath(g: RoadGraph, shape: ShapeDef, p: Placement, path: number[], minM: number, maxM: number): Evaluated {
  // 길이·반복
  let length = 0;
  const used = new Map<number, number>();
  let repeated = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);
    length += d;
    const key = a < b ? a * 4_000_000 + b : b * 4_000_000 + a;
    const c = (used.get(key) ?? 0) + 1;
    used.set(key, c);
    if (c > 1) repeated += d;
  }

  // 유사도: 경로→모양, 모양→경로 양방향 평균 이탈
  const outline = placeShape(shape.points, p);
  const routeXY: XY[] = path.map((v) => [g.x[v], g.y[v]]);
  const rs = samplesAlong(routeXY, 12);
  let d1 = 0, maxDev = 0;
  for (const [x, y] of rs) {
    const d = distToPolyline(x, y, outline);
    d1 += d;
    if (d > maxDev) maxDev = d;
  }
  d1 /= rs.length;
  const ss = samplesAlong(outline, 12);
  let d2 = 0;
  for (const [x, y] of ss) {
    const d = distToPolyline(x, y, routeXY);
    d2 += d;
    if (d > maxDev) maxDev = d;
  }
  d2 /= ss.length;
  const meanDev = (d1 + d2) / 2;

  // 지그재그: 그림 자체의 꼭짓점 수를 넘는 급회전, 가시: 그림에 없는 U턴
  const shapeT = turnStats(outline, p.scale * 0.01);
  const routeT = turnStats(routeXY);
  const zigzagPerKm = Math.max(0, routeT.sharp - shapeT.sharp) / Math.max(0.5, length / 1000);
  const spikes = Math.max(0, routeT.uturn - shapeT.uturn) + findThinSpikes(routeXY).length;
  // 특징점 보존: 귀 끝·별 끝이 코스에서 모양 크기의 8% 안에 있어야 한다
  const feats = placeShape(shape.features, p);
  const hit = feats.filter(([x, y]) => distToPolyline(x, y, routeXY) <= 0.08 * p.scale).length;
  const featureCoverage = feats.length ? hit / feats.length : 1;

  // 표시용 유사도: 평균 이탈 × 특징점 보존 × 매끄러움 × 가시 (사람이 보는 ‘닮음’에 가깝게)
  const similarity = Math.round(
    (100 * Math.exp(-meanDev / (0.08 * p.scale)) * (0.55 + 0.45 * featureCoverage) * Math.pow(0.9, spikes)) / (1 + 0.03 * zigzagPerKm),
  );

  const repeatRatio = length > 0 ? repeated / length : 1;
  const lengthRatio = length / (shape.perimeter * p.scale);
  let cost =
    meanDev / p.scale +
    0.35 * repeatRatio +
    0.6 * Math.max(0, lengthRatio - 1.35) +
    TUNING.jagCost * zigzagPerKm +
    TUNING.spikeCost * spikes +
    TUNING.featureCost * (1 - featureCoverage);
  if (length < minM) cost += 0.5 * (minM - length) / minM;
  if (length > maxM) cost += 0.5 * (length - maxM) / maxM;
  return { path, lengthMeters: length, repeatRatio, meanDev, maxDev, similarity, zigzagPerKm, spikes, featureCoverage, cost };
}

/**
 * 영역 전체의 '가장 가까운 길까지 거리' 격자. 빠른 추정 단계에서 수백만 번 필요한 거리 계산을
 * 칸 하나 조회로 바꾼다 (칸 크기만큼의 오차는 추정 단계에서만 쓰므로 허용).
 */
export class DistanceField {
  private w: number;
  private h: number;
  private data: Float32Array;
  constructor(g: RoadGraph, private r: Region, private cell = 15, private cap = 200) {
    this.w = Math.ceil((r.maxX - r.minX) / cell) + 1;
    this.h = Math.ceil((r.maxY - r.minY) / cell) + 1;
    this.data = new Float32Array(this.w * this.h);
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < this.w; i++) this.data[j * this.w + i] = g.edgeIndex.distance(r.minX + (i + 0.5) * cell, r.minY + (j + 0.5) * cell, cap);
  }
  get(x: number, y: number): number {
    const i = Math.floor((x - this.r.minX) / this.cell), j = Math.floor((y - this.r.minY) / this.cell);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return this.cap;
    return this.data[j * this.w + i];
  }
}

/** 결정적 의사 난수 (같은 지도·조건이면 같은 결과) */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function findRoutes(g: RoadGraph, opts: FindOptions): FindResult {
  const region = opts.region;
  const regionW = region.maxX - region.minX, regionH = region.maxY - region.minY;
  // 넓은 영역은 약 4.5km 칸으로 나눠 칸마다 같은 수의 배치를 실제로 연결해 본다.
  // (빠른 추정 점수는 대략적이라, 영역 전체에서 상위만 고르면 좋은 자리를 놓친다)
  const tilesX = Math.max(1, Math.round(regionW / TILE)), tilesY = Math.max(1, Math.round(regionH / TILE));
  const tiles = tilesX * tilesY;
  const budget = budgetOf(opts, Math.min(75_000, 35_000 * tiles));
  const perShape = opts.resultsPerShape ?? 3;
  const method = opts.method ?? "flex";
  const finder = new PathFinder(g);
  const all: RouteCandidate[] = [];
  let evaluated = 0;
  let partial = false;
  // 넓은 영역에서는 격자 칸을 키워 계산량을 묶는다 (빠른 추정 단계 전용)
  const field = new DistanceField(g, region, Math.max(15, Math.max(regionW, regionH) / 450));
  const gridAngle = dominantGridAngle(g);

  opts.shapes.forEach((sid, si) => {
    const shape = typeof sid === "string" ? SHAPE_BY_ID[sid] : sid;
    const report = (f: number) => opts.onProgress?.((si + f) / opts.shapes.length, shape.name);
    report(0);
    if (!budget.ok()) {
      partial = true;
      return;
    }

    // 1) 크기 후보: 목표 거리 범위 → 모양 크기
    const sMin = opts.minMeters / (DETOUR * shape.perimeter);
    const sMax = Math.min(opts.maxMeters / (DETOUR * shape.perimeter), Math.min(regionW, regionH) * 0.98);
    if (sMax < Math.max(sMin, 120)) return; // 화면 영역이 이 거리의 그림을 담기에 작음
    const scales: number[] = [];
    const lo = Math.max(sMin, 120);
    for (let k = 0; k < 4; k++) scales.push(lo * Math.pow(sMax / lo, k / 3));
    const rots = shape.rotationFree
      ? [0]
      : [...new Set([-30, -15, 0, 15, 30, gridAngle - 15, gridAngle, gridAngle + 15].map((r) => Math.round(Math.max(-45, Math.min(45, r)))))];
    const coarseSamples = resample(shape.points, 48);

    // 2) 빠른 추정: 모양 표본점에서 가장 가까운 길까지의 거리
    const coarse: Array<{ p: Placement; c: number }> = [];
    for (const scale of scales) {
      const T = tolerance(scale);
      const step = Math.max(60, scale * 0.12);
      for (const rotDeg of rots) {
        for (let cx = region.minX + scale * 0.35; cx <= region.maxX - scale * 0.35; cx += step) {
          for (let cy = region.minY + scale * 0.35; cy <= region.maxY - scale * 0.35; cy += step) {
            const p = { cx, cy, scale, rotDeg };
            const pts = placeShape(coarseSamples, p);
            if (!inside(pts, region)) continue;
            let c = 0;
            for (const [x, y] of pts) c += Math.min(field.get(x, y), 3 * T);
            coarse.push({ p, c: c / pts.length / T });
          }
        }
      }
    }
    coarse.sort((a, b) => a.c - b.c);
    report(0.3);

    // 3) 칸마다 상위 배치만 실제 경로로 연결·평가 (칸 순서를 섞어 시간이 모자라도 한쪽에 치우치지 않게)
    const perTile: Array<typeof coarse> = Array.from({ length: tiles }, () => []);
    for (const t of coarse) {
      const tx = Math.min(tilesX - 1, Math.floor(((t.p.cx - region.minX) / regionW) * tilesX));
      const ty = Math.min(tilesY - 1, Math.floor(((t.p.cy - region.minY) / regionH) * tilesY));
      const bucket = perTile[ty * tilesX + tx];
      if (bucket.length < TOP_PER_TILE) bucket.push(t);
    }
    const top: typeof coarse = [];
    for (let k = 0; k < TOP_PER_TILE; k++) for (const bucket of perTile) if (bucket[k]) top.push(bucket[k]);
    const scored: Array<{ p: Placement; e: Evaluated }> = [];
    top.forEach((t, i) => {
      if (!budget.ok()) {
        partial = true;
        return;
      }
      const e = routePlacement(g, finder, shape, t.p, opts.minMeters, opts.maxMeters, false, method);
      budget.spend();
      evaluated++;
      if (e) scored.push({ p: e.fit ?? t.p, e });
      report(0.3 + (0.5 * (i + 1)) / top.length);
    });
    scored.sort((a, b) => a.e.cost - b.e.cost);

    // 4) 상위 몇 개를 조금씩 움직여 다듬기
    const rand = rng(Math.round(region.minX * 7 + region.minY * 13) ^ (si + 1) * 2654435761);
    const refineN = 4 * tiles;
    const refined = scored.slice(0, refineN).map((s) => {
      let best = s;
      for (let k = 0; k < 10; k++) {
        if (!budget.ok()) {
          partial = true;
          break;
        }
        const p: Placement = {
          cx: best.p.cx + (rand() - 0.5) * 0.12 * best.p.scale,
          cy: best.p.cy + (rand() - 0.5) * 0.12 * best.p.scale,
          scale: best.p.scale * (0.93 + rand() * 0.14),
          rotDeg: shape.rotationFree ? 0 : best.p.rotDeg + (rand() - 0.5) * 12,
        };
        if (!inside(placeShape(shape.points, p), region)) continue;
        const e = routePlacement(g, finder, shape, p, opts.minMeters, opts.maxMeters, false, method);
        budget.spend();
        evaluated++;
        if (e && e.cost < best.e.cost) best = { p: e.fit ?? p, e };
      }
      return best;
    });
    // 상위 후보만 가시 제거 후 다시 순위를 매긴다
    const pool = [...refined, ...scored.slice(refineN)]
      .sort((a, b) => a.e.cost - b.e.cost)
      .map((s, i) => (i < 8 ? { p: s.p, e: removeSpikes(g, finder, shape, s.p, s.e, opts.minMeters, opts.maxMeters) } : s))
      .sort((a, b) => a.e.cost - b.e.cost);

    // 5) 서로 다른 위치의 후보만 남기기
    const chosen: typeof pool = [];
    for (const s of pool) {
      if (chosen.length >= perShape) break;
      if (chosen.some((c) => Math.hypot(c.p.cx - s.p.cx, c.p.cy - s.p.cy) < 0.4 * Math.max(c.p.scale, s.p.scale))) continue;
      chosen.push(s);
    }
    for (const s of chosen) all.push(toCandidate(g, shape, s.p, s.e));
    report(1);
  });

  all.sort((a, b) => a.cost - b.cost);
  return { candidates: all, partial, evaluated };
}

export function toCandidate(g: RoadGraph, shape: ShapeDef, p: Placement, e: Evaluated): RouteCandidate {
  const ll = (x: number, y: number) => unproject(g.origin, x, y).map((v) => Math.round(v * 1e7) / 1e7) as [number, number];
  const outline = placeShape(shape.points, p).map(([x, y]) => ll(x, y));
  return {
    id: `${shape.id}-${Math.round(p.cx)}-${Math.round(p.cy)}-${Math.round(p.scale)}-${Math.round(p.rotDeg)}`,
    shapeId: shape.id,
    shapeName: shape.name,
    placement: p,
    latlngs: e.path.map((v) => [Math.round(g.lat[v] * 1e7) / 1e7, Math.round(g.lon[v] * 1e7) / 1e7]),
    outline,
    outlines: [outline],
    moves: [],
    lengthMeters: Math.round(e.lengthMeters),
    moveMeters: 0,
    roadInfo: roadStats(g, e.path),
    similarity: e.similarity,
    meanDeviationMeters: Math.round(e.meanDev),
    maxDeviationMeters: Math.round(e.maxDev),
    repeatRatio: Math.round(e.repeatRatio * 1000) / 1000,
    zigzagPerKm: Math.round(e.zigzagPerKm * 10) / 10,
    spikes: e.spikes,
    featureCoverage: Math.round(e.featureCoverage * 100) / 100,
    cost: e.cost,
  };
}
