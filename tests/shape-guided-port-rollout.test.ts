import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject, hasEdge, type RawEdge } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { SHAPE_BY_ID } from '@/lib/route/shapes';
import { placeShape } from '@/lib/route/fit';
import { rolloutGuide, shapeGuidedPortRolloutBeam, selectRolloutBeam, rolloutTestPrefixes } from '@/lib/route/shapeGuidedPortRolloutBeam';
import { shapeGuidedPortRolloutScheduled } from '@/lib/route/shapeGuidedPortRolloutScheduled';

const region = { minX: -1, minY: -1, maxX: 801, maxY: 801 }, placement = { cx: 400, cy: 400, scale: 800, rotDeg: 0 };
function squareGraph(open = false) {
  const origin = makeOrigin(35, 129), points: Array<[number, number]> = [];
  for (let side = 0; side < 4; side++) for (let i = 0; i < 8; i++) points.push(side === 0 ? [i * 100, 0] : side === 1 ? [800, i * 100] : side === 2 ? [800 - i * 100, 800] : [0, 800 - i * 100]);
  const coords = points.map(([x, y]) => unproject(origin, x, y)), edges: RawEdge[] = points.map((_, i) => ({ a: i, b: (i + 1) % points.length, factor: 1 })).filter((_, i) => !open || i !== points.length - 1);
  return buildGraph(origin, coords.map(p => p[0]), coords.map(p => p[1]), edges, null);
}

it('keeps original vertices in the ordered guide and restores actual strict rollouts', () => {
  const shape = SHAPE_BY_ID.square, guide = rolloutGuide(shape, placement);
  for (const point of placeShape(shape.points, placement)) expect(guide.some(q => Math.hypot(q[0] - point[0], q[1] - point[1]) < 1e-8)).toBe(true);
  const g = squareGraph(), pg = exactRoadPortGraph(g, region), control = shapeGuidedPortRolloutBeam(g, pg, shape, region, [placement], false), feedback = shapeGuidedPortRolloutBeam(g, pg, shape, region, [placement], true);
  expect(control.pool.length).toBeGreaterThan(0); expect(feedback.pool.length).toBeGreaterThan(0);
  for (const arm of [control, feedback]) { expect(arm.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(arm.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512); for (const p of arm.pool) { expect(p.nodes[0]).toBe(p.nodes.at(-1)); expect(p.nodes.every((v, i) => !i || hasEdge(g, p.nodes[i - 1], v))).toBe(true); expect(p.candidate.lengthMeters).toBeCloseTo(3200, 1); expect(p.candidate.repeatRatio).toBeLessThanOrEqual(.2); } }
  expect(control.pool[0].raw).toBeCloseTo(feedback.pool[0].raw, 8);
});

it('cannot fill a missing actual corner with a visual bridge', () => {
  const g = squareGraph(true), pg = exactRoadPortGraph(g, region), result = shapeGuidedPortRolloutBeam(g, pg, SHAPE_BY_ID.square, region, [placement], true);
  expect(result.pool).toHaveLength(0);
});

it('whole-Q feedback changes beam membership instead of only ordering already retained prefixes', () => {
  const reached = Array.from({ length: 64 }, (_, i) => ({ cost: i, hash: i })), tested = rolloutTestPrefixes(reached);
  expect(tested.tested).toEqual([reached[0], reached[1], reached[16], reached[17]]); expect(tested.outsideControl).toBe(2);
  const scores = new Map([[tested.tested[2], 95], [tested.tested[3], 80], [tested.tested[0], 70], [tested.tested[1], 60]]);
  const control = selectRolloutBeam(reached, scores, false), treatment = selectRolloutBeam(reached, scores, true);
  expect(control.selected).toHaveLength(16); expect(treatment.selected).toHaveLength(16);
  expect(control.selected.includes(reached[16])).toBe(false); expect(treatment.selected.includes(reached[16])).toBe(true);
  expect(treatment.selected.slice(0, 2)).toEqual([reached[16], reached[17]]); expect(treatment.feedbackEliteSelected).toBe(2);
});

it('remaining-unit scheduling preserves strict geometry and accounts for every intra-unit call ceiling', () => {
  const g = squareGraph(), pg = exactRoadPortGraph(g, region), result = shapeGuidedPortRolloutScheduled(g, pg, SHAPE_BY_ID.square, region, [placement], true);
  expect(result.pool.length).toBeGreaterThan(0); expect(result.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(result.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
  for (const unit of result.diagnostics.units) {
    if (!unit.searchCalls) continue;
    expect(unit.expansions + unit.unusedUnitBudget).toBe(25000);
    for (const call of unit.searchCalls) { expect(call.effectiveCap).toBe(25000 - call.budgetUsedBefore); expect(call.remainingAfter).toBe(25000 - call.budgetUsedAfter); expect(call.expanded + call.unusedCallCap).toBe(call.effectiveCap); }
  }
  for (const entry of result.pool) { expect(entry.nodes.every((v, i) => !i || hasEdge(g, entry.nodes[i - 1], v))).toBe(true); expect(entry.candidate.lengthMeters).toBeCloseTo(3200, 1); expect(entry.candidate.repeatRatio).toBeLessThanOrEqual(.2); }
});
