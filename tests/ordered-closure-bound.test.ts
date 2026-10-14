import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { createOrderedClosureBound } from '@/lib/route/orderedClosureBound';

it('bounds an ordered closed suffix and stops requiring checkpoints after the final phase', () => {
  const origin = makeOrigin(35, 129), xy: Array<[number, number]> = [[0, 0], [800, 0], [800, 800], [0, 800]], ll = xy.map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(v => v[0]), ll.map(v => v[1]), xy.map((_, i) => ({ a: i, b: (i + 1) % 4, factor: 1 })), null);
  const pg = exactRoadPortGraph(g, { minX: -1, minY: -1, maxX: 801, maxY: 801 }), guide = [...xy, xy[0]], tight = createOrderedClosureBound(g, pg, guide, 0, 0), tolerant = createOrderedClosureBound(g, pg, guide, 128, 0);
  expect(tight.estimate(0, 0)).toBeCloseTo(3200, 3);
  expect(tight.estimate(1, 1)).toBeCloseTo(2400, 3);
  expect(tight.estimate(1, 4)).toBeCloseTo(800, 3);
  expect(tolerant.estimate(0, 0)).toBeLessThanOrEqual(tight.estimate(0, 0));
  expect(tolerant.estimate(0, 0)).toBeGreaterThan(2000);
  expect(tight.estimate(0, 4)).toBe(0);
  expect(tight.estimate(0, 0)).toBeLessThanOrEqual(pg.edges[0].lengthMeters);
});
