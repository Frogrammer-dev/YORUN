import { expect, it } from 'vitest';
import { clippedRoadCorridors } from '@/lib/route/clippedRoadCorridors';
import { buildGraph, hasEdge, makeOrigin, unproject } from '@/lib/route/graph';
import { maximalRoadCorridors } from '@/lib/route/roadCorridorDecomposition';

it('retains only existing inside nodes and edges without inserting bbox intersections', () => {
  const origin = makeOrigin(35, 129), ll = [-50, 40, 130, 220, 310, 400, 490].map(x => unproject(origin, x, 0));
  const edges = ll.slice(1).map((_, i) => ({ a: i, b: i + 1, factor: 1 }));
  const g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), edges, null), region = { minX: 0, maxX: 450, minY: -1, maxY: 1 };
  expect(maximalRoadCorridors(g, region).chains).toHaveLength(0);
  const clipped = clippedRoadCorridors(g, region); expect(clipped.chains).toHaveLength(1);
  const c = clipped.chains[0]; expect(c.nodes).toHaveLength(5); expect(c.length).toBeCloseTo(360, 3);
  expect(c.nodes.map(v => Math.round(g.x[v]))).toEqual([40, 130, 220, 310, 400]); expect(c.nodes.every((v, i) => !i || hasEdge(g, c.nodes[i - 1], v))).toBe(true);
  const shuffled = buildGraph(origin, ll.slice().reverse().map(c => c[0]), ll.slice().reverse().map(c => c[1]), edges.slice().reverse().map(e => ({ ...e, a: 6 - e.a, b: 6 - e.b })), null);
  const second = clippedRoadCorridors(shuffled, region); expect(second.chains.map(t => t.nodes.map(v => Math.round(shuffled.x[v])))).toEqual([[40, 130, 220, 310, 400]]);
  expect(clippedRoadCorridors(g, { ...region, minX: 100, maxX: 200 }).chains).toHaveLength(0);
});
