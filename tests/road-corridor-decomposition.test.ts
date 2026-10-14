import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { maximalRoadCorridors } from '@/lib/route/roadCorridorDecomposition';

it('preserves maximal corridor geometry when grid node and edge orders change', () => {
  const origin = makeOrigin(35, 129), coords: Array<[number, number]> = [], edges: Array<{ a: number; b: number; factor: number }> = [];
  for (let y = 0; y <= 6; y++) for (let x = 0; x <= 6; x++) {
    coords.push(unproject(origin, x * 100, y * 100)); const n = y * 7 + x;
    if (x) edges.push({ a: n - 1, b: n, factor: 1 }); if (y) edges.push({ a: n - 7, b: n, factor: 1 });
  }
  const g1 = buildGraph(origin, coords.map(c => c[0]), coords.map(c => c[1]), edges, null);
  const permutation = coords.map((_, i) => (i * 17) % coords.length), inverse = new Map(permutation.map((v, i) => [v, i])), reordered = permutation.map(i => coords[i]);
  const g2 = buildGraph(origin, reordered.map(c => c[0]), reordered.map(c => c[1]), edges.slice().reverse().map(e => ({ ...e, a: inverse.get(e.a)!, b: inverse.get(e.b)! })), null);
  const region = { minX: -1, minY: -1, maxX: 601, maxY: 601 }, a = maximalRoadCorridors(g1, region), b = maximalRoadCorridors(g2, region);
  const geometries = (g: typeof g1, c: typeof a) => c.chains.map(p => p.nodes.map(v => `${g.x[v].toFixed(5)},${g.y[v].toFixed(5)}`).join('|')).sort();
  expect(geometries(g1, a)).toEqual(geometries(g2, b)); expect(a.chains).toHaveLength(14);
  expect(a.chains.every(c => c.length > 599)).toBe(true); expect(a.diagnostics.visitedEdges).toBe(g1.edgeCount);
});

it('splits an orthogonal degree-2 bend instead of consuming and discarding its straight sides', () => {
  const origin = makeOrigin(35, 129), ll = [[0, 0], [100, 0], [100, 100]].map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), [{ a: 0, b: 1, factor: 1 }, { a: 1, b: 2, factor: 1 }], null);
  const result = maximalRoadCorridors(g, { minX: -1, minY: -1, maxX: 101, maxY: 101 });
  expect(result.chains).toHaveLength(2); expect(result.diagnostics.notStraight).toBe(0);
});
