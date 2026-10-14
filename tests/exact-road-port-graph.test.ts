import { expect, it } from 'vitest';
import { exactRoadPortGraph, encodeExactRoadPath, expandExactRoadPath } from '@/lib/route/exactRoadPortGraph';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';

it('retains degree-two bends, native lengths, partial spans, and reverse traversal', () => {
  const origin = makeOrigin(35, 129), ll = [[0, 0], [100, 0], [100, 100], [200, 100], [300, 100]].map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), ll.slice(1).map((_, i) => ({ a: i, b: i + 1, factor: 1 })), null);
  const pg = exactRoadPortGraph(g, { minX: -1, minY: -1, maxX: 201, maxY: 101 });
  expect(pg.insideEdgeCount).toBe(3); expect(pg.edges).toHaveLength(1); expect(pg.edges[0].nodes).toEqual([0, 1, 2, 3]); expect(pg.edges[0].lengthMeters).toBeCloseTo(300, 3);
  for (const ns of [[0, 1, 2, 3], [3, 2, 1, 0], [1, 2, 3], [0, 1, 2, 1, 0]]) expect(expandExactRoadPath(pg, encodeExactRoadPath(pg, ns))).toEqual(ns);
  expect(() => encodeExactRoadPath(pg, [3, 4])).toThrow();
});

it('anchors a pure degree-two cycle at its coordinate minimum and preserves arbitrary seams', () => {
  const origin = makeOrigin(35, 129), ll = [[0, 0], [100, 0], [100, 100], [0, 100]].map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), ll.map((_, i) => ({ a: i, b: (i + 1) % 4, factor: 1 })), null);
  const pg = exactRoadPortGraph(g, { minX: -1, minY: -1, maxX: 101, maxY: 101 });
  expect(pg.ports).toEqual([0]); expect(pg.edges).toHaveLength(1); expect(pg.edges[0].a).toBe(pg.edges[0].b); expect(pg.insideEdgeCount).toBe(4);
  for (const ns of [[2, 3, 0, 1, 2], [1, 0, 3, 2, 1]]) expect(expandExactRoadPath(pg, encodeExactRoadPath(pg, ns))).toEqual(ns);
  const shuffled = buildGraph(origin, ll.slice().reverse().map(c => c[0]), ll.slice().reverse().map(c => c[1]), ll.map((_, i) => ({ a: 3 - i, b: 3 - (i + 1) % 4, factor: 1 })).reverse(), null);
  const second = exactRoadPortGraph(shuffled, { minX: -1, minY: -1, maxX: 101, maxY: 101 });
  expect(second.edges.map(e => e.nodes.map(v => [shuffled.x[v], shuffled.y[v]]))).toEqual(pg.edges.map(e => e.nodes.map(v => [g.x[v], g.y[v]])));
});

it('keeps branch junctions as actual ports', () => {
  const origin = makeOrigin(35, 129), ll = [[0, 0], [100, 0], [200, 0], [100, 100]].map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), [{ a: 0, b: 1, factor: 1 }, { a: 1, b: 2, factor: 1 }, { a: 1, b: 3, factor: 1 }], null);
  const pg = exactRoadPortGraph(g, { minX: -1, minY: -1, maxX: 201, maxY: 101 });
  expect(pg.ports).toHaveLength(4); expect(pg.incident.get(1)).toHaveLength(3); expect(pg.degree[1]).toBe(3); expect(pg.edges).toHaveLength(3);
});
