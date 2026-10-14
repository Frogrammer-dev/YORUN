import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { matchShape } from '@/lib/route/loops';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { shapeFitHypotheses } from '@/lib/route/shapeFitHypotheses';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.SHAPE_FIT_HYPOTHESES)('diagnoses correspondence residual ranking on four fixed actual-road geometries', () => {
  const root = path.resolve('eval/recognition/route-improvement'), source = path.resolve('eval/recognition/llm-routes-20261010');
  const inputFile = path.join(root, 'pair-segment-20261012/trial-v3-refit/results.json'), inputText = readFileSync(inputFile, 'utf8');
  const input = JSON.parse(inputText) as { combinedCases: Array<{ caseId: string; candidate: RouteCandidate }> };
  const areas = (JSON.parse(readFileSync(path.join(source, 'round2-results.json'), 'utf8')) as { protocol: { areas: Array<{ id: string; bbox: BBox }> } }).protocol.areas;
  const cases = ['gwangalli-cat', 'seomyeon-star', 'seomyeon-cat', 'gangnam-cat'];
  const folder = path.join(root, 'shape-fit-hypotheses-20261012'); mkdirSync(folder, { recursive: true });
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const results = input.combinedCases.filter(r => cases.includes(r.caseId)).map(row => {
    const area = areas.find(a => row.caseId.startsWith(`${a.id}-`))!, text = readFileSync(path.join(source, `${area.id}-roads.json`), 'utf8');
    const g = graphFromOverpass(JSON.parse(text), area.bbox, { detail: 'simple', excludeSteps: true }), c = row.candidate, shape = SHAPE_BY_ID[c.shapeId as ShapeId];
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
    const nodes = c.latlngs.map(([lat, lon]) => g.nodeIndex.nearest(...project(g.origin, lat, lon), .5));
    expect(nodes.every((v, i) => v >= 0 && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
    const key = pairEdgeKey(nodes), routeXY = nodes.map(v => [g.x[v], g.y[v]] as [number, number]);
    const evaluate = (p: Placement, originalStart = false) => {
      if (!placeShape(shape.points, p).every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY)) return null;
      const path = originalStart ? nodes : pairPhaseZero(g, shape, p, nodes), e = evaluatePath(g, shape, p, path, 3000, 8000);
      expect(pairEdgeKey(path)).toBe(key);
      if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) return null;
      const raw = 100 * Math.exp(-e.meanDev / (.08 * p.scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes) / (1 + .03 * e.zigzagPerKm);
      return { placement: p, raw, similarity: e.similarity, path, meanDev: e.meanDev, zigzagPerKm: e.zigzagPerKm };
    };
    const original = evaluate(c.placement, true)!, canonical = evaluate(c.placement)!;
    expect(original.similarity).toBe(c.similarity);
    const baselineRefit = refinePathPlacement(g, shape, c.placement, canonical.path, region, 3000, 8000, 160);
    const baseline = baselineRefit ? evaluate(baselineRefit.placement) : null;
    const matched = matchShape(routeXY, shape, undefined, true, undefined, { fullRotation: true });
    const matchResult = matched ? evaluate(matched) : null;
    const hypotheses = shapeFitHypotheses(routeXY, shape, 8).map((h, rank) => {
      const before = evaluate(h.placement);
      const fit = before ? refinePathPlacement(g, shape, h.placement, before.path, region, 3000, 8000, 120) : null;
      const after = fit ? evaluate(fit.placement) : null;
      return { rank, ...h, before, after, evaluations: fit?.evaluations ?? 0 };
    });
    const bestSeed = hypotheses.filter(h => h.before).sort((a, b) => b.before!.raw - a.before!.raw)[0];
    const bestMulti = hypotheses.filter(h => h.after).sort((a, b) => b.after!.raw - a.after!.raw)[0];
    const threshold = Math.max(original.raw, canonical.raw), incumbent = [original, canonical, baseline].filter(x => x !== null).sort((a, b) => b!.raw - a!.raw)[0]!;
    const winner = bestMulti?.after && bestMulti.after.raw > incumbent.raw + 1e-7 ? bestMulti.after : incumbent;
    const output = { caseId: row.caseId, dataSha256: hash(text), original, canonical, baselineRefit: baseline, currentResidWinnerIcp: matchResult, bestSeedResidRank: bestSeed?.rank ?? null, bestMultistartResidRank: bestMulti?.rank ?? null, before: c.similarity, after: winner.similarity, placementGainOverOriginal: winner.raw - original.raw, placementGainOverBaselineRefit: winner.raw - incumbent.raw, acceptedPlacementGain: winner.raw > threshold + 1e-7, geometryGain: false, sameEdgeKey: true, winner, hypotheses };
    writeFileSync(path.join(folder, `${row.caseId}.json`), JSON.stringify(output, null, 2));
    return output;
  });
  expect(results).toHaveLength(4);
  writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ protocol: { inputFile, inputSha256: hash(inputText), codeHashes: Object.fromEntries(['src/lib/route/shapeFitHypotheses.ts', 'src/lib/route/loops.ts', 'src/lib/route/fit.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/pairSegmentRepair.ts', 'tests/eval/shape-fit-hypotheses-20261012.test.ts'].map(f => [f, hash(readFileSync(f, 'utf8'))])), geometrySearch: false, reflection: false, nonuniformScale: false, scoreSeamSearch: false, phaseZero: 'nearest actual node to template first point; signed-area orientation; independently recomputed for each final placement', internalRefit: 'fixed seed phase-zero path during coordinate descent; final result recanonicalized before original-score comparison', maxHypotheses: 8, shifts: 48, refitPerHypothesis: 120, baselineRefit: 160, originalPreserved: true }, summary: { cases: 4, beforeAverage: results.reduce((s, r) => s + r.before, 0) / 4, afterAverage: results.reduce((s, r) => s + r.after, 0) / 4, geometryImprovements: 0, placementGainsBeyondBaselineRefit: results.filter(r => r.placementGainOverBaselineRefit > 1e-7).length }, cases: results }, null, 2));
}, 180000);
