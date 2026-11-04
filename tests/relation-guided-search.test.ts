import { describe, expect, it } from 'vitest';
import { buildGraph, hasEdge, makeOrigin, unproject } from '../src/lib/route/graph';
import { SHAPE_BY_ID } from '../src/lib/route/shapes';
import { relationDiagnostics, relationGuidedSearch } from '../src/lib/route/relationGuidedSearch';

function fixture() {
  const origin = makeOrigin(37, 127);
  const points: Array<[number, number]> = [[-500, -500], [500, -500], [500, 500], [-500, 500], [500, 800], [-500, 800]];
  const nativeEdges: Array<{ a: number; b: number; factor: number }> = [];
  const pieces = new Map<string, number[]>();
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [4, 5], [5, 3]]) {
    const count = Math.round(Math.hypot(points[b][0] - points[a][0], points[b][1] - points[a][1]) / 100);
    const nodes = [a];
    for (let i = 1; i < count; i++) {
      nodes.push(points.length);
      points.push([points[a][0] + (points[b][0] - points[a][0]) * i / count, points[a][1] + (points[b][1] - points[a][1]) * i / count]);
    }
    nodes.push(b); pieces.set(`${a}:${b}`, nodes);
    for (let i = 1; i < nodes.length; i++) nativeEdges.push({ a: nodes[i - 1], b: nodes[i], factor: 1 });
  }
  const expand = (nodes: number[]) => nodes.slice(1).flatMap((b, i) => pieces.get(`${nodes[i]}:${b}`)!.slice(0, -1)).concat(nodes.at(-1)!);
  const ll = points.map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), nativeEdges, null);
  const remap = points.map(([x, y]) => g.nodeIndex.nearest(x, y, 1));
  const placement = { cx: 0, cy: 0, scale: 1000, rotDeg: 0 };
  const region = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
  return { g, placement, region, input: expand([0, 1, 2, 4, 5, 3, 0]).map(i => remap[i]), perfect: expand([0, 1, 2, 3, 0]).map(i => remap[i]), square: SHAPE_BY_ID.square };
}

describe('relation guided native-road generation', () => {
  it('reconnects a displaced contour through native edges and improves the unchanged fit objective', () => {
    const { g, square, placement, input, region } = fixture();
    const result = relationGuidedSearch(g, square, placement, input, region,
      { mode: 'relation', maxProposals: 96, maxExpanded: 1000, checkpoints: [0, 8, 32, 96] })!;
    expect(result).not.toBeNull();
    expect(result.evaluated.path[0]).toBe(result.evaluated.path.at(-1));
    expect(result.evaluated.path.every((v, i, path) => !i || hasEdge(g, path[i - 1], v))).toBe(true);
    expect(result.evaluated.lengthMeters).toBeGreaterThanOrEqual(3000);
    expect(result.evaluated.lengthMeters).toBeLessThanOrEqual(8000);
    expect(result.evaluated.repeatRatio).toBeLessThanOrEqual(.2);
    expect(result.diagnostics.objective).toBeLessThan(result.initialDiagnostics.objective);
    expect(result.history.every((state, i, history) => !i || state.relationObjective < history[i - 1].relationObjective)).toBe(true);
    expect(result.expanded).toBeLessThanOrEqual(result.attempts * 1000);
    expect(result.evaluated.fit).toEqual(placement);
  });

  it('uses deterministic prefix checkpoints and preserves the seed at zero proposals', () => {
    const { g, square, placement, input, region } = fixture();
    for (const mode of ['uniform', 'relation'] as const) {
      const full = relationGuidedSearch(g, square, placement, input, region,
        { mode, maxProposals: 8, maxExpanded: 1000, checkpoints: [0, 4, 8] })!;
      expect(full.checkpoints.map(c => c.proposals)).toEqual([0, 4, 8]);
      const prefix = relationGuidedSearch(g, square, placement, input, region, { mode, maxProposals: 4, maxExpanded: 1000 })!;
      expect(full.checkpoints[1].evaluated.path).toEqual(prefix.evaluated.path);
      const zero = relationGuidedSearch(g, square, placement, input, region, { mode, maxProposals: 0 })!;
      expect(zero.evaluated.path).toEqual(input);
      expect(zero.expanded).toBe(0);
    }
  });

  it('rejects disconnected, open, too short, repeated and out-of-ROI seeds', () => {
    const { g, square, placement, input, region } = fixture();
    const run = (path: number[], r = region) => relationGuidedSearch(g, square, placement, path, r, { mode: 'relation', maxProposals: 0 });
    expect(run([0, 2, 3, 0])).toBeNull();
    expect(run(input.slice(0, -1))).toBeNull();
    expect(run([0, 1, 0, 1, 0])).toBeNull();
    expect(run([0, 1, 2, 3, 0, 1, 2, 3, 0])).toBeNull();
    expect(run(input, { ...region, maxY: 600 })).toBeNull();
    expect(run([-1, 1, 2, -1])).toBeNull();
  });

  it('detects ordered local damage without claiming anatomical or semantic confidence', () => {
    const { g, square, placement, input, perfect: perfectPath } = fixture();
    const perfect = relationDiagnostics(g, square, placement, perfectPath);
    const damaged = relationDiagnostics(g, square, placement, input);
    expect(perfect.meanOrderedError).toBeLessThan(1e-8);
    expect(damaged.worstSegmentError).toBeGreaterThan(perfect.worstSegmentError + .1);
    expect(damaged.relationObjective).toBeGreaterThan(damaged.objective);
  });

  it('checks native edge lengths independently and never reports a seam change as a repair', () => {
    const { g, square, placement, input, perfect, region } = fixture();
    const inflated = { ...g, adjLen: Float32Array.from(g.adjLen, length => length * 2) };
    expect(relationGuidedSearch(inflated, square, placement, input, region,
      { mode: 'relation', maxProposals: 0 })).toBeNull();
    const shifted = [...perfect.slice(7, -1), ...perfect.slice(0, 7), perfect[7]];
    const result = relationGuidedSearch(g, square, placement, shifted, region,
      { mode: 'relation', maxProposals: 8, maxExpanded: 1000 })!;
    expect(result.evaluated.path).toEqual(shifted);
    expect(result.acceptedRepairs).toBe(0);
  });
});
