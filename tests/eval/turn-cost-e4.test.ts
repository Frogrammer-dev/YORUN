// E4 꺾임 비용 생성 실험 (사전 등록: reports/turn-cost-20261111/protocol.md).
// E4_OUT=결과폴더 ROAD_DATA_DIR=도로폴더 로 실행한다. 사람·AI 판정이 아니라 기술 지표(J·유사도)만 잰다.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import type { RouteCandidate } from "@/lib/route/fit";
import { project, type RoadGraph } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { budgetSlice, improveRoutes } from "@/lib/route/qualitySearch";
import { readLocalRoads } from "@/lib/route/roadData.server";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

const OUT = process.env.E4_OUT ?? "";
const STEPS = 20000;
const REGIONS: [string, number, number][] = [["해운대", 35.169, 129.131], ["강남", 37.4979, 127.0276], ["둔산", 36.351, 127.385], ["세종", 36.48, 127.289], ["서면", 35.158, 129.06], ["광교", 37.288, 127.05]];
const SHAPES: ShapeId[] = ["heart", "star", "cat"];
const ARMS: [string, number][] = [["A", 0.03], ["B", 0.15], ["C", 0.3]];

type P = [number, number];
function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts;
  const [s, e] = [pts[0], pts[pts.length - 1]];
  const sx = e[0] - s[0], sy = e[1] - s[1], norm = Math.hypot(sx, sy);
  let best = -1, bi = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const rx = pts[i][0] - s[0], ry = pts[i][1] - s[1];
    const d = norm === 0 ? Math.hypot(rx, ry) : Math.abs(sx * ry - sy * rx) / norm;
    if (d > best) [best, bi] = [d, i];
  }
  if (best <= eps) return [s, e];
  const left = rdp(pts.slice(0, bi + 1), eps), right = rdp(pts.slice(bi), eps);
  return [...left.slice(0, -1), ...right];
}
const len = (xy: P[]) => xy.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - xy[i][0], p[1] - xy[i][1]), 0);
/** E1과 같은 정의: 실제 길이 / (외접 크기 4%로 단순화한 닫힌 길이) − 1 */
export function ripple(xy: P[]): number {
  const closed = Math.hypot(xy[0][0] - xy.at(-1)![0], xy[0][1] - xy.at(-1)![1]) > 1e-6 ? [...xy, xy[0]] : xy;
  const xs = closed.map((p) => p[0]), ys = closed.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pts = closed.slice(0, -1);
  let a = 0;
  let b = pts.reduce((bi, p, i) => (Math.hypot(p[0] - pts[a][0], p[1] - pts[a][1]) > Math.hypot(pts[bi][0] - pts[a][0], pts[bi][1] - pts[a][1]) ? i : bi), 0);
  a = pts.reduce((ai, p, i) => (Math.hypot(p[0] - pts[b][0], p[1] - pts[b][1]) > Math.hypot(pts[ai][0] - pts[b][0], pts[ai][1] - pts[b][1]) ? i : ai), 0);
  const order = [...pts.slice(a), ...pts.slice(0, a)];
  b = (b - a + pts.length) % pts.length;
  const first = rdp(order.slice(0, b + 1), 0.04 * size), second = rdp([...order.slice(b), order[0]], 0.04 * size);
  const simple = [...first.slice(0, -1), ...second];
  return len(closed) / len(simple) - 1;
}

function load(lat: number, lon: number) {
  const dLat = 1000 / 111_000, dLon = 1000 / (111_000 * Math.cos((lat * Math.PI) / 180));
  const bbox: BBox = { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
  const graph = graphFromOverpass(readLocalRoads(bbox), bbox, { excludeSteps: true });
  const [minX, minY] = project(graph.origin, bbox.south, bbox.west);
  const [maxX, maxY] = project(graph.origin, bbox.north, bbox.east);
  return { graph, region: { minX, minY, maxX, maxY } };
}
const meters = (g: RoadGraph, c: RouteCandidate): P[] => c.latlngs.map(([la, lo]) => project(g.origin, la, lo) as P);
const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };

it.skipIf(!OUT)("E4 꺾임 비용: 1위 경로의 잔물결과 유사도", () => {
  mkdirSync(OUT, { recursive: true });
  const rows: Array<Record<string, unknown>> = [];
  for (const [name, lat, lon] of REGIONS) {
    const { graph, region } = load(lat, lon);
    for (const sid of SHAPES) {
      const shape = SHAPE_BY_ID[sid];
      for (const [arm, turnCost] of ARMS) {
        const budget = new StepBudget(STEPS);
        const base = { mode: "shape" as const, shapes: [shape], region, minMeters: 3000, maxMeters: 8000, prefs: {} };
        const initial = discoverRoutes(graph, { ...base, poolSize: 300, branchPool: 0, budget: budgetSlice(budget, 0, 0.3) });
        const result = improveRoutes(graph, initial, { ...base, budget: budgetSlice(budget, 0.3, 1), contourTurnCost: turnCost });
        const top = result.candidates[0];
        rows.push({ region: name, shape: sid, arm, turnCost, found: !!top, similarity: top?.similarity ?? null, J: top ? ripple(meters(graph, top)) : null, km: top ? +(top.lengthMeters / 1000).toFixed(2) : null, latlngs: top?.latlngs ?? null });
      }
    }
  }
  const arm = (a: string) => rows.filter((r) => r.arm === a);
  const summary = Object.fromEntries(ARMS.map(([a]) => {
    const found = arm(a).filter((r) => r.found);
    return [a, { found: found.length, medianJ: median(found.map((r) => r.J as number)), meanSim: found.reduce((s, r) => s + (r.similarity as number), 0) / (found.length || 1) }];
  }));
  // 같은 조건끼리 비교 (A에서도 찾은 조건만)
  const paired = (a: string) => {
    const pairs = arm("A").map((r) => [r, arm(a).find((x) => x.region === r.region && x.shape === r.shape)!] as const).filter(([x, y]) => x.found && y.found);
    return { n: pairs.length, medianJRatio: median(pairs.map(([x, y]) => (y.J as number) / Math.max(1e-9, x.J as number))), meanSimDiff: pairs.reduce((s, [x, y]) => s + (y.similarity as number) - (x.similarity as number), 0) / (pairs.length || 1) };
  };
  const verdict = Object.fromEntries(["B", "C"].map((a) => {
    const p = paired(a), T1 = summary[a].medianJ <= 0.75 * summary.A.medianJ, T2 = p.meanSimDiff >= -3 && summary[a].found >= summary.A.found;
    return [a, { ...p, T1, T2, pass: T1 && T2 }];
  }));
  writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ protocol: "reports/turn-cost-20261111/protocol.md", steps: STEPS, summary, verdict, rows }, null, 2));
  expect(rows.length).toBe(REGIONS.length * SHAPES.length * ARMS.length);
}, 7_200_000);
