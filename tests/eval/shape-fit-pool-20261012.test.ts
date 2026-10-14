import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { matchShape } from '@/lib/route/loops';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { shapeFitHypotheses } from '@/lib/route/shapeFitHypotheses';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.SHAPE_FIT_POOL)('compares equal-cap single and correspondence-multistart fitting on frozen loop pools', () => {
  const root = path.resolve('eval/recognition/route-improvement'), source = path.resolve('eval/recognition/llm-routes-20261010');
  const inputFile = path.join(root, 'pair-segment-20261012/trial-v3-refit/results.json'), inputText = readFileSync(inputFile, 'utf8');
  const inputs = (JSON.parse(inputText) as { combinedCases: Array<{ caseId: string; candidate: RouteCandidate }> }).combinedCases;
  const areaText = readFileSync(path.join(source, 'round2-results.json'), 'utf8');
  const areas = (JSON.parse(areaText) as { protocol: { areas: Array<{ id: string; bbox: BBox }> } }).protocol.areas;
  const cases = ['gwangalli-heart', 'gwangalli-cat', 'gangnam-cat'], folder = path.join(root, 'shape-fit-pool-20261012'); mkdirSync(folder, { recursive: true });
  const params = { hypotheses: 8, multiRefitTop: 2, multiRefitCapPerSeed: 128, singleRefitCap: 256, totalRefitCapPerPathPerMethod: 256, uniformOnly: true, fullRotation: true };
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const codeHashes = Object.fromEntries(['tests/eval/shape-fit-pool-20261012.test.ts', 'src/lib/route/shapeFitHypotheses.ts', 'src/lib/route/loops.ts', 'src/lib/route/fit.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts'].map(f => [f, hash(readFileSync(f, 'utf8'))]));
  const results = [];
  for (const caseId of cases) {
    const row = inputs.find(r => r.caseId === caseId)!, area = areas.find(a => caseId.startsWith(`${a.id}-`))!;
    const dataText = readFileSync(path.join(source, `${area.id}-roads.json`), 'utf8');
    const poolFiles = ['control', 'full'].map(label => {
      const file = path.join(root, 'full-rotation-loops-20261012', `${caseId}-${label}.json`), text = readFileSync(file, 'utf8');
      return { label, file, sha256: hash(text), value: JSON.parse(text) as { pool: RouteCandidate[]; sourceSha256: string } };
    });
    for (const file of poolFiles) expect(file.value.sourceSha256).toBe(hash(dataText));
    const cacheKey = hash(JSON.stringify({ input: hash(inputText), data: hash(dataText), pools: poolFiles.map(p => p.sha256), params, codeHashes })), outputFile = path.join(folder, `${caseId}.json`);
    if (existsSync(outputFile)) {
      const cached = JSON.parse(readFileSync(outputFile, 'utf8'));
      if (cached.cacheKey === cacheKey) { results.push(cached); continue; }
    }
    const began = Date.now(), g = graphFromOverpass(JSON.parse(dataText), area.bbox, { detail: 'simple', excludeSteps: true }), shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
    const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
    const index = new Map<string, number[]>();
    for (let v = 0; v < g.n; v++) { const key = `${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`; index.set(key, [...(index.get(key) ?? []), v]); }
    const nodesFor = (c: RouteCandidate) => c.latlngs.map(([lat, lon]) => { const found = index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`); return found?.length === 1 ? found[0] : -1; });
    const valid = (nodes: number[]) => nodes.length >= 4 && nodes[0] === nodes.at(-1) && nodes.every((v, i) => v >= 0 && inside(g.x[v], g.y[v]) && (!i || hasEdge(g, nodes[i - 1], v)));
    let initialEvaluations = 0;
    const assess = (nodes: number[], p: Placement, canonical = true) => {
      if (!valid(nodes) || !placeShape(shape.points, p).every(([x, y]) => inside(x, y))) return null;
      const route = canonical ? pairPhaseZero(g, shape, p, nodes) : nodes, e = evaluatePath(g, shape, p, route, 3000, 8000); initialEvaluations++;
      if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) return null;
      const raw = 100 * Math.exp(-e.meanDev / (.08 * p.scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes) / (1 + .03 * e.zigzagPerKm);
      return { nodes: route, placement: p, raw, candidate: toCandidate(g, shape, p, e) };
    };
    const originalNodes = nodesFor(row.candidate), original = assess(originalNodes, row.candidate.placement, false)!;
    expect(original.candidate.similarity).toBe(row.candidate.similarity);
    const incumbentCanonical = assess(originalNodes, row.candidate.placement)!;
    const geometries = new Map<string, { nodes: number[]; kept: NonNullable<ReturnType<typeof assess>>; sources: string[] }>();
    let invalidPoolCandidates = 0;
    for (const file of poolFiles) for (const c of file.value.pool) {
      const nodes = nodesFor(c), own = assess(nodes, c.placement, false), zero = assess(nodes, c.placement);
      if (!own || !zero) { invalidPoolCandidates++; continue; }
      expect(own.candidate.similarity).toBe(c.similarity);
      const key = pairEdgeKey(nodes), kept = own.raw > zero.raw ? own : zero, existing = geometries.get(key);
      if (!existing) geometries.set(key, { nodes, kept, sources: [file.label] });
      else { if (kept.raw > existing.kept.raw) { existing.kept = kept; existing.nodes = nodes; } if (!existing.sources.includes(file.label)) existing.sources.push(file.label); }
    }
    const incumbent = original.raw >= incumbentCanonical.raw ? original : incumbentCanonical;
    let singleBest = incumbent, multiBest = incumbent;
    let singleInitialEvaluations = 0, multiInitialEvaluations = 0, singleRefitEvaluations = 0, multiRefitEvaluations = 0;
    const diagnostics = [];
    for (const [geometryKey, entry] of geometries) {
      const xy = entry.nodes.map(v => [g.x[v], g.y[v]] as [number, number]);
      const oldEvaluations = initialEvaluations;
      const matched = matchShape(xy, shape, undefined, true, undefined, { fullRotation: true });
      const singleSeed = matched ? assess(entry.nodes, matched) : null;
      singleInitialEvaluations += initialEvaluations - oldEvaluations;
      let single = entry.kept, multi = entry.kept;
      if (singleSeed && singleSeed.raw > single.raw) single = singleSeed;
      let singleCount = 0, multiCount = 0;
      if (singleSeed) {
        const fit = refinePathPlacement(g, shape, singleSeed.placement, singleSeed.nodes, region, 3000, 8000, params.singleRefitCap);
        singleCount = fit?.evaluations ?? 0;
        const candidate = fit ? assess(entry.nodes, fit.placement) : null;
        if (candidate && candidate.raw > single.raw) single = candidate;
      }
      const startMulti = initialEvaluations;
      const hypotheses = shapeFitHypotheses(xy, shape, params.hypotheses).map((h, residualRank) => ({ ...h, residualRank, seed: assess(entry.nodes, h.placement) }));
      multiInitialEvaluations += initialEvaluations - startMulti;
      const ranked = hypotheses.filter(h => h.seed).sort((a, b) => b.seed!.raw - a.seed!.raw);
      for (const h of ranked) if (h.seed!.raw > multi.raw) multi = h.seed!;
      const refined = [];
      for (const h of ranked.slice(0, params.multiRefitTop)) {
        const fit = refinePathPlacement(g, shape, h.seed!.placement, h.seed!.nodes, region, 3000, 8000, params.multiRefitCapPerSeed);
        multiCount += fit?.evaluations ?? 0;
        const candidate = fit ? assess(entry.nodes, fit.placement) : null;
        if (candidate && candidate.raw > multi.raw) multi = candidate;
        refined.push({ residualRank: h.residualRank, initialRaw: h.seed!.raw, finalRaw: candidate?.raw ?? null, evaluations: fit?.evaluations ?? 0 });
      }
      expect(singleCount).toBeLessThanOrEqual(params.totalRefitCapPerPathPerMethod); expect(multiCount).toBeLessThanOrEqual(params.totalRefitCapPerPathPerMethod);
      expect(pairEdgeKey(single.nodes)).toBe(geometryKey); expect(pairEdgeKey(multi.nodes)).toBe(geometryKey);
      singleRefitEvaluations += singleCount; multiRefitEvaluations += multiCount;
      if (single.raw > singleBest.raw + 1e-7) singleBest = single;
      if (multi.raw > multiBest.raw + 1e-7) multiBest = multi;
      diagnostics.push({ geometryKeySha256: hash(geometryKey), sources: entry.sources, originalPoolRaw: entry.kept.raw, singleSeedRaw: singleSeed?.raw ?? null, singleRaw: single.raw, multiRaw: multi.raw, rawPlacementAdvantage: multi.raw - single.raw, geometryGain: false, singleRefitEvaluations: singleCount, multiRefitEvaluations: multiCount, hypotheses: hypotheses.map(h => ({ residualRank: h.residualRank, residual: h.residual, shift: h.shift, direction: h.direction, placement: h.placement, raw: h.seed?.raw ?? null })), refined });
      writeFileSync(path.join(folder, `${caseId}-progress.json`), JSON.stringify({ caseId, finishedGeometries: diagnostics.length, totalGeometries: geometries.size, singleBestRaw: singleBest.raw, multiBestRaw: multiBest.raw, elapsedMs: Date.now() - began }));
    }
    const result = { caseId, cacheKey, sourceSha256: hash(dataText), poolSources: poolFiles.map(({ label, file, sha256 }) => ({ label, file, sha256 })), rawPoolCandidates: poolFiles.reduce((s, f) => s + f.value.pool.length, 0), uniqueValidGeometries: geometries.size, invalidPoolCandidates, before: original.candidate.similarity, inputRaw: original.raw, canonicalInputRaw: incumbentCanonical.raw, singleAfter: singleBest.candidate.similarity, multiAfter: multiBest.candidate.similarity, singleRaw: singleBest.raw, multiRaw: multiBest.raw, originalPreservedSingle: singleBest.raw >= original.raw, originalPreservedMulti: multiBest.raw >= original.raw, geometryGain: false, selectedExistingGeometryDifferentFromIncumbentSingle: pairEdgeKey(singleBest.nodes) !== pairEdgeKey(originalNodes), selectedExistingGeometryDifferentFromIncumbentMulti: pairEdgeKey(multiBest.nodes) !== pairEdgeKey(originalNodes), singleCandidate: singleBest.candidate, multiCandidate: multiBest.candidate, singleInitialEvaluations, multiInitialEvaluations, additionalMultiInitialEvaluations: multiInitialEvaluations - singleInitialEvaluations, singleRefitEvaluations, multiRefitEvaluations, strictFinalAndPoolEvaluations: initialEvaluations, elapsedMs: Date.now() - began, diagnostics };
    writeFileSync(outputFile, JSON.stringify(result, null, 2)); results.push(result);
  }
  expect(results).toHaveLength(3);
  writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ protocol: { inputFile, inputSha256: hash(inputText), sourceProtocolSha256: hash(areaText), codeHashes, params, paramsSha256: hash(JSON.stringify(params)), cases, graphDetail: 'simple', excludeSteps: true, minMeters: 3000, maxMeters: 8000, maxRepeatRatio: .2, pools: 'union of saved control/full top24, exact road-edge multiset dedup', originalScore: true, originalPreserved: true, noNewPathGeneration: true, geometryGain: false, fittingBudgetComparison: 'same maximum 256 original-score refit evaluations per path per method; single 256 vs multi 2×128; multi adds at most8 seed original-score evaluations vs single1; actual used counts reported', phaseZero: 'deterministic nearest template-start actual node and signed-area orientation for each seed/final pose; no score-based seam selection', internalRefit: 'fixed seed-phase path; final pose recanonicalized and strictly assessed', evaluationSubsetOnly: true }, summary: { caseCount: 3, beforeAverage: results.reduce((s, r) => s + r.before, 0) / 3, singleAverage: results.reduce((s, r) => s + r.singleAfter, 0) / 3, multiAverage: results.reduce((s, r) => s + r.multiAfter, 0) / 3, singleRawAverage: results.reduce((s, r) => s + r.singleRaw, 0) / 3, multiRawAverage: results.reduce((s, r) => s + r.multiRaw, 0) / 3, geometries: results.reduce((s, r) => s + r.uniqueValidGeometries, 0), sameGeometryMultiAdvantages: results.reduce((s, r) => s + r.diagnostics.filter((d: { rawPlacementAdvantage: number }) => d.rawPlacementAdvantage > 1e-7).length, 0), elapsedMs: results.reduce((s, r) => s + r.elapsedMs, 0), geometryImprovements: 0 }, cases: results }, null, 2));
}, 600000);
