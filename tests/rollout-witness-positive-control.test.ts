import { expect, it } from 'vitest';
import { buildGraph, hasEdge, makeOrigin, unproject, type RawEdge } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { evaluatePath, placeShape } from '@/lib/route/fit';
import { SHAPE_BY_ID } from '@/lib/route/shapes';
import { shapeGuidedPortRolloutProductStages } from '@/lib/route/shapeGuidedPortRolloutProductStages';
import { shapeGuidedPortRolloutWitness } from '@/lib/route/shapeGuidedPortRolloutWitness';
import { pairEdgeKey } from '@/lib/route/pairSegmentRepair';
import { createNativeGuideWitnessIndex } from '@/lib/route/nativeGuideWitness';
import { rolloutGuide } from '@/lib/route/shapeGuidedPortRolloutProductStages';

function graph(points: Array<[number, number]>, links: Array<[number, number]>) {
  const origin = makeOrigin(35, 129), ll = points.map(([x, y]) => unproject(origin, x, y));
  return buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), links.map(([a, b]) => ({ a, b, factor: 1 } satisfies RawEdge)), null);
}

it.each([false, true])('observed control reproduces original native paths, Q calls and expansions with feedback=%s', feedback => {
  const g = graph([[0, 0], [800, 0], [800, 800], [0, 800], [-100, 0]], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]]);
  const region = { minX: -101, minY: -1, maxX: 801, maxY: 801 }, p = { cx: 400, cy: 400, scale: 800, rotDeg: 0 }, pg = exactRoadPortGraph(g, region);
  const original = shapeGuidedPortRolloutProductStages(g, pg, SHAPE_BY_ID.square, region, [p], feedback);
  const observed = shapeGuidedPortRolloutWitness(g, pg, SHAPE_BY_ID.square, region, [p], feedback, false);
  expect(observed.pool.map(c => ({ nodes: c.nodes, raw: c.raw, zero: c.zeroAdvances }))).toEqual(original.pool.map(c => ({ nodes: c.nodes, raw: c.raw, zero: c.zeroAdvances })));
  for (const key of ['expansions', 'rolloutQCalls', 'strictRollouts', 'uniqueGeometries', 'emittedPhaseBranches', 'dpCacheHits', 'dpCacheMisses', 'dpIntervalTests'] as const) expect(observed.diagnostics[key]).toBe(original.diagnostics[key]);
  expect(observed.diagnostics.witnessPoses[0].segmentDistanceTests).toBeGreaterThan(0);
  expect(observed.diagnostics.witnessRescueTraces).toHaveLength(0);
});

it.each([1, 8])('keeps native self-loop, sparse checkpoint jumps and exact100 square with %i subdivisions', divisions => {
  const points: Array<[number, number]> = [];
  for (let side = 0; side < 4; side++) for (let k = 0; k < divisions; k++) { const d = k * 800 / divisions; points.push(side === 0 ? [d, 0] : side === 1 ? [800, d] : side === 2 ? [800 - d, 800] : [0, 800 - d]); }
  const g = graph(points, points.map((_, i) => [i, (i + 1) % points.length])), region = { minX: -1, minY: -1, maxX: 801, maxY: 801 }, p = { cx: 400, cy: 400, scale: 800, rotDeg: 0 };
  const result = shapeGuidedPortRolloutWitness(g, exactRoadPortGraph(g, region), SHAPE_BY_ID.square, region, [p], false, true);
  expect(result.pool[0].candidate.similarity).toBe(100); expect(result.pool[0].nativeWitness.guideToRoute).toBeCloseTo(0, 6);
  expect(result.pool[0].nativeWitness.featureCoverage).toBe(1); expect(result.diagnostics.phaseAdvanceWithoutMovement).toBeGreaterThan(0);
  for (const c of result.pool) expect(c.nodes.every((v, i) => !i || hasEdge(g, c.nodes[i - 1], v))).toBe(true);
});

it('keeps a real delayed repeated connector in the witness policy', () => {
  const g = graph([[0, 0], [800, 0], [800, 800], [0, 800], [-100, 0]], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]]);
  const region = { minX: -101, minY: -1, maxX: 801, maxY: 801 }, p = { cx: 400, cy: 400, scale: 800, rotDeg: 0 };
  const result = shapeGuidedPortRolloutWitness(g, exactRoadPortGraph(g, region), SHAPE_BY_ID.square, region, [p], true, true);
  expect(result.diagnostics.immediateReverseRejected).toBeGreaterThan(0);
  expect(result.pool.some(c => c.candidate.repeatRatio > 0 && c.candidate.repeatRatio <= .2)).toBe(true);
});

function catFixture(commonPort = 7) {
  const shape = SHAPE_BY_ID.cat, p = { cx: 0, cy: 0, scale: 1100, rotDeg: 0 }, points = placeShape(shape.points, p).slice(0, -1);
  const links: Array<[number, number]> = points.map((_, i) => [i, (i + 1) % points.length]);
  for (const [dx, dy] of [[70, 90], [80, 100], [90, 110], [100, 120]]) {
    const node = points.length; points.push([points[5][0] - dx, points[5][1] - dy]); links.push([4, node], [node, 6]);
  }
  for (const [v, dx, dy] of [[0, 0, -25], [commonPort, 0, 25]]) { const node = points.length; points.push([points[v][0] + dx, points[v][1] + dy]); links.push([v, node]); }
  const g = graph(points, links), region = { minX: -551, minY: -576, maxX: 551, maxY: 601 }, pg = exactRoadPortGraph(g, region);
  return { g, pg, shape, region, p };
}

it('evaluates a previously untested native prefix and a genuinely better completed cat geometry', () => {
  const { g, pg, shape, region, p } = catFixture();
  const control = shapeGuidedPortRolloutWitness(g, pg, shape, region, [p], false, false);
  const enabled = shapeGuidedPortRolloutWitness(g, pg, shape, region, [p], false, true);
  const rescued = enabled.pool.filter(c => c.provenance.witnessRescueIds.length);
  const evicted = enabled.diagnostics.witnessRescueTraces.filter(t => t.reason === 'tested-prefix');
  const descendants = enabled.diagnostics.witnessCompletedLineage.filter(c => c.witnessRescueIds.some(id => evicted.some(t => t.id === id && t.arcPath.length < c.goalArcPath.length && t.stateId < c.goalStateId)));
  expect(enabled.pool.length).toBeGreaterThan(0);
  expect(rescued.length).toBeGreaterThan(0); expect(evicted.length).toBeGreaterThan(0); expect(descendants.length).toBeGreaterThan(0);
  for (const t of evicted) {
    expect(t.parentStateId).not.toBeNull(); expect(t.stateId).toBeGreaterThan(t.parentStateId!);
  }
  expect(enabled.pool[0].raw).toBeGreaterThan(control.pool[0].raw + 1e-7);
  expect(pairEdgeKey(enabled.pool[0].nodes)).not.toBe(pairEdgeKey(control.pool[0].nodes));
  expect(enabled.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(control.diagnostics.expansions).toBeLessThanOrEqual(400000);
  expect(enabled.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512); expect(control.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
  console.log(JSON.stringify({ mechanism: 'tested-prefix', controlBest: control.pool[0].raw, enabledBest: enabled.pool[0].raw, rescuedCompleted: rescued.length, nativeClosureDescendants: descendants.length, controlQ: control.diagnostics.rolloutQCalls, enabledQ: enabled.diagnostics.rolloutQCalls, controlExp: control.diagnostics.expansions, enabledExp: enabled.diagnostics.expansions }));
  for (const c of rescued) for (const id of c.provenance.witnessRescueIds) {
    const trace = enabled.diagnostics.witnessRescueTraces.find(t => t.id === id); expect(trace).toBeDefined();
    expect(c.provenance.goalArcPath.slice(0, trace!.arcPath.length)).toEqual(trace!.arcPath);
    const e = evaluatePath(g, shape, p, c.nodes, 3000, 8000); expect(e.featureCoverage).toBe(c.nativeWitness.featureCoverage);
    expect(c.nodes[0]).toBe(c.nodes.at(-1)); expect(e.lengthMeters).toBeGreaterThanOrEqual(3000); expect(e.lengthMeters).toBeLessThanOrEqual(8000); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
  }
});

it('retains a better-supported actual prefix over four cheaper equal-resource paths and completes its native descendant', () => {
  const { g, pg, shape, region, p } = catFixture(8);
  const control = shapeGuidedPortRolloutWitness(g, pg, shape, region, [p], false, false);
  const enabled = shapeGuidedPortRolloutWitness(g, pg, shape, region, [p], false, true);
  const evicted = enabled.diagnostics.witnessRescueTraces.filter(t => t.reason === 'label' && t.costCompetitors?.length === 4 && t.costCompetitors.every(v => v.cost < t.cost - 1e-9));
  const arcs = pg.edges.flatMap(e => [e.nodes, e.nodes.slice().reverse()]).map((nodes, id) => ({ id, nodes }));
  const index = createNativeGuideWitnessIndex(g, shape, p, rolloutGuide(shape, p));
  const support = (path: number[]) => { let witness = index.initial(arcs[path[0]].nodes[0]); for (const id of path) witness = index.append(witness, arcs[id]); return index.summary(witness); };
  const stronger = evicted.filter(t => t.costCompetitors!.every(v => support(t.arcPath).featureCoverage > support(v.arcPath).featureCoverage));
  const descendants = enabled.diagnostics.witnessCompletedLineage.filter(c => c.witnessRescueIds.some(id => stronger.some(t => t.id === id && t.arcPath.length < c.goalArcPath.length && t.stateId < c.goalStateId)));
  console.log(JSON.stringify({ mechanism: 'label', strictFourCheaper: evicted.length, strongerFeatures: stronger.length, completedNativeDescendants: descendants.length, controlBest: control.pool[0]?.raw, enabledBest: enabled.pool[0]?.raw, controlQ: control.diagnostics.rolloutQCalls, enabledQ: enabled.diagnostics.rolloutQCalls, controlExp: control.diagnostics.expansions, enabledExp: enabled.diagnostics.expansions }));
  expect(evicted.length).toBeGreaterThan(0); expect(stronger.length).toBeGreaterThan(0); expect(descendants.length).toBeGreaterThan(0);
  for (const t of stronger) {
    expect(t.parentStateId).not.toBeNull(); expect(t.stateId).toBeGreaterThan(t.parentStateId!);
    for (const v of t.costCompetitors!) { expect(v.incoming).toBe(t.incoming); expect(v.phase).toBe(t.phase); expect(v.lengthBucket).toBe(t.lengthBucket); expect(v.arcPath).not.toEqual(t.arcPath); }
  }
  for (const c of descendants) {
    const e = evaluatePath(g, shape, p, c.nativeNodes, 3000, 8000);
    const raw = 100 * Math.exp(-e.meanDev / (.08 * p.scale) - Math.log1p(.03 * e.zigzagPerKm) + Math.log(.55 + .45 * e.featureCoverage) + e.spikes * Math.log(.9));
    expect(raw).toBeCloseTo(c.raw, 8); expect(c.nativeNodes.every((v, i) => !i || hasEdge(g, c.nativeNodes[i - 1], v))).toBe(true);
    expect(c.nativeNodes[0]).toBe(c.nativeNodes.at(-1)); expect(e.lengthMeters).toBeGreaterThanOrEqual(3000); expect(e.lengthMeters).toBeLessThanOrEqual(8000); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
    for (const id of c.witnessRescueIds) { const t = enabled.diagnostics.witnessRescueTraces[id]; expect(c.goalArcPath.slice(0, t.arcPath.length)).toEqual(t.arcPath); }
  }
  expect(enabled.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(control.diagnostics.expansions).toBeLessThanOrEqual(400000);
  expect(enabled.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512); expect(control.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
});
