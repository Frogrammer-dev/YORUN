import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { completeBoundaryOutline } from '@/lib/route/boundaryCompletion';
import { auditObjectPath } from '@/lib/route/objectProposals';
import type { FeatureArc } from '@/lib/route/distinctiveFeatures';
import { checkFeatureChains } from '@/lib/route/distinctiveFeatures';

function fixture() {
  const outline: [number, number][] = [[0, 0], [500, 500], [1000, 0], [1500, 0], [2000, 0], [2500, 500], [3000, 0], [1500, -500]];
  const origin = makeOrigin(37, 127), ll = outline.map(p => unproject(origin, ...p));
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), outline.map((_, i) => ({ a: i, b: (i + 1) % outline.length, factor: 1 })), null);
  const pins = outline.map(p => g.nodeIndex.nearest(...p, 1));
  const features: FeatureArc[] = [[0, 1, 2], [4, 5, 6]].map(vertices => ({ name: 'test lobe', vertices,
    triple: [vertices[0], vertices[1], vertices[2]], reference: { width: 1, depth: 1, orientationDeg: 90, center: [0, 0], direction: [0, 1] } }));
  const region = { minX: -10, maxX: 3010, minY: -510, maxY: 510 };
  const options = { mode: 'independent' as const, region, maxExpandedPerCall: 100, guideTolerance: 100, guideWeight: 1, now: () => 0 };
  const budget = { expanded: 0, maxExpanded: 1000, deadlineMs: 10 };
  return { outline, g, pins, features, options, budget };
}

it('completes and preserves two disjoint feature chains using only audited real road edges', () => {
  const { outline, g, pins, features, options, budget } = fixture();
  const result = completeBoundaryOutline(g, outline, pins, features, options, budget);
  expect(result.path).toEqual([...pins, pins[0]]);
  expect(auditObjectPath(g, options.region, result.path!).valid).toBe(true);
  expect(result.chains[0]).toEqual({ entryToTip: [pins[0], pins[1]], tipToExit: [pins[1], pins[2]] });
  expect(result.chains[1]).toEqual({ entryToTip: [pins[4], pins[5]], tipToExit: [pins[5], pins[6]] });
  expect(result.expanded).toBe(budget.expanded);
  expect(checkFeatureChains(result.chains).ok).toBe(true);
});

it('reports collapse and budget failure rather than joining feature anchors with fake lines', () => {
  const { outline, g, pins, features, options, budget } = fixture();
  const collapsed = pins.slice(); collapsed[1] = collapsed[0];
  expect(completeBoundaryOutline(g, outline, collapsed, features, options, budget).reason).toBe('collapsed_feature_anchors');
  budget.maxExpanded = 1;
  expect(completeBoundaryOutline(g, outline, pins, features, options, budget).path).toBeNull();
  expect(budget.expanded).toBe(1);
});

it('retains a same-anchor plain control and rejects overlapping feature definitions', () => {
  const { outline, g, pins, features, options, budget } = fixture();
  expect(completeBoundaryOutline(g, outline, pins, features, { ...options, mode: 'plain' }, budget).path).not.toBeNull();
  expect(completeBoundaryOutline(g, outline, pins, [], { ...options, mode: 'plain' }, budget).path).not.toBeNull();
  expect(completeBoundaryOutline(g, outline, pins, [features[0], features[0]], options, budget).reason).toBe('overlapping_or_invalid_feature_vertices');
});

it('rejects body anchors aliasing feature pins and requires an open vertex list', () => {
  const { outline, g, pins, features, options, budget } = fixture();
  const alias = pins.slice(); alias[3] = pins[1];
  expect(completeBoundaryOutline(g, outline, alias, features, options, budget).reason).toBe('body_anchor_aliases_feature');
  expect(completeBoundaryOutline(g, [...outline, outline[0]], [...pins, pins[0]], features, options, budget).reason).toBe('closing_duplicate_must_be_removed');
});

it('does not reserve a feature through a body anchor placed on its interior road chain', () => {
  const { outline: original, features, options } = fixture();
  const outline: [number, number][] = [...original, [250, 250]];
  const origin = makeOrigin(37, 127), ll = outline.map(p => unproject(origin, ...p));
  const pairs = [[0, 8], [8, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]];
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), pairs.map(([a, b]) => ({ a, b, factor: 1 })), null);
  const pins = outline.map(p => g.nodeIndex.nearest(...p, 1));
  const budget = () => ({ expanded: 0, maxExpanded: 1000, deadlineMs: 10 });
  expect(completeBoundaryOutline(g, outline, pins, features, { ...options, mode: 'plain' }, budget()).path).not.toBeNull();
  expect(completeBoundaryOutline(g, outline, pins, features, options, budget()).path).toBeNull();
});

it('preserves a feature arc crossing the vertex zero seam', () => {
  const { outline, g, pins, features, options, budget } = fixture();
  const wrap: FeatureArc = { ...features[0], vertices: [7, 0, 1], triple: [7, 0, 1] };
  const result = completeBoundaryOutline(g, outline, pins, [wrap, features[1]], options, budget);
  expect(result.path).not.toBeNull();
  expect(result.chains[0]).toEqual({ entryToTip: [pins[7], pins[0]], tipToExit: [pins[0], pins[1]] });
});

it('allows body/body edge reuse while keeping the two feature boundaries independent', () => {
  const { outline, features, options } = fixture();
  const origin = makeOrigin(37, 127), ll = outline.map(p => unproject(origin, ...p));
  // Body vertex7 is a dead end off3. Both body6->7 and7->0 must use3--7.
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3], [3, 7], [3, 0]];
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), pairs.map(([a, b]) => ({ a, b, factor: 1 })), null);
  const pins = outline.map(p => g.nodeIndex.nearest(...p, 1));
  for (const mode of ['plain', 'independent'] as const) {
    const result = completeBoundaryOutline(g, outline, pins, features, { ...options, mode }, { expanded: 0, maxExpanded: 1000, deadlineMs: 10 });
    expect(result.path).not.toBeNull();
    const traversals = result.path!.slice(1).filter((v, i) => (v === pins[3] && result.path![i] === pins[7]) || (v === pins[7] && result.path![i] === pins[3]));
    expect(traversals).toHaveLength(2);
    expect(checkFeatureChains(result.chains).ok).toBe(true);
    expect(auditObjectPath(g, options.region, result.path!).valid).toBe(true);
  }
});
