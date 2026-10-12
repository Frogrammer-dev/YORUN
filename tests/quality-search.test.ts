import { describe, expect, it } from 'vitest';
import { StepBudget } from '@/lib/route/budget';
import { evaluatePath, findRoutes, placeShape, toCandidate, type FindResult, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { buildGraph, EDGE_LIT, EDGE_MAJOR, EDGE_UNLIT, hasEdge, makeOrigin, project, unproject, type RawEdge } from '@/lib/route/graph';
import { improveRoutes } from '@/lib/route/qualitySearch';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

const square = SHAPE_BY_ID.square;
const region = { minX: -1600, maxX: 1600, minY: -1600, maxY: 1600 };

function grid(step = 250) {
  const origin = makeOrigin(37, 127), coordinates: [number, number][] = [], edges: RawEdge[] = [];
  const id = (x: number, y: number) => (y + 6) * 13 + x + 6;
  for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) {
    coordinates.push(unproject(origin, x * step, y * step));
    const flags = x < 0 ? EDGE_MAJOR | EDGE_UNLIT : EDGE_LIT;
    if (x < 6) edges.push({ a: id(x, y), b: id(x + 1, y), factor: 1, flags });
    if (y < 6) edges.push({ a: id(x, y), b: id(x, y + 1), factor: 1, flags });
  }
  const g = buildGraph(origin, coordinates.map(c => c[0]), coordinates.map(c => c[1]), edges, '2026-10-12');
  function ring(left: number, bottom: number, right: number, top: number) {
    const path: number[] = [];
    for (let x = left; x < right; x++) path.push(id(x, bottom));
    for (let y = bottom; y < top; y++) path.push(id(right, y));
    for (let x = right; x > left; x--) path.push(id(x, top));
    for (let y = top; y > bottom; y--) path.push(id(left, y));
    path.push(path[0]);
    return path;
  }
  function candidate(path: number[], p: Placement): RouteCandidate {
    return toCandidate(g, square, p, evaluatePath(g, square, p, path, 2000, 12000));
  }
  return { g, ring, candidate };
}

function expired() { const budget = new StepBudget(0); budget.spend(); return budget; }
function initial(candidates: RouteCandidate[]): FindResult { return { candidates, evaluated: 0, partial: false }; }

describe('quality search on connected road graphs', () => {
  it('preserves valid baseline roads after the shared budget expires', () => {
    const { g } = grid();
    const baseline = findRoutes(g, { shapes: ['square'], region, minMeters: 3000, maxMeters: 8000, budget: new StepBudget(80), resultsPerShape: 8 });
    expect(baseline.candidates.length).toBeGreaterThan(0);
    const result = improveRoutes(g, baseline, { shapes: [square], region, minMeters: 3000, maxMeters: 8000, mode: 'shape', budget: expired() });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.partial).toBe(true);
    expect(result.evaluated).toBe(baseline.evaluated);
    expect(result.candidates[0].similarity).toBeGreaterThanOrEqual(Math.max(...baseline.candidates.map(c => c.similarity)));
    for (const c of result.candidates) {
      const nodes = c.latlngs.map(([lat, lon]) => g.nodeIndex.nearest(...project(g.origin, lat, lon), .5));
      expect(nodes[0]).toBe(nodes.at(-1));
      expect(nodes.slice(1).every((v, i) => hasEdge(g, nodes[i], v))).toBe(true);
      const e = evaluatePath(g, square, c.placement, nodes, 3000, 8000);
      expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);
      expect(e.lengthMeters).toBeLessThanOrEqual(8000);
      expect(e.repeatRatio).toBeLessThanOrEqual(.2);
    }
  });

  it('filters custom 2–5 km limits using exact geometry, including a rounded boundary', () => {
    const { g, ring, candidate } = grid(250.001);
    const valid = candidate(ring(-2, -2, 2, 2), { cx: 0, cy: 0, scale: 1000.004, rotDeg: 0 });
    const over = candidate(ring(-2, -2, 3, 3), { cx: 125.0005, cy: 125.0005, scale: 1250.005, rotDeg: 0 });
    expect(over.lengthMeters).toBe(5000);
    const result = improveRoutes(g, initial([over, valid]), { shapes: [square], region, minMeters: 2000, maxMeters: 5000, mode: 'shape', budget: expired() });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].latlngs).toEqual(valid.latlngs);
  });

  it('rejects invented edges, open routes, repeated laps, and templates outside the region', () => {
    const { g, ring, candidate } = grid();
    const valid = candidate(ring(-2, -2, 2, 2), { cx: 0, cy: 0, scale: 1000, rotDeg: 0 });
    const fake = { ...valid, latlngs: [valid.latlngs[0], valid.latlngs[4], valid.latlngs[8], valid.latlngs[12], valid.latlngs[0]] };
    const open = { ...valid, latlngs: valid.latlngs.slice(0, -1) };
    const laps = { ...valid, latlngs: [...valid.latlngs, ...valid.latlngs.slice(1)] };
    const outside = { ...valid, placement: { ...valid.placement, cx: 1500 } };
    expect(placeShape(square.points, outside.placement).some(([x]) => x > region.maxX)).toBe(true);
    const result = improveRoutes(g, initial([fake, open, laps, outside, valid]), { shapes: [square], region, minMeters: 3000, maxMeters: 8000, mode: 'shape', budget: expired() });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].latlngs).toEqual(valid.latlngs);
  });

  it('uses road preferences as soft selection costs', () => {
    const { g, ring, candidate } = grid();
    const major = candidate(ring(-5, -2, -1, 2), { cx: -750, cy: 0, scale: 1000, rotDeg: 0 });
    const lit = candidate(ring(1, -2, 5, 2), { cx: 753, cy: 0, scale: 1000, rotDeg: 0 });
    const choose = (prefs?: { avoidMajor?: boolean; preferLit?: boolean }) => improveRoutes(g, initial([major, lit]), { shapes: [square], region, minMeters: 3000, maxMeters: 8000, mode: 'shape', budget: expired(), maxResults: 1, prefs }).candidates[0];
    expect(major.similarity).toBeGreaterThan(lit.similarity);
    expect(choose().placement.cx).toBe(-750);
    expect(choose({ avoidMajor: true }).placement.cx).toBe(753);
    expect(choose({ preferLit: true }).placement.cx).toBe(753);
  });

  it('finds a better real-road candidate while retaining all distance and closure constraints', () => {
    const { g, ring, candidate } = grid();
    const incumbent = candidate(ring(-3, -2, 3, 2), { cx: 0, cy: 0, scale: 1500, rotDeg: 0 });
    const result = improveRoutes(g, initial([incumbent]), { shapes: [square], region, minMeters: 3000, maxMeters: 8000, mode: 'shape', budget: new StepBudget(5000), maxResults: 1 });
    expect(result.evaluated).toBeGreaterThan(0);
    expect(result.candidates[0].similarity).toBeGreaterThan(incumbent.similarity);
    const c = result.candidates[0], nodes = c.latlngs.map(([lat, lon]) => g.nodeIndex.nearest(...project(g.origin, lat, lon), .5));
    expect(nodes[0]).toBe(nodes.at(-1));
    expect(nodes.slice(1).every((v, i) => hasEdge(g, nodes[i], v))).toBe(true);
    const e = evaluatePath(g, square, c.placement, nodes, 3000, 8000);
    expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);
    expect(e.lengthMeters).toBeLessThanOrEqual(8000);
    expect(e.repeatRatio).toBeLessThanOrEqual(.2);
  }, 30000);
});
