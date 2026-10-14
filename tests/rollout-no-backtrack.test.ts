import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject, hasEdge } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { shapeGuidedPortRolloutNoBacktrack } from '@/lib/route/shapeGuidedPortRolloutNoBacktrack';
import { shapeGuidedPortRolloutAStar } from '@/lib/route/shapeGuidedPortRolloutAStar';
import { shapeGuidedPortRolloutProductBound } from '@/lib/route/shapeGuidedPortRolloutProductBound';
import { shapeGuidedPortRolloutProductStages } from '@/lib/route/shapeGuidedPortRolloutProductStages';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.each([
  { name: 'no immediate reverse', search: shapeGuidedPortRolloutNoBacktrack },
  { name: 'completed suffix bound', search: shapeGuidedPortRolloutAStar },
  { name: 'road product suffix bound', search: shapeGuidedPortRolloutProductBound },
  { name: 'road product fixed stage caps', search: shapeGuidedPortRolloutProductStages },
])('$name retains a real closed route and delayed repeated connector while rejecting immediate reversals', ({ search }) => {
  const origin = makeOrigin(35, 129), xy = [[0, 0], [800, 0], [800, 800], [0, 800], [-100, 0]], ll = xy.map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(v => v[0]), ll.map(v => v[1]), [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]].map(([a, b]) => ({ a, b, factor: 1 })), null);
  const region = { minX: -101, minY: -1, maxX: 801, maxY: 801 }, p = { cx: 400, cy: 400, scale: 800, rotDeg: 0 };
  const result = search(g, exactRoadPortGraph(g, region), SHAPE_BY_ID.square, region, [p], false);
  expect(result.diagnostics.immediateReverseRejected).toBeGreaterThan(0);
  expect(result.pool.some(c => c.candidate.similarity === 100)).toBe(true);
  expect(result.pool.some(c => c.candidate.repeatRatio > 0 && c.candidate.repeatRatio <= .2)).toBe(true);
  for (const c of result.pool) expect(c.nodes.every((v, i) => !i || hasEdge(g, c.nodes[i - 1], v))).toBe(true);
  expect(result.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(result.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
});
