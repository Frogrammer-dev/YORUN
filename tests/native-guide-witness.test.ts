import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { createNativeGuideWitnessIndex, selectWitnessLabels } from '@/lib/route/nativeGuideWitness';
import { evaluatePath, placeShape } from '@/lib/route/fit';
import { buildGraph, hasEdge, makeOrigin, pointSegDist, unproject, type RawEdge } from '@/lib/route/graph';
import { polylineLength, resample, SHAPE_BY_ID } from '@/lib/route/shapes';
import { rolloutGuide } from '@/lib/route/shapeGuidedPortRolloutProductStages';

const placement = { cx: 400, cy: 400, scale: 800, rotDeg: 0 };
function fixture(points: Array<[number, number]>, links: Array<[number, number]>) {
  const origin = makeOrigin(35, 129), ll = points.map(([x, y]) => unproject(origin, x, y));
  return buildGraph(origin, ll.map(v => v[0]), ll.map(v => v[1]), links.map(([a, b]) => ({ a, b, factor: 1 } satisfies RawEdge)), null);
}
function independentForward(g: ReturnType<typeof fixture>, path: number[]) {
  const route = path.map(v => [g.x[v], g.y[v]] as [number, number]), outline = placeShape(SHAPE_BY_ID.square.points, placement);
  const samples = resample(route, Math.max(8, Math.round(polylineLength(route) / 12)));
  return samples.reduce((sum, [x, y]) => sum + Math.min(...outline.slice(1).map((b, i) => pointSegDist(x, y, ...outline[i], ...b))), 0) / samples.length;
}

it.each([1, 8])('matches original completed d2 and features on a native3200m closed square with %i subdivisions', divisions => {
  const points: Array<[number, number]> = [];
  for (let side = 0; side < 4; side++) for (let k = 0; k < divisions; k++) {
    const d = k * 800 / divisions; points.push(side === 0 ? [d, 0] : side === 1 ? [800, d] : side === 2 ? [800 - d, 800] : [0, 800 - d]);
  }
  const g = fixture(points, points.map((_, i) => [i, (i + 1) % points.length]));
  const path = [...Array.from({ length: g.n }, (_, i) => i), 0], before = { x: g.x.slice(), y: g.y.slice(), len: g.adjLen.slice() };
  const index = createNativeGuideWitnessIndex(g, SHAPE_BY_ID.square, placement, rolloutGuide(SHAPE_BY_ID.square, placement));
  let witness = index.initial(path[0]);
  for (let i = 1; i < path.length; i++) witness = index.append(witness, { id: i - 1, nodes: [path[i - 1], path[i]] });
  const summary = index.summary(witness), e = evaluatePath(g, SHAPE_BY_ID.square, placement, path, 3000, 8000);
  expect(e.lengthMeters).toBeCloseTo(3200, 4); expect(e.similarity).toBe(100);
  expect(summary.guideToRoute).toBeCloseTo(2 * e.meanDev - independentForward(g, path), 9);
  expect(summary.featureCoverage).toBe(e.featureCoverage); expect(summary.featureCoverage).toBe(1);
  expect(summary.guideSamples).toBe(resample(placeShape(SHAPE_BY_ID.square.points, placement), Math.max(8, Math.round(3200 / 12))).length);
  expect(g.x).toEqual(before.x); expect(g.y).toEqual(before.y); expect(g.adjLen).toEqual(before.len);
  expect(index.diagnostics().segmentDistanceTests).toBeGreaterThan(0); expect(index.diagnostics().includedInExpansionBudget).toBe(false);
});

it('measures a missing native corner with the unchanged actual evaluator rather than its phase number', () => {
  const points: Array<[number, number]> = [[0, 0], [800, 0], [800, 560], [560, 800], [0, 800]];
  const g = fixture(points, [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0]]), path = [0, 1, 2, 3, 4, 0];
  const index = createNativeGuideWitnessIndex(g, SHAPE_BY_ID.square, placement, rolloutGuide(SHAPE_BY_ID.square, placement));
  const first = index.initial(0), witness = index.append(first, { id: 0, nodes: path });
  const summary = index.summary(witness), e = evaluatePath(g, SHAPE_BY_ID.square, placement, path, 3000, 8000);
  expect(e.lengthMeters).toBeGreaterThan(3000); expect(e.repeatRatio).toBe(0); expect(e.featureCoverage).toBe(.75);
  expect(summary.featureCoverage).toBe(e.featureCoverage); expect(summary.guideToRoute).toBeCloseTo(2 * e.meanDev - independentForward(g, path), 9);
  expect(summary.guideToRoute).toBeGreaterThan(0); expect(witness.guideDistances).not.toBe(first.guideDistances);
});

it('retains all real self-loop geometry and later connector reuse without inserting witness points', () => {
  const g = fixture([[0, 0], [800, 0], [800, 800], [0, 800], [-100, 0]], [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4]]);
  const index = createNativeGuideWitnessIndex(g, SHAPE_BY_ID.square, placement, rolloutGuide(SHAPE_BY_ID.square, placement));
  const circle = { id: 0, nodes: [0, 1, 2, 3, 0] }, outward = { id: 1, nodes: [0, 4] }, inward = { id: 2, nodes: [4, 0] };
  let witness = index.initial(0); witness = index.append(witness, outward); witness = index.append(witness, inward); witness = index.append(witness, circle); witness = index.append(witness, outward); witness = index.append(witness, inward);
  const path = [0, 4, 0, 1, 2, 3, 0, 4, 0];
  expect(path.every((v, i) => !i || hasEdge(g, path[i - 1], v))).toBe(true);
  const e = evaluatePath(g, SHAPE_BY_ID.square, placement, path, 3000, 8000), summary = index.summary(witness);
  expect(e.repeatRatio).toBeGreaterThan(0); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
  expect(summary.guideToRoute).toBeCloseTo(2 * e.meanDev - independentForward(g, path), 9);
  expect(summary.featureCoverage).toBe(e.featureCoverage); expect(index.diagnostics().arcCacheHits).toBe(2);
  expect(index.diagnostics().actualNodeInsertion).toBe(false);
});

it('rejects nonexistent spans and an arc ID reused for a different native geometry', () => {
  const g = fixture([[0, 0], [800, 0], [800, 800], [0, 800]], [[0, 1], [1, 2], [2, 3], [3, 0]]);
  const index = createNativeGuideWitnessIndex(g, SHAPE_BY_ID.square, placement, rolloutGuide(SHAPE_BY_ID.square, placement)), first = index.initial(0);
  expect(() => index.append(first, { id: 0, nodes: [0, 2] })).toThrow('nonexistent native edge');
  index.append(first, { id: 1, nodes: [0, 1] });
  expect(() => index.append(first, { id: 1, nodes: [1, 2] })).toThrow('identity changed');
});

it('activates the real corner feature at its guide station rather than using a future feature early', () => {
  const g = fixture([[0, 0], [700, 0], [800, 0], [700, 200], [800, 200]], [[0, 1], [1, 2], [1, 3], [3, 4]]);
  const index = createNativeGuideWitnessIndex(g, SHAPE_BY_ID.square, placement, rolloutGuide(SHAPE_BY_ID.square, placement)), start = index.initial(0);
  const a = { phase: 8, cost: 2, hash: 2, witness: index.append(start, { id: 0, nodes: [0, 1, 2] }) };
  const b = { phase: 8, cost: 1, hash: 1, witness: index.append(start, { id: 1, nodes: [0, 1, 3, 4] }) };
  // Artificial equal-support proxy ordering isolates the active-station boundary;
  // it is not evidence of whole-route Q or native generator improvement.
  expect(index.diversify([a, b], [], 1, 7)).toEqual([b]);
  expect(index.diversify([a, b], [], 1, 8)).toEqual([a]);
});

it('keeps the original cost/hash retention when native support is identical', () => {
  const g = fixture([[0, 0], [800, 0]], [[0, 1]]);
  const index = createNativeGuideWitnessIndex(g, SHAPE_BY_ID.square, placement, rolloutGuide(SHAPE_BY_ID.square, placement));
  const witness = index.append(index.initial(0), { id: 0, nodes: [0, 1] });
  const states = [5, 3, 4, 1, 2].map(hash => ({ phase: 8, cost: 1, hash, witness }));
  expect(selectWitnessLabels(states, index, 8, false).map(s => s.hash)).toEqual([1, 2, 3, 4]);
  expect(selectWitnessLabels(states, index, 8, true).map(s => s.hash)).toEqual([1, 2, 3, 4]);
});

it('matches the byte-controlled clone and restores the exact frozen ProductStages source', () => {
  const result = JSON.parse(execFileSync(process.execPath, ['tests/eval/create-witness-rollout.mjs', '--check'], { encoding: 'utf8' }));
  expect(result.sourceHash).toBe('3fd8205b351274692ba349cdd2a9268bc40437715be3b0018938ccdc67163093');
  expect(result.inverseRestoredFrozenSource).toBe(true); expect(result.anchors).toBe(21);
});
