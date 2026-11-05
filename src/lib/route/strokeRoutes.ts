// 열린 손그림은 입력한 순서와 양 끝을 유지한다. 닫힌 코스용 고리 정리·출발점 회전은 적용하지 않는다.
import { budgetOf } from "./budget";
import {
  dominantGridAngle,
  evaluatePath,
  placeShape,
  tolerance,
  TUNING,
  type Evaluated,
  type FindResult,
  type Placement,
  type Region,
  type RouteCandidate,
} from "./fit";
import { PathFinder, hasEdge, roadStats, unproject, type RoadGraph } from "./graph";
import type { GroupOptions } from "./group";
import { anchorsOf, isClosedShape, resample, type ShapeGroup, type ShapePart } from "./shapes";

type XY = [number, number];
type ScoredPlacement = { p: Placement; cost: number };

function partPlacement(p: Placement, part: ShapePart): Placement {
  const angle = p.rotDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  return {
    cx: p.cx + p.scale * (part.ox * c - part.oy * s),
    cy: p.cy + p.scale * (part.ox * s + part.oy * c),
    scale: p.scale * part.s,
    rotDeg: p.rotDeg,
  };
}

const inside = (x: number, y: number, r: Region) =>
  x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

function pathLength(g: RoadGraph, nodes: number[]): number {
  let total = 0;
  for (let i = 1; i < nodes.length; i++) {
    total += Math.hypot(g.x[nodes[i]] - g.x[nodes[i - 1]], g.y[nodes[i]] - g.y[nodes[i - 1]]);
  }
  return total;
}

/** Closed-only algorithms intentionally remain separate from this ordered-stroke search. */
export function findStrokeRoutes(g: RoadGraph, group: ShapeGroup, o: GroupOptions): FindResult {
  const r = o.region, width = r.maxX - r.minX, height = r.maxY - r.minY;
  const empty = (): FindResult => ({ candidates: [], partial: false, evaluated: 0 });
  if (!g.n || !group.parts.length || width <= 0 || height <= 0 ||
      !Number.isFinite(o.minMeters) || !Number.isFinite(o.maxMeters) ||
      o.minMeters <= 0 || o.maxMeters < o.minMeters) return empty();
  const parts = group.parts;
  if (parts.some(({ shape, ox, oy, s }) => !Number.isFinite(ox + oy + s) || s <= 0 ||
      shape.points.length < 2 || !Number.isFinite(shape.perimeter) || shape.perimeter <= 0 ||
      shape.points.some(([x, y]) => !Number.isFinite(x + y)))) return empty();

  const budget = budgetOf(o, Math.min(75_000, 35_000 * Math.max(1, width * height / 4500 ** 2)));
  let partial = false, evaluated = 0;
  const available = () => {
    if (budget.ok() && budget.remaining() > 0) return true;
    partial = true;
    return false;
  };
  if (!available()) return { ...empty(), partial };

  const finder = new PathFinder(g);
  const perimeters = parts.map((part) => part.s * part.shape.perimeter);
  const perimeter = perimeters.reduce((sum, value) => sum + value, 0);
  const weights = perimeters.map((value) => value / perimeter);
  const unitLines = parts.map((part) => part.shape.points.map(([x, y]) =>
    [part.ox + part.s * x, part.oy + part.s * y] as XY));
  const samples = unitLines.flatMap((line) => resample(line, 16));
  const outlinePoints = unitLines.flat();
  const rotations = [...new Set([0, Math.round(dominantGridAngle(g)), -30, 30, 90, 180, 270])];
  const coarse: ScoredPlacement[] = [];
  let examined = 0;
  o.onProgress?.(0, "입력한 선을 길 위에 놓아 보기");

  // Only a bounded set is retained. Budget checks also cover the coarse placement scan.
  placementScan: for (const rotDeg of rotations) {
    const rotated = placeShape(outlinePoints, { cx: 0, cy: 0, scale: 1, rotDeg });
    const minX = Math.min(...rotated.map(([x]) => x)), maxX = Math.max(...rotated.map(([x]) => x));
    const minY = Math.min(...rotated.map(([, y]) => y)), maxY = Math.max(...rotated.map(([, y]) => y));
    const spanX = maxX - minX, spanY = maxY - minY;
    const upper = Math.min(o.maxMeters / perimeter,
      spanX > 1e-9 ? width * 0.98 / spanX : Infinity,
      spanY > 1e-9 ? height * 0.98 / spanY : Infinity);
    const lower = Math.max(30, o.minMeters / (1.35 * perimeter));
    if (upper < lower) continue;
    const scales = [...new Set([0, 1, 2, 3, 4].map((i) => lower * (upper / lower) ** (i / 4)))];
    for (const scale of scales) {
      const left = r.minX - minX * scale, right = r.maxX - maxX * scale;
      const bottom = r.minY - minY * scale, top = r.maxY - maxY * scale;
      const step = Math.max(60, scale * 0.16, width / 24, height / 24);
      const xs = positions(left, right, step), ys = positions(bottom, top, step);
      // Centre first allows a small budget to examine useful placements before boundary positions.
      for (const cx of xs) for (const cy of ys) {
        if (!available() || !budget.ok(0.25)) break placementScan;
        if (examined >= 6000) break placementScan;
        if (examined++ % 8 === 0) budget.spend();
        const p = { cx, cy, scale, rotDeg };
        const placed = placeShape(samples, p);
        let cost = 0;
        for (const [x, y] of placed) cost += g.edgeIndex.distance(x, y, 200);
        coarse.push({ p, cost: cost / placed.length / scale });
        if (coarse.length > 256) {
          coarse.sort((a, b) => a.cost - b.cost);
          coarse.length = 128;
        }
      }
    }
  }
  coarse.sort((a, b) => a.cost - b.cost);
  const placements: ScoredPlacement[] = [];
  for (const pose of coarse) {
    if (placements.length >= 80) break;
    if (placements.filter(({ p }) => Math.abs(p.scale - pose.p.scale) < pose.p.scale * 0.05 &&
        Math.abs(p.rotDeg - pose.p.rotDeg) < 5 &&
        Math.hypot(p.cx - pose.p.cx, p.cy - pose.p.cy) < pose.p.scale * 0.15).length >= 2) continue;
    placements.push(pose);
  }

  const validPath = (path: number[]) => path.every((v, i) =>
    v >= 0 && v < g.n && inside(g.x[v], g.y[v], r) && (!i || hasEdge(g, path[i - 1], v)));

  const build = (p: Placement): RouteCandidate | null => {
    if (!available()) return null;
    budget.spend();
    evaluated++;
    const per: Array<{ e: Evaluated; p: Placement }> = [];
    for (const part of parts) {
      if (!available()) return null;
      const pp = partPlacement(p, part);
      const outline = placeShape(part.shape.points, pp);
      if (!outline.every(([x, y]) => inside(x, y, r))) return null;
      const t = tolerance(pp.scale);
      const anchors = placeShape(anchorsOf(part.shape, 32), pp);
      const snapped = anchors.map(([x, y]) => g.nodeIndex.nearest(x, y, t * 3));
      if (snapped.some((v) => v < 0)) return null;
      // An open stroke must not collapse to a loop because both ends snapped to the same junction.
      if (!isClosedShape(part.shape) && snapped[0] === snapped[snapped.length - 1]) return null;
      const path = [snapped[0]];
      for (let i = 1; i < snapped.length; i++) {
        if (snapped[i - 1] === snapped[i]) continue;
        if (!available()) return null;
        budget.spend();
        const segment = finder.route(snapped[i - 1], snapped[i], {
          ax: anchors[i - 1][0], ay: anchors[i - 1][1],
          bx: anchors[i][0], by: anchors[i][1], tol: t, weight: TUNING.guideWeight,
        }, 25_000, TUNING.turnCost, path.length > 1 ? path[path.length - 2] : -1);
        if (!segment || !validPath(segment)) return null;
        path.push(...segment.slice(1));
      }
      if (path.length < 2 || !validPath(path)) return null;
      // evaluatePath measures polylines as supplied; it neither closes nor rotates them.
      const e = evaluatePath(g, part.shape, pp, path, 0, Infinity);
      if (!Number.isFinite(e.cost) || e.repeatRatio > 0.2) return null;
      per.push({ e, p: pp });
    }
    const drawMeters = per.reduce((sum, { e }) => sum + e.lengthMeters, 0);
    if (drawMeters < o.minMeters || drawMeters > o.maxMeters) return null;

    const full = [...per[0].e.path], moves: Array<[number, number]> = [];
    let moveMeters = 0;
    for (let i = 1; i < per.length; i++) {
      if (!available()) return null;
      budget.spend();
      const move = finder.route(full[full.length - 1], per[i].e.path[0], undefined, 60_000);
      if (!move || !validPath(move)) return null;
      const start = full.length - 1;
      full.push(...move.slice(1));
      if (move.length > 1) moves.push([start, full.length - 1]);
      moveMeters += pathLength(g, move);
      full.push(...per[i].e.path.slice(1));
    }
    if (!validPath(full)) return null;
    const sum = (get: (e: Evaluated) => number) => per.reduce((value, { e }, i) => value + weights[i] * get(e), 0);
    const ll = (x: number, y: number) => unproject(g.origin, x, y).map((n) =>
      Math.round(n * 1e7) / 1e7) as XY;
    const outlines = per.map(({ p: pp }, i) => placeShape(parts[i].shape.points, pp).map(([x, y]) => ll(x, y)));
    return {
      id: `${group.id}-stroke-${Math.round(p.cx)}-${Math.round(p.cy)}-${Math.round(p.scale)}-${p.rotDeg}-${full[0]}-${full[full.length - 1]}`,
      shapeId: group.id, shapeName: group.name, placement: p,
      latlngs: full.map((v) => [Math.round(g.lat[v] * 1e7) / 1e7, Math.round(g.lon[v] * 1e7) / 1e7]),
      outline: outlines[0], outlines, moves,
      lengthMeters: Math.round(drawMeters), moveMeters: Math.round(moveMeters),
      roadInfo: roadStats(g, full),
      similarity: Math.round(sum((e) => e.similarity)),
      meanDeviationMeters: Math.round(sum((e) => e.meanDev)),
      maxDeviationMeters: Math.round(Math.max(...per.map(({ e }) => e.maxDev))),
      zigzagPerKm: Math.round(sum((e) => e.zigzagPerKm) * 10) / 10,
      spikes: per.reduce((value, { e }) => value + e.spikes, 0),
      featureCoverage: Math.round(sum((e) => e.featureCoverage) * 100) / 100,
      repeatRatio: Math.round(sum((e) => e.repeatRatio) * 1000) / 1000,
      cost: sum((e) => e.cost) + 0.05 * moveMeters / Math.max(1, drawMeters),
    };
  };

  const candidates: RouteCandidate[] = [];
  const fingerprints = new Set<string>();
  for (let i = 0; i < placements.length; i++) {
    if (!available()) break;
    o.onProgress?.(0.25 + 0.74 * i / placements.length, "시작부터 끝까지 길 따라 잇기");
    const candidate = build(placements[i].p);
    if (!candidate) continue;
    const key = JSON.stringify([candidate.latlngs, candidate.moves]);
    if (fingerprints.has(key)) continue;
    fingerprints.add(key);
    candidates.push(candidate);
  }
  candidates.sort((a, b) => b.similarity - a.similarity || a.cost - b.cost);
  o.onProgress?.(1, "");
  return { candidates: candidates.slice(0, o.maxResults ?? 6), partial, evaluated };
}

function positions(low: number, high: number, step: number): number[] {
  if (high < low) return [];
  const middle = (low + high) / 2;
  const values = [middle];
  for (let x = low; x <= high; x += step) if (Math.abs(x - middle) > 1) values.push(x);
  if (Math.abs(high - middle) > 1 && Math.abs((values[values.length - 1] ?? low) - high) > 1) values.push(high);
  return values;
}
