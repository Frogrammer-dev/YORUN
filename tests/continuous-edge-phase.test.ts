import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject, hasEdge, type RawEdge } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { continuousEdgePhase, continuousArcPhase } from '@/lib/route/continuousEdgePhase';
import { continuousGuideDistance } from '@/lib/route/continuousGuideDistance';
import { shapeGuidedPortRolloutContinuous, rolloutGuide } from '@/lib/route/shapeGuidedPortRolloutContinuous';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

const placement = { cx: 400, cy: 400, scale: 800, rotDeg: 0 }, region = { minX: -1, minY: -1, maxX: 801, maxY: 801 };
function squareGraph(divisions: number, open = false) {
  const origin = makeOrigin(35, 129), points: Array<[number, number]> = [];
  for (let side = 0; side < 4; side++) for (let i = 0; i < divisions; i++) { const d = i * 800 / divisions; points.push(side === 0 ? [d, 0] : side === 1 ? [800, d] : side === 2 ? [800 - d, 800] : [0, 800 - d]); }
  const ll = points.map(([x, y]) => unproject(origin, x, y)), edges: RawEdge[] = points.map((_, i) => ({ a: i, b: (i + 1) % points.length, factor: 1 })).filter((_, i) => !open || i < points.length - 1);
  return buildGraph(origin, ll.map(v => v[0]), ll.map(v => v[1]), edges, null);
}

it('integrates finite guide distance analytically and remains additive under collinear subdivision', () => {
  expect(continuousGuideDistance([0, 0], [10, 0], [0, 3], [10, 3])).toBeCloseTo(30, 10);
  const whole = continuousGuideDistance([0, 0], [10, 0], [5, 3], [5, 8]), subdivided = continuousGuideDistance([0, 0], [4, 0], [5, 3], [5, 8]) + continuousGuideDistance([4, 0], [10, 0], [5, 3], [5, 8]);
  expect(whole).toBeCloseTo(5 * Math.sqrt(34) + 9 * Math.asinh(5 / 3), 10); expect(whole).toBeCloseTo(subdivided, 10);
});

it('retains stay and multiple ordered interval phases without jumping backward along the actual edge', () => {
  const g = { x: Float64Array.from([0, 10]), y: Float64Array.from([0, 0]) } as ReturnType<typeof squareGraph>;
  const allowed = continuousEdgePhase(g, 0, 1, [[0, 0], [8, 0], [7, 0]], 0, 3, 10, 20);
  expect(allowed.labels.map(s => s.phase)).toEqual([0, 1, 2]);
  for (const s of allowed.labels) { expect(s.phaseNativeMeters.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10); expect(s.phaseActualNodes.flat().every(v => v === 0 || v === 1)).toBe(true); }
  const blocked = continuousEdgePhase(g, 0, 1, [[0, 0], [8, 0], [2, 0]], 0, 1, 10, 20); expect(blocked.labels.some(s => s.phase === 2)).toBe(false);
});

it('finds the same native100 square from sparse4 and dense32 actual nodes without adding road points', () => {
  for (const divisions of [1, 8]) {
    const g = squareGraph(divisions), pg = exactRoadPortGraph(g, region), ns = pg.edges[0].nodes.slice(); if (g.x[ns[1]] < 1) ns.reverse();
    const guide = rolloutGuide(SHAPE_BY_ID.square, placement), phase = continuousArcPhase(g, ns, guide, 0, 128, 48);
    expect(phase.allEndpointPhasesBeforeCap).toContain(guide.length - 1); expect(phase.labels.length).toBeLessThanOrEqual(4); expect(phase.labels.some(s => s.phase === guide.length - 1)).toBe(true);
    const result = shapeGuidedPortRolloutContinuous(g, pg, SHAPE_BY_ID.square, region, [placement], false);
    expect(result.pool.length).toBeGreaterThan(0); expect(result.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(result.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
    expect(result.pool[0].candidate.similarity).toBe(100);
    for (const e of result.pool) { expect(e.candidate.lengthMeters).toBeCloseTo(3200, 1); expect(e.nodes.every((v, i) => Number.isInteger(v) && v >= 0 && v < g.n && (!i || hasEdge(g, e.nodes[i - 1], v)))).toBe(true); }
  }
});

it('cannot close a missing actual corner through virtual phase positions', () => {
  const g = squareGraph(1, true), result = shapeGuidedPortRolloutContinuous(g, exactRoadPortGraph(g, region), SHAPE_BY_ID.square, region, [placement], true); expect(result.pool).toHaveLength(0);
});
