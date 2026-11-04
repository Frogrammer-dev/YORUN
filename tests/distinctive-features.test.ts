import { describe, expect, it } from 'vitest';
import { DIVERSITY_CATALOG } from '@/lib/route/diversityCatalog';
import { OBJECT_TEMPLATES } from '@/lib/route/objectTemplates';
import { SHAPES } from '@/lib/route/shapes';
import {
  DISTINCTIVE_FEATURES, checkDistinctiveConstraints, checkFeatureChains, measureFeatureTriplet,
  type FeatureFrame, type FeatureTriplet, type FeatureXY,
} from '@/lib/route/distinctiveFeatures';

const frame: FeatureFrame = { origin: [0, 0], extent: 1, rotationDeg: 0 };
const triangle: FeatureTriplet = [[-1, 0], [0, 2], [1, 0]];
const definition = (key: string) => DISTINCTIVE_FEATURES.find(d => d.key === key)!;
function originalTriplets(key: string): FeatureTriplet[] {
  const def = definition(key);
  if (!def.supported) throw new Error('Unsupported fixture');
  const points = DIVERSITY_CATALOG.find(item => item.key === key)!.shape.points;
  return def.features.map(f => f.triple.map(i => points[i]) as unknown as FeatureTriplet);
}
function transform(p: FeatureXY, scale: number, deg: number, origin: FeatureXY): FeatureXY {
  const a = deg * Math.PI / 180;
  return [origin[0] + scale * (Math.cos(a) * p[0] - Math.sin(a) * p[1]),
    origin[1] + scale * (Math.sin(a) * p[0] + Math.cos(a) * p[1])];
}

describe('fixed-frame measurements', () => {
  it('measures width/depth and directed tip orientation, invariant to boundary traversal reversal', () => {
    const m = measureFeatureTriplet(triangle, frame)!;
    expect(m).toMatchObject({ width: 2, depth: 2, orientationDeg: 90 });
    expect(measureFeatureTriplet([triangle[2], triangle[1], triangle[0]], frame)).toEqual(m);
    const reflected = measureFeatureTriplet(triangle.map(([x, y]) => [x, -y]) as unknown as FeatureTriplet, frame)!;
    expect(reflected.width).toBe(m.width); expect(reflected.depth).toBe(m.depth);
    expect(reflected.orientationDeg).toBe(-90); // signed, NOT unoriented line angle
  });

  it('uses the declared placed extent and axes, rather than normalizing each candidate', () => {
    const pts = triangle.map(p => transform(p, 300, 67, [500, -200])) as unknown as FeatureTriplet;
    const m = measureFeatureTriplet(pts, { origin: [500, -200], extent: 300, rotationDeg: 67 })!;
    expect(m.width).toBeCloseTo(2); expect(m.depth).toBeCloseTo(2); expect(m.orientationDeg).toBeCloseTo(90);
    expect(measureFeatureTriplet(pts, { ...frame, extent: 300 })!.orientationDeg).not.toBeCloseTo(90);
  });

  it('rejects collapsed, collinear, nonfinite triplets and invalid frames', () => {
    for (const pts of [ [[0, 0], [0, 1], [0, 0]], [[0, 0], [1, 0], [2, 0]],
      [[0, 0], [Infinity, 1], [2, 0]] ] as FeatureTriplet[]) expect(measureFeatureTriplet(pts, frame)).toBeNull();
    expect(measureFeatureTriplet(triangle, { ...frame, extent: 0 })).toBeNull();
    expect(measureFeatureTriplet(triangle, { ...frame, rotationDeg: NaN })).toBeNull();
  });
});

describe('25-kind original-outline hypotheses', () => {
  it('retains exact catalog scope and explicit unsupported reasons, without mutating templates', () => {
    const before = JSON.stringify([SHAPES, OBJECT_TEMPLATES]);
    expect(DISTINCTIVE_FEATURES.map(d => d.key)).toEqual(DIVERSITY_CATALOG.map(d => d.key));
    expect(DISTINCTIVE_FEATURES).toHaveLength(25);
    expect(Object.isFrozen(DISTINCTIVE_FEATURES)).toBe(true);
    for (const d of DISTINCTIVE_FEATURES) {
      expect(Object.isFrozen(d)).toBe(true);
      if (!d.supported) { expect(d.reason.length).toBeGreaterThan(30); continue; }
      expect(d.features.length).toBeGreaterThanOrEqual(2);
      const points = DIVERSITY_CATALOG.find(item => item.key === d.key)!.shape.points;
      const seen = new Set<string>(), seenVertices = new Set<number>();
      for (const f of d.features) {
        expect(f.vertices[0]).toBe(f.triple[0]); expect(f.vertices.at(-1)).toBe(f.triple[2]);
        expect(f.vertices.slice(1, -1)).toContain(f.triple[1]);
        expect(f.reference.width).toBeGreaterThan(0); expect(f.reference.depth).toBeGreaterThan(0);
        expect(Object.isFrozen(f.vertices)).toBe(true);
        for (const v of f.vertices) { expect(seenVertices.has(v)).toBe(false); seenVertices.add(v); }
        for (let i = 1; i < f.vertices.length; i++) {
          expect(f.vertices[i]).toBe((f.vertices[i - 1] + 1) % (points.length - 1));
          const edge = [f.vertices[i - 1], f.vertices[i]].sort((a, b) => a - b).join(':');
          expect(seen.has(edge)).toBe(false); seen.add(edge);
        }
      }
      expect(checkDistinctiveConstraints(d, originalTriplets(d.key), { ...frame, extent: d.templateExtent }).ok).toBe(true);
    }
    expect(definition('fish')).toMatchObject({ supported: false });
    expect(definition('rocket')).toMatchObject({ supported: true }); // independent of head vocabulary
    expect(JSON.stringify([SHAPES, OBJECT_TEMPLATES])).toBe(before);
    expect(Object.isFrozen(SHAPES[0].points)).toBe(false);
  });

  it('anchors actual original ear and beak vertices, not automatically chosen corners', () => {
    const cat = definition('cat'), bird = definition('bird');
    if (!cat.supported || !bird.supported) throw new Error('Expected supported definitions');
    expect(cat.features.map(f => f.triple)).toEqual([[4, 5, 6], [8, 9, 10]]);
    expect(bird.features[0]).toMatchObject({ name: 'beak', triple: [6, 7, 8] });
    expect(checkDistinctiveConstraints(definition('fish'), [], frame).reasons[0]).toContain('unsupported:');
  });
});

describe('geometry constraints and edge independence', () => {
  it('accepts original cues placed by a known proper similarity; rejects reflected arrangement', () => {
    const def = definition('bird'), original = originalTriplets('bird');
    if (!def.supported) throw new Error('Expected support');
    const placed = original.map(t => t.map(p => transform(p, 600, 37, [100, 200])) as unknown as FeatureTriplet);
    expect(checkDistinctiveConstraints(def, placed, { origin: [100, 200], extent: 600 * def.templateExtent, rotationDeg: 37 }).ok).toBe(true);
    const reflected = original.map(t => t.map(([x, y]) => [-x, y]) as unknown as FeatureTriplet);
    expect(checkDistinctiveConstraints(def, reflected, frame).ok).toBe(false);
  });

  it('rejects too-wide/deep cues, turned tips and individually matching cues relocated out of relation', () => {
    const def = definition('cat'), original = originalTriplets('cat');
    const big = original.map(t => t.map(([x, y]) => [x * 2, y * 2]) as unknown as FeatureTriplet);
    expect(checkDistinctiveConstraints(def, big, frame).reasons.some(r => r.startsWith('width:'))).toBe(true);
    const relocated = [original[0], original[1].map(([x, y]) => [x + 5, y]) as unknown as FeatureTriplet];
    expect(checkDistinctiveConstraints(def, relocated, frame).reasons).toContain('separation:0:1');
    const turned = original.map(([a, tip, b]) => [a, [a[0] + b[0] - tip[0], a[1] + b[1] - tip[1]], b] as FeatureTriplet);
    expect(checkDistinctiveConstraints(def, turned, frame).reasons).toContain('orientation:0');
    expect(checkDistinctiveConstraints(def, [original[0]], frame).reasons).toEqual(['feature_count']);
  });

  it('enforces inclusive .5/1.5 ratios and 30 degrees without changing the frame', () => {
    const ref = measureFeatureTriplet(triangle, frame)!;
    const other: FeatureTriplet = [[4, 0], [5, 2], [6, 0]];
    const def = { key: 'fixture', supported: true as const, templateExtent: 1, basis: 'fixture', features: [
      { name: 'a', vertices: [0, 1, 2], triple: [0, 1, 2] as const, reference: ref },
      { name: 'b', vertices: [3, 4, 5], triple: [3, 4, 5] as const, reference: measureFeatureTriplet(other, frame)! },
    ] };
    for (const scale of [.5, 1.5]) {
      const scaled = [triangle, other].map(t => t.map(([x, y]) => [scale * x, scale * y]) as unknown as FeatureTriplet);
      expect(checkDistinctiveConstraints(def, scaled, frame).ok).toBe(true);
    }
    for (const deg of [30, 30.01]) {
      const rotated = [triangle, other].map(t => t.map(p => transform(p, 1, deg, [0, 0])) as unknown as FeatureTriplet);
      expect(checkDistinctiveConstraints(def, rotated, frame).ok).toBe(deg === 30);
    }
  });

  it('rejects shared nodes even when all boundary edges are distinct', () => {
    const other = { entryToTip: [10, 11], tipToExit: [11, 12] };
    const crossing = { entryToTip: [0, 1, 2], tipToExit: [2, 3, 1, 4] };
    const within = checkFeatureChains([crossing, other]);
    expect(within.reasons).toContain('shared_boundary_node:0:1');
    expect(within.reasons.some(r => r.startsWith('reused_edge:'))).toBe(false);
    const first = { entryToTip: [0, 1, 2], tipToExit: [2, 3, 4] };
    const between = checkFeatureChains([first, { entryToTip: [5, 1, 6], tipToExit: [6, 7] }]);
    expect(between.reasons).toContain('shared_feature_node:1:1');
    expect(between.reasons.some(r => r.startsWith('reused_edge:'))).toBe(false);
    // Even endpoints may not be shared by different disjoint features.
    expect(checkFeatureChains([first, { entryToTip: [4, 6], tipToExit: [6, 7] }]).reasons)
      .toContain('shared_feature_node:1:4');
    // A cycle without edge reuse still violates node-simple boundary policy.
    expect(checkFeatureChains([{ entryToTip: [0, 1, 2, 3, 1, 4], tipToExit: [4, 5] }, other]).reasons)
      .toContain('repeated_arm_node:0:0:1');
    expect(checkFeatureChains([first, other])).toEqual({ ok: true, reasons: [] });
  });

  it('rejects reverse-edge reuse within/across boundaries and across features; accepts distinct chains', () => {
    const a = { entryToTip: [0, 1, 2], tipToExit: [2, 3, 4] };
    const b = { entryToTip: [5, 6], tipToExit: [6, 7] };
    expect(checkFeatureChains([a, b]).ok).toBe(true);
    expect(checkFeatureChains([{ ...a, tipToExit: [2, 1, 4] }, b]).reasons.some(r => r.startsWith('reused_edge:'))).toBe(true);
    expect(checkFeatureChains([a, { entryToTip: [5, 3, 2], tipToExit: [2, 8] }]).ok).toBe(false);
    expect(checkFeatureChains([{ entryToTip: [0, 1, 0, 2], tipToExit: [2, 3] }, b]).ok).toBe(false);
    expect(checkFeatureChains([{ entryToTip: [0, 1], tipToExit: [1, 0] }, b]).reasons).toContain('collapsed_entry_exit:0');
    expect(checkFeatureChains([{ entryToTip: [0, 0, 2], tipToExit: [2, 3] }, b]).reasons).toContain('zero_edge:0');
    expect(checkFeatureChains([{ entryToTip: [0, NaN], tipToExit: [2, 3] }, b]).ok).toBe(false);
    expect(checkFeatureChains([{ entryToTip: [0, 1], tipToExit: [2, 3] }, b]).reasons).toContain('tip_not_shared:0');
    expect(checkFeatureChains([a]).ok).toBe(false);
    expect(checkFeatureChains([a, { entryToTip: Array(10001).fill(5), tipToExit: [5, 6] }]).ok).toBe(false);
    expect(checkDistinctiveConstraints(definition('cat'), originalTriplets('cat'), frame, [a]).reasons).toContain('chain_count_mismatch');
  });
});
