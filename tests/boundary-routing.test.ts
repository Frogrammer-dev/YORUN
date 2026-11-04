import { expect, it } from 'vitest';
import { buildGraph, hasEdge, makeOrigin, unproject } from '@/lib/route/graph';
import { boundaryEdgeKey, routeBoundarySegment } from '@/lib/route/boundaryRouting';

function fixture() {
  const origin = makeOrigin(37, 127);
  const xy: [number, number][] = [[-100, 0], [0, 0], [0, 100], [100, 0], [150, 100]];
  const ll = xy.map(p => unproject(origin, ...p));
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]),
    [[0, 1], [1, 2], [1, 3], [2, 4], [4, 3]].map(([a, b]) => ({ a, b, factor: 1 })), null);
  const ids = xy.map(p => g.nodeIndex.nearest(...p, 1));
  const options = { region: { minX: -200, minY: -200, maxX: 200, maxY: 200 }, maxExpanded: 100, now: () => 0 };
  const budget = { expanded: 0, maxExpanded: 100, deadlineMs: 10 };
  return { g, ids, options, budget };
}

it('finds an actual independent boundary instead of retracing the shared central node', () => {
  const { g, ids: [left, middle, tip, right, alternative], options, budget } = fixture();
  const first = routeBoundarySegment(g, left, tip, options, budget);
  expect(first.path).toEqual([left, middle, tip]);
  const next = routeBoundarySegment(g, tip, right, { ...options, forbiddenNodes: new Set([left, middle]) }, budget);
  expect(next.path).toEqual([tip, alternative, right]);
  expect(next.path!.every((v, i, p) => !i || hasEdge(g, p[i - 1], v))).toBe(true);
  expect(budget.expanded).toBe(first.expanded + next.expanded);
});

it('honors reversed edge exclusions and refuses invented connections', () => {
  const { g, ids: [left, middle, tip, right], options, budget } = fixture();
  const route = routeBoundarySegment(g, tip, left, { ...options, forbiddenEdges: new Set([boundaryEdgeKey(left, middle)]) }, budget);
  expect(route.path).toBeNull(); expect(route.reason).toBe('disconnected');
  const blocked = routeBoundarySegment(g, tip, right, { ...options, forbiddenNodes: new Set([right]) }, budget);
  expect(blocked.reason).toBe('blocked_endpoint');
});

it('stops at exact per-call and shared budgets, including elapsed deadlines', () => {
  const { g, ids: [left, , tip], options, budget } = fixture();
  expect(routeBoundarySegment(g, left, tip, { ...options, maxExpanded: 1 }, budget).reason).toBe('expansion_limit');
  expect(budget.expanded).toBe(1);
  budget.maxExpanded = 1;
  expect(routeBoundarySegment(g, left, tip, options, budget)).toMatchObject({ path: null, expanded: 0, reason: 'budget' });
  budget.maxExpanded = 100;
  expect(routeBoundarySegment(g, left, tip, { ...options, now: () => 10 }, budget).expanded).toBe(0);
});

it('cannot leave the fixed region to bypass a forbidden boundary', () => {
  const { g, ids: [, middle, tip, right], options, budget } = fixture();
  const route = routeBoundarySegment(g, tip, right, { ...options, region: { ...options.region, maxX: 110 }, forbiddenNodes: new Set([middle]) }, budget);
  expect(route.path).toBeNull(); expect(route.reason).toBe('disconnected');
  expect(routeBoundarySegment(g, -1, right, options, budget).reason).toBe('invalid_endpoint');
});
