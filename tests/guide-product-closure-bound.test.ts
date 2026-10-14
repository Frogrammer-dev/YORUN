import { expect, it } from 'vitest';
import { buildGraph, hasEdge, makeOrigin, pointSegDist, unproject, type RawEdge, type RoadGraph } from '@/lib/route/graph';
import { continuousArcPhase } from '@/lib/route/continuousEdgePhase';
import { createGuideProductClosureIndex, type GuideProductArc } from '@/lib/route/guideProductClosureBound';

type Point = [number, number];
const radius = 1e-5, tol = 48;

function squareFixture(divisions: number, open = false) {
  const origin = makeOrigin(35, 129), points: Point[] = [];
  for (let side = 0; side < 4; side++) for (let i = 0; i < divisions; i++) {
    const d = i * 800 / divisions;
    points.push(side === 0 ? [d, 0] : side === 1 ? [800, d] : side === 2 ? [800 - d, 800] : [0, 800 - d]);
  }
  const ll = points.map(([x, y]) => unproject(origin, x, y));
  const edges: RawEdge[] = points.map((_, i) => ({ a: i, b: (i + 1) % points.length, factor: 1 })).filter((_, i) => !open || i < points.length - 1);
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), edges, null);
  const corners = [0, divisions, 2 * divisions, 3 * divisions, 0];
  const guide: Point[] = corners.map(node => [g.x[node], g.y[node]]);
  const arcs: GuideProductArc[] = [];
  for (let side = 0; side < (open ? 3 : 4); side++) {
    const nodes = Array.from({ length: divisions + 1 }, (_, k) => (side * divisions + k) % points.length);
    for (const ns of [nodes, nodes.slice().reverse()]) arcs.push({ id: arcs.length, from: ns[0], to: ns.at(-1)!, nodes: ns });
  }
  return { g, guide, arcs };
}

/** Independent finite-graph Bellman-Ford, using all helper labels without a prefilter. */
function exhaustiveDistances(g: RoadGraph, arcs: GuideProductArc[], guide: Point[], r: number, start: number) {
  const nodes = [...new Set(arcs.flatMap(a => [a.from, a.to]))], size = guide.length;
  const keys = nodes.flatMap(node => guide.map((_, phase) => `${node}:${phase}`));
  const distance = new Map(keys.map(key => [key, Infinity])); distance.set(`${start}:${size - 1}`, 0);
  const transitions: Array<{ from: string; to: string; cost: number }> = [];
  for (const arc of arcs) for (let phase = 0; phase < size; phase++) {
    const options = continuousArcPhase(g, arc.nodes, guide, phase, r, tol);
    for (const label of options.labels) transitions.push({ from: `${arc.from}:${phase}`, to: `${arc.to}:${label.phase}`, cost: label.proxyExtra });
  }
  for (let round = 0; round < keys.length - 1; round++) {
    let changed = false;
    for (const edge of transitions) {
      const value = distance.get(edge.to)! + edge.cost;
      if (value < distance.get(edge.from)!) { distance.set(edge.from, value); changed = true; }
    }
    if (!changed) break;
  }
  return { nodes, distance, transitions };
}

function certificateCost(
  g: RoadGraph, arcs: GuideProductArc[], guide: Point[], r: number,
  certificate: Array<{ arcId: number; initialPhase: number; finalPhase: number }>, startNode: number, phase: number, target: number,
) {
  let node = startNode, cost = 0;
  for (const step of certificate) {
    const arc = arcs[step.arcId]; expect(arc.from).toBe(node); expect(step.initialPhase).toBe(phase);
    expect(arc.nodes.every((v, i) => !i || hasEdge(g, arc.nodes[i - 1], v))).toBe(true);
    const options = continuousArcPhase(g, arc.nodes, guide, phase, r, tol);
    const label = options.labels.find(v => v.phase === step.finalPhase); expect(label).toBeDefined();
    cost += label!.proxyExtra; node = arc.to; phase = step.finalPhase;
  }
  expect(node).toBe(target); expect(phase).toBe(guide.length - 1);
  return cost;
}

it.each([1, 8])('bounds the real 3200m square with %i subdivisions, without changing native nodes or lengths', divisions => {
  const { g, arcs, guide } = squareFixture(divisions);
  const originalX = g.x.slice(), originalY = g.y.slice(), originalNative = g.adjLen.slice(), originalNodes = arcs.map(a => a.nodes.slice());
  const index = createGuideProductClosureIndex(g, arcs, guide, radius, tol), bound = index.toStart(0);
  let matchingCost = 0, phase = 0;
  const suffixCosts = [0];
  for (const arc of arcs.filter(a => a.id % 2 === 0)) {
    const label = continuousArcPhase(g, arc.nodes, guide, phase, radius, tol).labels.find(s => s.phase === phase + 1);
    expect(label).toBeDefined(); matchingCost += label!.proxyExtra; phase++;
    suffixCosts.push(matchingCost);
  }
  expect(phase).toBe(4); expect(matchingCost).toBeCloseTo(3200, 4);
  for (let k = 0; k <= 4; k++) {
    const node = k === 4 ? 0 : k * divisions;
    expect(bound.estimate(node, k)).toBeLessThanOrEqual(matchingCost - suffixCosts[k] + 1e-7);
  }
  expect(bound.estimate(0, 0)).toBeCloseTo(3200, 4);
  const certificate = bound.certificate(0, 0); expect(certificate).not.toBeNull();
  expect(certificateCost(g, arcs, guide, radius, certificate!, 0, 0, 0)).toBeCloseTo(bound.estimate(0, 0), 7);
  expect(g.x).toEqual(originalX); expect(g.y).toEqual(originalY); expect(g.adjLen).toEqual(originalNative);
  expect(arcs.map(a => a.nodes)).toEqual(originalNodes);
  expect(index.toStart(0)).toBe(bound); expect(index.diagnostics().reverseSearches).toBe(1);
  expect(index.diagnostics().reusedStartBounds).toBe(1);
});

it('matches exhaustive current-label shortest suffixes including the exact initial-segment prefilter', () => {
  const { g, arcs, guide: corners } = squareFixture(1);
  const guide: Point[] = corners.slice(0, 4).flatMap((a, side) => Array.from({ length: 8 }, (_, i) => {
    const b = corners[side + 1]; return [a[0] + (b[0] - a[0]) * i / 8, a[1] + (b[1] - a[1]) * i / 8] as Point;
  })); guide.push(corners[4]);
  const r = 128, index = createGuideProductClosureIndex(g, arcs, guide, r, tol);
  for (const start of [0, 1]) {
    const bound = index.toStart(start), exhaustive = exhaustiveDistances(g, arcs, guide, r, start);
    for (const node of exhaustive.nodes) for (let phase = 0; phase < guide.length; phase++) {
      const expected = exhaustive.distance.get(`${node}:${phase}`)!;
      if (Number.isFinite(expected)) {
        expect(bound.estimate(node, phase)).toBeCloseTo(expected, 7);
        const certificate = bound.certificate(node, phase); expect(certificate).not.toBeNull();
        expect(certificateCost(g, arcs, guide, r, certificate!, node, phase, start)).toBeCloseTo(expected, 7);
      } else { expect(bound.estimate(node, phase)).toBe(Infinity); expect(bound.certificate(node, phase)).toBeNull(); }
    }
  }
  let skipped = 0;
  for (const arc of arcs) for (let phase = 0; phase < guide.length; phase++) {
    const segment = Math.min(phase, guide.length - 2);
    if (pointSegDist(g.x[arc.from], g.y[arc.from], ...guide[segment], ...guide[segment + 1]) > 2 * r) {
      skipped++; expect(continuousArcPhase(g, arc.nodes, guide, phase, r, tol).labels).toHaveLength(0);
    }
  }
  expect(skipped).toBeGreaterThan(0); expect(index.diagnostics().necessaryPrefilterSkipped).toBe(skipped);
  expect(index.diagnostics().reverseSearches).toBe(2);
});

it('reads a supplied live-transition cache without filling or changing it during setup', () => {
  const { g, arcs, guide } = squareFixture(1);
  const cached = continuousArcPhase(g, arcs[0].nodes, guide, 0, radius, tol);
  const cache = new Map([['0:0', cached]]), before = JSON.stringify(cached);
  const index = createGuideProductClosureIndex(g, arcs, guide, radius, tol, cache);
  expect(index.diagnostics().cacheHits).toBe(1); expect(index.diagnostics().cacheMisses).toBeGreaterThan(0);
  expect(index.diagnostics().setupCacheNotPopulated).toBe(true);
  expect(cache.size).toBe(1); expect(cache.get('0:0')).toBe(cached); expect(JSON.stringify(cached)).toBe(before);
  expect(index.toStart(0).estimate(0, 0)).toBeCloseTo(3200, 4);
});

it('returns Infinity for a missing real corner and for a disconnected product component', () => {
  const missing = squareFixture(1, true);
  const bound = createGuideProductClosureIndex(missing.g, missing.arcs, missing.guide, radius, tol).toStart(0);
  expect(bound.estimate(0, 0)).toBe(Infinity); expect(bound.certificate(0, 0)).toBeNull();
  expect(bound.estimate(0, 4)).toBe(0); expect(bound.certificate(0, 4)).toEqual([]);

  const complete = squareFixture(1);
  const separated = complete.arcs.filter(a => [0, 1, 4, 5].includes(a.id)).map((a, id) => ({ ...a, id }));
  const disconnected = createGuideProductClosureIndex(complete.g, separated, complete.guide, 1000, tol).toStart(0);
  expect(disconnected.estimate(2, 4)).toBe(Infinity); expect(disconnected.certificate(2, 4)).toBeNull();
});

it('requires only actual guide-feasible closure after the final phase, without another checkpoint tour', () => {
  const { g, arcs, guide } = squareFixture(1);
  const bound = createGuideProductClosureIndex(g, arcs, guide, radius, tol).toStart(0);
  expect(bound.estimate(0, 4)).toBe(0);
  expect(bound.estimate(3, 4)).toBeCloseTo(800, 4);
  const suffix = bound.certificate(3, 4); expect(suffix).toEqual([{ arcId: 6, initialPhase: 4, finalPhase: 4 }]);
  expect(certificateCost(g, arcs, guide, radius, suffix!, 3, 4, 0)).toBeCloseTo(bound.estimate(3, 4), 7);
  expect(bound.estimate(1, 4)).toBe(Infinity);
});

it('rejects a fake road span even when a cache entry supplies transition labels', () => {
  const { g, guide } = squareFixture(1);
  const arcs: GuideProductArc[] = [{ id: 0, from: 0, to: 2, nodes: [0, 2] }];
  expect(() => createGuideProductClosureIndex(g, arcs, guide, radius, tol)).toThrow('nonexistent or invalid native road edge');
});
