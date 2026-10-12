// 러닝 코스 찾기 (그림과 무관): 출발점 근처 동네 블록을 합친 고리 코스를 모으고, 출발점에서 고리까지 왕복을 붙여
// '출발점에서 출발해 출발점으로 돌아오는' 코스를 만든 뒤 길 쾌적도(큰 차도·차 없는 길·비포장·계단·터널·꺾임) 순으로 고른다.
// 길 조건 선호(차 없는 길 우선 등)는 그래프 비용에 이미 들어가 있어 왕복 구간 길찾기에도 반영된다.

import type { Budget } from "./budget";
import { overlap } from "./discover";
import type { FindResult, Region, RouteCandidate } from "./fit";
import { PathFinder, roadStats, type RoadGraph, type RoadStats } from "./graph";
import { buildBlocks, growLoops } from "./loops";

type XY = [number, number];

export interface RunCourseOptions {
  /** 출발점 (그래프 평면 좌표, m) */
  start: XY;
  minMeters: number;
  maxMeters: number;
  /** 고리를 찾을 영역 (출발점 둘레) */
  region: Region;
  budget: Budget;
  /** 켠 길 조건은 순위에서 더 무겁게 본다 (고리는 블록 단위라 길 비용만으로는 순위가 바뀌지 않는다) */
  prefs?: { avoidMajor?: boolean; preferCarFree?: boolean };
  maxResults?: number;
  onProgress?: (fraction: number, label: string) => void;
}

/** 1km당 60° 넘게 꺾는 횟수 (자주 꺾을수록 멈칫하는 구간이 많다) */
function turnsPerKm(g: RoadGraph, path: number[], meters: number): number {
  let turns = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const ax = g.x[path[i]] - g.x[path[i - 1]], ay = g.y[path[i]] - g.y[path[i - 1]];
    const bx = g.x[path[i + 1]] - g.x[path[i]], by = g.y[path[i + 1]] - g.y[path[i]];
    const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
    if (la < 1 || lb < 1) continue;
    if ((ax * bx + ay * by) / (la * lb) < 0.5) turns++;
  }
  return meters > 0 ? (turns * 1000) / meters : 0;
}

/** 쾌적하지 않은 정도 (0~1, 작을수록 좋음). 가중치는 잠정값 */
export function discomfort(r: RoadStats, turnsKm: number): number {
  return Math.min(1, 0.35 * r.major + 0.25 * (1 - r.carFree) + 0.2 * r.unpaved + 0.05 * Math.min(1, r.steps / 3) + 0.05 * Math.min(1, r.tunnels / 2) + 0.1 * Math.min(1, turnsKm / 10));
}

const pathLen = (g: RoadGraph, p: number[]) => {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(g.x[p[i]] - g.x[p[i - 1]], g.y[p[i]] - g.y[p[i - 1]]);
  return d;
};

export function findRunningCourses(g: RoadGraph, o: RunCourseOptions): FindResult | { error: "no_start" } {
  const startNode = g.nodeIndex.nearest(o.start[0], o.start[1], 400);
  if (startNode < 0) return { error: "no_start" };
  const r = o.region;
  o.onProgress?.(0.05, "동네 블록");
  const m = buildBlocks(g, ((r.maxX - r.minX) * (r.maxY - r.minY)) / 4);
  o.onProgress?.(0.15, "고리 코스");
  // 출발점까지 왕복할 거리만큼 짧은 고리도 모은다
  const loops = growLoops(g, m, r, o.minMeters * 0.5, o.maxMeters, { seeds: Math.min(m.faces.length, 600), budget: o.budget, fraction: 0.7 });

  o.onProgress?.(0.75, "출발점에서 잇기");
  const finder = new PathFinder(g);
  const stems = new Map<number, number[] | null>();
  const sx = g.x[startNode], sy = g.y[startNode];
  const scored: Array<{ c: RouteCandidate; rank: number }> = [];
  for (const loop of loops) {
    if (!o.budget.ok(0.95)) break;
    const ring = loop.path.slice(0, -1); // 닫힌 고리 (마지막 = 처음)
    let k = 0, best = Infinity;
    ring.forEach((v, i) => {
      const d = Math.hypot(g.x[v] - sx, g.y[v] - sy);
      if (d < best) [best, k] = [d, i];
    });
    if (best * 2 + loop.length > o.maxMeters) continue;
    const entry = ring[k];
    if (!stems.has(entry)) stems.set(entry, entry === startNode ? [startNode] : finder.route(startNode, entry, undefined, 60_000));
    const stem = stems.get(entry);
    if (!stem) continue;
    const full = [...stem, ...ring.slice(k + 1), ...ring.slice(0, k + 1), ...stem.slice(0, -1).reverse()];
    const stemM = pathLen(g, stem), total = loop.length + 2 * stemM;
    if (total < o.minMeters || total > o.maxMeters) continue;
    const info = roadStats(g, full);
    const bad = discomfort(info, turnsPerKm(g, full, total));
    const xs = full.map((v) => g.x[v]), ys = full.map((v) => g.y[v]);
    scored.push({
      // 출발점에서 고리까지 왕복이 길수록 같은 길을 되밟으니 조금 불리
      rank: bad + 0.6 * ((2 * stemM) / total) + (o.prefs?.avoidMajor ? 0.5 * info.major : 0) + (o.prefs?.preferCarFree ? 0.5 * (1 - info.carFree) : 0),
      c: {
        id: `run-${startNode}-${loop.faces.slice().sort((a, b) => a - b).join(".")}`,
        shapeId: "run",
        shapeName: "러닝",
        placement: { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, scale: Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)), rotDeg: 0 },
        latlngs: full.map((v) => [Math.round(g.lat[v] * 1e7) / 1e7, Math.round(g.lon[v] * 1e7) / 1e7]),
        outline: [],
        outlines: [],
        moves: [],
        lengthMeters: Math.round(total),
        moveMeters: 0,
        roadInfo: info,
        // 쾌적도 점수 (0~100)
        similarity: Math.round(100 * (1 - bad)),
        meanDeviationMeters: 0,
        maxDeviationMeters: 0,
        zigzagPerKm: 0,
        spikes: 0,
        featureCoverage: 1,
        repeatRatio: Math.round(((2 * stemM) / total) * 100) / 100,
        cost: bad,
      },
    });
  }
  scored.sort((a, b) => a.rank - b.rank);
  const out: RouteCandidate[] = [];
  for (const { c } of scored) {
    if (out.length >= (o.maxResults ?? 8)) break;
    if (out.some((d) => d.id === c.id || overlap(c, d))) continue;
    out.push(c);
  }
  o.onProgress?.(1, "");
  return { candidates: out, partial: !o.budget.ok(), evaluated: loops.length };
}
