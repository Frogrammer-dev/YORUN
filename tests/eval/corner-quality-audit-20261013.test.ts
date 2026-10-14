import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.skipIf(!process.env.CORNER_QUALITY_AUDIT)('audits an oracle corner replacement without claiming automatic improvement', () => {
  const out = path.resolve('eval/recognition/route-improvement/corner-quality-audit-20261013'); mkdirSync(out, { recursive: true });
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const inputs = ['eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'eval/recognition/route-improvement/road-connector-representation-20261013/results.json', 'eval/recognition/llm-routes-20261010/seomyeon-roads.json'];
  const texts = inputs.map(f => readFileSync(f, 'utf8'));
  const row = JSON.parse(texts[0]).cases.find((c: { caseId: string }) => c.caseId === 'seomyeon-square') as { candidate: RouteCandidate; bbox: BBox; sourceHash: string; raw: number };
  const diagnostic = JSON.parse(texts[1]); expect(sha(texts[2])).toBe(row.sourceHash); expect(sha(texts[2])).toBe(diagnostic.sourceRoadHash); expect(sha(texts[0])).toBe(diagnostic.incumbentSourceHash);
  const g = graphFromOverpass(JSON.parse(texts[2]), row.bbox, { detail: 'simple', excludeSteps: true }), shape = SHAPE_BY_ID.square;
  const [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY };
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const index = new Map<string, number[]>(), key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
  for (let v = 0; v < g.n; v++) { const k = key(g.lat[v], g.lon[v]); index.set(k, [...(index.get(k) ?? []), v]); }
  const original = row.candidate.latlngs.map(([lat, lon]) => { const ids = index.get(key(lat, lon)); expect(ids).toHaveLength(1); const v = ids![0]; expect(Math.abs(g.lat[v] - lat)).toBeLessThan(1e-10); expect(Math.abs(g.lon[v] - lon)).toBeLessThan(1e-10); return v; });
  const replacement = diagnostic.missing[0].shortcutDiagnostic.exactActualPath as number[];
  expect(pairEdgeKey(original)).not.toBe(pairEdgeKey(replacement));
  const measure = (nodes: number[], p: Placement) => {
    expect(nodes[0]).toBe(nodes.at(-1)); expect(nodes.every((v, i) => Number.isInteger(v) && v >= 0 && v < g.n && inside(g.x[v], g.y[v]) && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
    expect(placeShape(shape.points, p).every(([x, y]) => inside(x, y))).toBe(true);
    const e = evaluatePath(g, shape, p, nodes, 3000, 8000); expect(e.lengthMeters).toBeGreaterThanOrEqual(3000); expect(e.lengthMeters).toBeLessThanOrEqual(8000); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
    const q = e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
    return { q, raw: 100 * Math.exp(-q), display: e.similarity, meanDev: e.meanDev, normalizedDeviation: e.meanDev / (.08 * p.scale), zigzagPerKm: e.zigzagPerKm, zigzagTerm: Math.log1p(.03 * e.zigzagPerKm), length: e.lengthMeters, repeat: e.repeatRatio, featureCoverage: e.featureCoverage, spikes: e.spikes, placement: p, nodes };
  };
  const p = row.candidate.placement;
  expect(measure(original, p).raw).toBeCloseTo(row.raw, 8);
  const assess = (nodes: number[]) => {
    const canonical = pairPhaseZero(g, shape, p, nodes), samePlacementOriginal = measure(nodes, p), samePlacementCanonical = measure(canonical, p);
    const fixedRefits = [nodes, canonical].map(ns => { const r = refinePathPlacement(g, shape, p, ns, region, 3000, 8000, 128); expect(r).not.toBeNull(); return { ...measure(ns, r!.placement), evaluations: r!.evaluations }; });
    let guide = samePlacementCanonical, evaluations = 1;
    for (const fraction of [.06, .03, .015, .0075, .00375]) for (let round = 0; round < 3 && evaluations < 128; round++) {
      const origin = guide.placement; let improved = false;
      for (const [dx, dy, ds, dr] of [[1, 0, 0, 0], [-1, 0, 0, 0], [0, 1, 0, 0], [0, -1, 0, 0], [0, 0, 1, 0], [0, 0, -1, 0], [0, 0, 0, 1], [0, 0, 0, -1]]) {
        const candidate = { cx: origin.cx + dx * fraction * p.scale, cy: origin.cy + dy * fraction * p.scale, scale: origin.scale * (1 + ds * fraction), rotDeg: origin.rotDeg + dr * fraction * 100 };
        if (evaluations >= 128 || candidate.scale < p.scale * .8 || candidate.scale > p.scale * 1.2 || Math.abs(candidate.cx - p.cx) > p.scale * .2 || Math.abs(candidate.cy - p.cy) > p.scale * .2 || Math.abs(candidate.rotDeg - p.rotDeg) > 30 || !placeShape(shape.points, candidate).every(([x, y]) => inside(x, y))) continue;
        evaluations++; const value = measure(pairPhaseZero(g, shape, candidate, nodes), candidate);
        if (value.q < guide.q - 1e-7) { guide = value; improved = true; }
      }
      if (!improved) break;
    }
    return { samePlacementOriginal, samePlacementCanonical, strongestSamePlacement: Math.max(samePlacementOriginal.raw, samePlacementCanonical.raw), fixedRefits, phaseAwareRefit: { ...guide, evaluations }, strongestFairRefit: Math.max(samePlacementOriginal.raw, samePlacementCanonical.raw, ...fixedRefits.map(r => r.raw), guide.raw) };
  };
  const before = assess(original), after = assess(replacement);
  const summary = { samePlacementGain: after.samePlacementCanonical.raw - before.strongestSamePlacement, fairRefitGain: after.phaseAwareRefit.raw - before.strongestFairRefit, automaticGainClaim: false, positiveControlOnly: true, holdoutRead: false };
  const sources = ['tests/eval/corner-quality-audit-20261013.test.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/art/rdp.ts'];
  const codeHashes = Object.fromEntries(sources.map(f => { const s = readFileSync(f, 'utf8'); writeFileSync(path.join(out, `${path.basename(f)}.source`), s); return [f, sha(s)]; }));
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol: { inputHashes: Object.fromEntries(inputs.map((f, i) => [f, sha(texts[i])])), codeHashes, placementBudget: 128, originalBounds: [3000, 8000], repeatMax: .2, sourceNodesOnly: true, originalScore: true }, summary, before, after }, null, 2)); console.log(JSON.stringify(summary));
});
