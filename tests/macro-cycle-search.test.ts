import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject, hasEdge, type RawEdge } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { macroCycleSearch, MACRO_CYCLE_PARAMS } from '@/lib/route/macroCycleSearch';

const region = { minX: -10, minY: -10, maxX: 810, maxY: 810 };
function rectangle(open = false, reversed = false) {
  const origin = makeOrigin(35, 129), coords = [[0, 0], [800, 0], [800, 800], [0, 800]].map(([x, y]) => unproject(origin, x, y));
  const edges: RawEdge[] = [[0, 1], [1, 2], [2, 3], ...(open ? [] : [[3, 0]])].map(([a, b]) => ({ a, b, factor: 1 }));
  return buildGraph(origin, coords.map(v => v[0]), coords.map(v => v[1]), reversed ? edges.reverse() : edges, null);
}

it('preserves a pure degree-two actual 3.2km cycle and rejects repeated returns', () => {
  const g = rectangle(), pg = exactRoadPortGraph(g, region), result = macroCycleSearch(g, pg, region);
  expect(pg.edges).toHaveLength(1); expect(result.candidates).toHaveLength(1);
  const c = result.candidates[0]; expect(c.nodes[0]).toBe(c.nodes.at(-1)); expect(c.lengthMeters).toBeCloseTo(3200, 2);
  expect(c.repeatRatio).toBe(0); expect(c.nodes.every((v, i) => !i || hasEdge(g, c.nodes[i - 1], v))).toBe(true);
  expect(result.diagnostics.repeatBoundRejected).toBeGreaterThan(0); expect(result.diagnostics.duplicateClosures).toBeGreaterThan(0);
  expect(result.params.candidateQualityUsed).toBe(false); expect(result.diagnostics.maxLiveStates).toBeLessThanOrEqual(MACRO_CYCLE_PARAMS.statesPerLayer);
});

it('never invents a missing corner and gives geometry independent of input edge order', () => {
  const g = rectangle(true); expect(macroCycleSearch(g, exactRoadPortGraph(g, region), region).candidates).toHaveLength(0);
  const a = rectangle(), b = rectangle(false, true);
  expect(macroCycleSearch(a, exactRoadPortGraph(a, region), region).candidates.map(c => c.geometryKey)).toEqual(macroCycleSearch(b, exactRoadPortGraph(b, region), region).candidates.map(c => c.geometryKey));
});
