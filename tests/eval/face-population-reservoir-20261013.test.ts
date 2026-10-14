import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { facePopulationSearch } from '@/lib/route/facePopulationSearch';
import { evaluatePath, placeShape, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.FACE_POPULATION_RESERVOIR)('tests automatic coarse-pose face populations on two frozen weak original cases', () => {
  const root = path.resolve('eval/recognition/route-improvement'), source = path.resolve('eval/recognition/llm-routes-20261010');
  const inputText = readFileSync(path.join(root, 'controlled-area/results.json'), 'utf8');
  const inputs = (JSON.parse(inputText) as { cases: Array<{ label: string; caseId: string; candidate: RouteCandidate; pool: RouteCandidate[] }> }).cases;
  const areaText = readFileSync(path.join(source, 'round2-results.json'), 'utf8');
  const areas = (JSON.parse(areaText) as { protocol: { areas: Array<{ id: string; bbox: BBox }> } }).protocol.areas;
  const folder = path.join(root, 'face-population-reservoir-20261013'); mkdirSync(folder, { recursive: true });
  const cases = ['gwangalli-cat', 'seomyeon-star'], params = { maxStates: 500, populationSize: 12, maxPoses: 12, seed: 0xFACE2026, maxColdParents: 8, reservoirSlots: 4 };
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const codeHashes = Object.fromEntries(['src/lib/route/facePopulationSearch.ts', 'tests/eval/face-population-reservoir-20261013.test.ts', 'src/lib/route/fit.ts', 'src/lib/route/loops.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts'].map(f => [f, hash(readFileSync(f, 'utf8'))]));
  const results = [];
  for (const caseId of cases) {
    const row = inputs.find(r => r.label === 'narrow' && r.caseId === caseId)!, area = areas.find(a => caseId.startsWith(`${a.id}-`))!;
    expect(row.candidate).toBeTruthy();
    const text = readFileSync(path.join(source, `${area.id}-roads.json`), 'utf8'), poseText = readFileSync(path.join(root, 'global-coarse', `${caseId}.json`), 'utf8');
    const poseSource = JSON.parse(poseText) as { placementSeeds: Placement[]; evaluated: number; dataSha256: string };
    expect(poseSource.evaluated).toBe(0); expect(poseSource.dataSha256).toBe(hash(text));
    const cacheKey = hash(JSON.stringify({ caseId, input: hash(inputText), source: hash(text), poses: hash(poseText), params, codeHashes })), file = path.join(folder, `${caseId}.json`);
    const g = graphFromOverpass(JSON.parse(text), area.bbox, { detail: 'simple', excludeSteps: true }), shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
    const index = new Map<string, number>(); for (let v = 0; v < g.n; v++) index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`, v);
    const nodesFor = (c: RouteCandidate) => c.latlngs.map(([lat, lon]) => index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`) ?? -1);
    let result;
    if (existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).cacheKey === cacheKey) result = JSON.parse(readFileSync(file, 'utf8'));
    else {
      writeFileSync(path.join(folder, `${caseId}-progress.json`), JSON.stringify({ caseId, stage: 'automatic-coarse-face-population', params }));
      const started = Date.now(), searched = facePopulationSearch(g, shape, region, poseSource.placementSeeds, row.candidate, { ...params, coldParents: row.pool });
      expect(searched).not.toBeNull();
      result = { ...searched!, caseId, cacheKey, sourceSha256: hash(text), poseSourceSha256: hash(poseText), before: row.candidate.similarity, after: searched!.candidate.similarity, elapsedMs: Date.now() - started };
      writeFileSync(file, JSON.stringify(result, null, 2));
    }
    const inputNodes = nodesFor(row.candidate), newNodes = nodesFor(result.candidate);
    for (const c of [result.candidate, ...result.pool] as RouteCandidate[]) {
      const nodes = nodesFor(c);
      expect(nodes[0]).toBe(nodes.at(-1)); expect(nodes.every((v, i) => v >= 0 && g.x[v] >= minX && g.x[v] <= maxX && g.y[v] >= minY && g.y[v] <= maxY && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
      expect(placeShape(shape.points, c.placement).every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY)).toBe(true);
      const e = evaluatePath(g, shape, c.placement, nodes, 3000, 8000);
      expect(e.similarity).toBe(c.similarity); expect(e.lengthMeters).toBeGreaterThanOrEqual(3000); expect(e.lengthMeters).toBeLessThanOrEqual(8000); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
    }
    expect(result.states).toBeLessThanOrEqual(params.maxStates); expect(result.evaluated).toBeLessThanOrEqual(params.maxStates); expect(result.reconstruction.length).toBeGreaterThan(0);
    const v1File = path.join(root, 'face-population-20261012', `${caseId}.json`), v1Saved = JSON.parse(readFileSync(v1File, 'utf8'));
    const v1Started = Date.now(), v1Replayed = facePopulationSearch(g, shape, region, poseSource.placementSeeds, row.candidate, { maxStates: 500, populationSize: 12, maxPoses: 12, seed: 0xFACE2026 });
    expect(v1Replayed!.states).toBe(v1Saved.states); expect(v1Replayed!.evaluated).toBe(v1Saved.evaluated); expect(v1Replayed!.bestGeneratedRaw).toBeCloseTo(v1Saved.bestGeneratedRaw, 10);
    result.v1Comparison = { file: v1File, sha256: hash(readFileSync(v1File, 'utf8')), before: v1Saved.before, after: v1Saved.after, bestGeneratedRaw: v1Saved.bestGeneratedRaw, initialBestRaw: v1Saved.initialBestRaw, states: v1Saved.states, evaluated: v1Saved.evaluated, worseChildrenRetained: v1Saved.worseChildrenRetained, elapsedMs: v1Saved.elapsedMs, defaultV1Reproduced: true, reproductionElapsedMs: Date.now() - v1Started };
    writeFileSync(file, JSON.stringify(result, null, 2));
    expect(result.afterRaw).toBeGreaterThanOrEqual(result.inputRaw - 1e-7);
    if (result.geometryImprovement) {
      expect(pairEdgeKey(newNodes)).not.toBe(pairEdgeKey(inputNodes));
      expect(newNodes).toEqual(pairPhaseZero(g, shape, result.candidate.placement, newNodes));
      expect(result.afterRaw).toBeGreaterThan(result.canonicalInputRaw);
      expect(result.afterRaw).toBeGreaterThan(result.strongestInputRaw);
    } else expect(newNodes).toEqual(inputNodes);
    results.push(result);
  }
  writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ protocol: { codeHashes, params, paramsSha256: hash(JSON.stringify(params)), coldInputSha256: hash(inputText), sourceProtocolSha256: hash(areaText), cases, coarseSource: 'globalSearch attempts0 automatic placementSeeds48; no evaluated candidate selected the placements', initialFaceUnions: 'diverse12 automatic poses × inside thresholds .3/.5/.7', incumbent: 'completed controlled narrow automatic pipeline preserved; strictly edge-identical reconstructed automatic cold pool adds parents', states: 'face set plus uniform template pose', populationSelection: 'elite8 plus explicit novelty/worse reservoir4 with freshness and depth; original v1 unchanged when reservoirSlots0 and no coldParents', mutations: ['spatially separated two-face flips', 'connected3–4-face flips', '2–4-face donor-parent patch crossover', 'face flip plus uniform pose movement'], limits: '500 unique face/pose states; maximum100 generations; strict closed actual edges, region/template,3–8km,repeat≤.2; original evaluatePath Q; deterministic geometric phase0', savedHighBestSeed: false, automaticColdPoolParents: true, eliteSlots: 8, reservoirSlots: 4, holdoutRead: false, noRefit: true, noAppChange: true, experimentOnly: true }, summary: { cases: 2, beforeAverage: results.reduce((s, r) => s + r.before, 0) / 2, afterAverage: results.reduce((s, r) => s + r.after, 0) / 2, geometryImprovements: results.filter(r => r.geometryImprovement).length, elapsedMs: results.reduce((s, r) => s + r.elapsedMs, 0), states: results.reduce((s, r) => s + r.states, 0), originalQEvaluations: results.reduce((s, r) => s + r.evaluated, 0), worseChildrenRetained: results.reduce((s, r) => s + r.worseChildrenRetained, 0) }, cases: results }, null, 2));
}, 180000);
