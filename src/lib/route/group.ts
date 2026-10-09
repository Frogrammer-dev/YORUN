// 여러 획 그림 찾기 (예: 글자 "520", 떨어진 두 하트).
// 그림 전체를 한 덩어리로 옮기고·키우고·돌려 보며 획마다 길 위 고리를 만들고, 획 사이는 '이동 구간'으로 잇는다.
// 이동 구간은 그림이 아니므로 달리기 화면에서 점선으로 보여 주고, 기록을 멈추고 이동하도록 안내한다.

import { overlap } from "./discover";
import {
  DistanceField,
  dominantGridAngle,
  evaluatePath,
  placeShape,
  cutThinSpikes,
  routePlacement,
  tolerance,
  type Evaluated,
  type FindResult,
  type Placement,
  type Region,
  type RouteCandidate,
} from "./fit";
import { PathFinder, roadStats, unproject, type RoadGraph } from "./graph";
import { buildBlocks, unionForPlacement } from "./loops";
import { resample, type ShapeGroup, type ShapePart } from "./shapes";

type XY = [number, number];

/** 경로 길이 ≈ 모양 둘레 × 이 비율 (fit.ts와 같은 가정) */
const DETOUR = 1.2;

export interface GroupOptions {
  minMeters: number;
  maxMeters: number;
  region: Region;
  timeBudgetMs?: number;
  maxResults?: number;
  onProgress?: (fraction: number, label: string) => void;
}

/** 그림 전체 배치 → 획 하나의 배치 */
export function partPlacement(G: Placement, part: ShapePart): Placement {
  const r = (G.rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { cx: G.cx + G.scale * (part.ox * c - part.oy * s), cy: G.cy + G.scale * (part.ox * s + part.oy * c), scale: G.scale * part.s, rotDeg: G.rotDeg };
}

/** 닫힌 고리를 v에서 시작하도록 돌린다 */
function rotateLoop(loop: number[], v: number): number[] {
  const body = loop[0] === loop[loop.length - 1] ? loop.slice(0, -1) : loop;
  const i = body.indexOf(v);
  if (i < 0) return loop;
  return [...body.slice(i), ...body.slice(0, i), v];
}

/** 두 고리에서 서로 가장 가까운 점 (a 쪽 점, b 쪽 점) */
function closestPair(g: RoadGraph, a: number[], b: number[]): [number, number] {
  const sub = (l: number[]) => l.filter((_, i) => i % Math.max(1, Math.floor(l.length / 80)) === 0);
  let best: [number, number] = [a[0], b[0]], bd = Infinity;
  for (const u of sub(a))
    for (const v of sub(b)) {
      const d = (g.x[u] - g.x[v]) ** 2 + (g.y[u] - g.y[v]) ** 2;
      if (d < bd) (bd = d), (best = [u, v]);
    }
  return best;
}

const pathLen = (g: RoadGraph, p: number[]) => {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(g.x[p[i]] - g.x[p[i - 1]], g.y[p[i]] - g.y[p[i - 1]]);
  return d;
};

export function findGroupRoutes(g: RoadGraph, group: ShapeGroup, o: GroupOptions): FindResult {
  const started = Date.now();
  const R = o.region;
  const W = R.maxX - R.minX, H = R.maxY - R.minY;
  const tiles = Math.max(1, Math.round(W / 4500)) * Math.max(1, Math.round(H / 4500));
  const budget = o.timeBudgetMs ?? Math.min(75_000, 35_000 * tiles);
  const finder = new PathFinder(g);
  const blocks = buildBlocks(g, (W * H) / 4);
  const field = new DistanceField(g, R, Math.max(15, Math.max(W, H) / 450));
  const parts = group.parts;
  const perims = parts.map((p) => p.s * p.shape.perimeter);
  const totalPerim = perims.reduce((a, b) => a + b, 0);
  const weight = perims.map((p) => p / totalPerim);
  let partial = false, evaluated = 0;

  // 1) 크기·각도 후보 (글자는 기울면 읽기 어려우므로 작게만 돌린다)
  const sMin = o.minMeters / (DETOUR * totalPerim);
  const sMax = Math.min(o.maxMeters / (DETOUR * totalPerim), Math.min(W, H) * 0.98);
  if (sMax < Math.max(sMin, 200)) return { candidates: [], partial: false, evaluated: 0 };
  const lo = Math.max(sMin, 200);
  const scales = [0, 1, 2, 3].map((k) => lo * Math.pow(sMax / lo, k / 3));
  const grid = dominantGridAngle(g);
  const rots = [...new Set([-15, 0, 15, Math.round(Math.max(-25, Math.min(25, grid)))])];
  const samples: XY[] = parts.flatMap((p) => resample(p.shape.points, 24).map(([x, y]) => [p.ox + p.s * x, p.oy + p.s * y] as XY));
  const avgS = parts.reduce((a, p, i) => a + p.s * weight[i], 0);

  // 2) 빠른 추정: 모든 획의 표본점이 길에 얼마나 가까운가
  o.onProgress?.(0.05, "그림 놓아 보기");
  const coarse: Array<{ p: Placement; c: number }> = [];
  for (const scale of scales) {
    const T = tolerance(scale * avgS);
    const step = Math.max(60, scale * 0.08);
    for (const rotDeg of rots)
      for (let cx = R.minX + scale * 0.5; cx <= R.maxX - scale * 0.5; cx += step)
        for (let cy = R.minY + scale * 0.5; cy <= R.maxY - scale * 0.5; cy += step) {
          const p = { cx, cy, scale, rotDeg };
          const pts = placeShape(samples, p);
          if (pts.some(([x, y]) => x < R.minX || x > R.maxX || y < R.minY || y > R.maxY)) continue;
          let c = 0;
          for (const [x, y] of pts) c += Math.min(field.get(x, y), 3 * T);
          coarse.push({ p, c: c / pts.length / T });
        }
  }
  coarse.sort((a, b) => a.c - b.c);
  const top: typeof coarse = [];
  for (const t of coarse) {
    if (top.length >= 80) break;
    if (top.filter((u) => Math.hypot(u.p.cx - t.p.cx, u.p.cy - t.p.cy) < 0.2 * Math.max(u.p.scale, t.p.scale)).length >= 2) continue;
    top.push(t);
  }

  // 3) 획마다 길 위 고리 (유연 맞추기·블록 칠하기 중 나은 것) → 이동 구간으로 잇기
  /** 그림 전체 배치 하나 → 코스 (못 만들면 null) */
  const build = (P: Placement): RouteCandidate | null => {
    const per: Array<{ e: Evaluated; p: Placement }> = [];
    for (let i = 0; i < parts.length; i++) {
      const pp = partPlacement(P, parts[i]);
      const minP = o.minMeters * weight[i] * 0.5, maxP = o.maxMeters * weight[i] * 1.5;
      let best: { e: Evaluated; p: Placement } | null = null;
      const e1 = routePlacement(g, finder, parts[i].shape, pp, minP, maxP);
      evaluated++;
      if (e1) best = { e: e1, p: e1.fit ?? pp };
      const u = unionForPlacement(g, blocks, parts[i].shape, pp, R);
      if (u) {
        // 나란한 두 길로 생긴 얇은 막대는 잘라낸다
        const path = cutThinSpikes(g, finder, u.path);
        if (path.length >= 4) {
          const e2 = evaluatePath(g, parts[i].shape, pp, path, minP, maxP);
          if (!best || e2.cost < best.e.cost) best = { e: e2, p: pp };
        }
      }
      if (!best) return null; // 한 획이라도 못 만들면 이 배치는 버린다
      per.push(best);
    }
    // 획 순서대로 잇기: 다음 획에서 가장 가까운 점으로 들어가 한 바퀴 돌고 같은 점에서 나온다
    const full: number[] = [];
    const moves: Array<[number, number]> = [];
    let moveMeters = 0;
    let entry = closestPair(g, per[0].e.path, per.length > 1 ? per[1].e.path : per[0].e.path)[0];
    for (let i = 0; i < per.length; i++) {
      const loop = rotateLoop(per[i].e.path, entry);
      for (let k = full.length ? 1 : 0; k < loop.length; k++) full.push(loop[k]);
      if (i === per.length - 1) break;
      const next = closestPair(g, [entry], per[i + 1].e.path)[1];
      const move = finder.route(entry, next, undefined, 60_000);
      if (!move) return null; // 이어 갈 길이 없으면 버린다
      const start = full.length - 1;
      for (let k = 1; k < move.length; k++) full.push(move[k]);
      moves.push([start, full.length - 1]);
      moveMeters += pathLen(g, move);
      entry = next;
    }
    const sum = (f: (x: { e: Evaluated }) => number) => per.reduce((a, x, i) => a + weight[i] * f(x), 0);
    const ll = (x: number, y: number) => unproject(g.origin, x, y).map((v) => Math.round(v * 1e7) / 1e7) as [number, number];
    const outlines = per.map((x, i) => placeShape(parts[i].shape.points, x.p).map(([px, py]) => ll(px, py)));
    const drawMeters = per.reduce((a, x) => a + x.e.lengthMeters, 0);
    // 비용: 획별 비용의 가중 평균 + 전체 거리 범위 + 이동이 길수록 조금 불리
    let cost = sum((x) => x.e.cost) + 0.05 * (moveMeters / Math.max(1, drawMeters));
    if (drawMeters < o.minMeters) cost += (0.5 * (o.minMeters - drawMeters)) / o.minMeters;
    if (drawMeters > o.maxMeters) cost += (0.5 * (drawMeters - o.maxMeters)) / o.maxMeters;
    return {
      id: `${group.id}-${parts.length}-${Math.round(P.cx)}-${Math.round(P.cy)}-${Math.round(P.scale)}-${Math.round(P.rotDeg)}`,
      shapeId: group.id,
      shapeName: group.name,
      placement: P,
      latlngs: full.map((v) => [Math.round(g.lat[v] * 1e7) / 1e7, Math.round(g.lon[v] * 1e7) / 1e7]),
      outline: outlines[0],
      outlines,
      moves,
      lengthMeters: Math.round(drawMeters),
      moveMeters: Math.round(moveMeters),
      roadInfo: roadStats(g, full),
      similarity: Math.round(sum((x) => x.e.similarity)),
      meanDeviationMeters: Math.round(sum((x) => x.e.meanDev)),
      maxDeviationMeters: Math.round(Math.max(...per.map((x) => x.e.maxDev))),
      zigzagPerKm: Math.round(sum((x) => x.e.zigzagPerKm) * 10) / 10,
      spikes: per.reduce((a, x) => a + x.e.spikes, 0),
      featureCoverage: Math.round(sum((x) => x.e.featureCoverage) * 100) / 100,
      repeatRatio: Math.round(sum((x) => x.e.repeatRatio) * 1000) / 1000,
      cost,
    };
  };

  const cands: RouteCandidate[] = [];
  top.forEach((t, ti) => {
    if (Date.now() - started > budget) {
      partial = true;
      return;
    }
    o.onProgress?.(0.1 + (0.6 * ti) / top.length, `${group.name} 맞춰 보기`);
    const c = build(t.p);
    if (c) cands.push(c);
  });

  // 4) 상위 몇 개는 조금씩 옮기고·키우고·돌려 다듬는다 (결과가 같으면 같은 위치로 수렴)
  cands.sort((a, b) => a.cost - b.cost);
  let seed = 2654435761 ^ Math.round(R.minX * 7 + R.minY * 13);
  const rand = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  const seeds = cands.slice(0, 5);
  seeds.forEach((s, si) => {
    let best = s;
    for (let k = 0; k < 12; k++) {
      if (Date.now() - started > budget) {
        partial = true;
        break;
      }
      const P = best.placement;
      const c = build({
        cx: P.cx + (rand() - 0.5) * 0.12 * P.scale,
        cy: P.cy + (rand() - 0.5) * 0.12 * P.scale,
        scale: P.scale * (0.93 + rand() * 0.14),
        rotDeg: Math.max(-25, Math.min(25, P.rotDeg + (rand() - 0.5) * 10)),
      });
      if (c && c.cost < best.cost) best = c;
    }
    if (best !== s) cands.push(best);
    o.onProgress?.(0.7 + (0.28 * (si + 1)) / seeds.length, `${group.name} 다듬기`);
  });

  cands.sort((a, b) => a.cost - b.cost);
  const chosen: RouteCandidate[] = [];
  for (const c of cands) {
    if (chosen.length >= (o.maxResults ?? 6)) break;
    if (chosen.some((d) => overlap(c, d))) continue;
    chosen.push(c);
  }
  chosen.sort((a, b) => b.similarity - a.similarity);
  o.onProgress?.(1, "");
  return { candidates: chosen, partial, evaluated };
}
