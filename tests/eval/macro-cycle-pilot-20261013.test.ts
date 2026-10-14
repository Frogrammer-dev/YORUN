import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { macroCycleSearch, MACRO_CYCLE_PARAMS, MACRO_CYCLE_DIVERSE_PARAMS } from '@/lib/route/macroCycleSearch';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { shapeFitHypotheses } from '@/lib/route/shapeFitHypotheses';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.MACRO_CYCLE_PILOT)('generates Q-blind actual cycles then evaluates four original shapes', () => {
  const areaId = process.env.MACRO_CYCLE_AREA ?? 'gwangalli'; expect(['gwangalli', 'seomyeon', 'gangnam']).toContain(areaId);
  const diverseStateQuota = process.env.MACRO_CYCLE_DIVERSE === '1';
  const out = path.resolve('eval/recognition/route-improvement', diverseStateQuota ? 'macro-cycle-diverse-20261013' : 'macro-cycle-pilot-20261013', areaId); mkdirSync(out, { recursive: true });
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex'), inputPath = 'eval/recognition/route-improvement/offline-cascade-20261013/results.json', inputBytes = readFileSync(inputPath);
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; sourceHash: string }> }, rows = input.cases.filter(r => r.caseId.startsWith(`${areaId}-`)); expect(rows).toHaveLength(4);
  const roadBytes = readFileSync(`eval/recognition/llm-routes-20261010/${areaId}-roads.json`); expect(rows.every(r => sha(roadBytes) === r.sourceHash)).toBe(true);
  const files = ['src/lib/route/macroCycleSearch.ts', 'src/lib/route/exactRoadPortGraph.ts', 'tests/eval/macro-cycle-pilot-20261013.test.ts', 'src/lib/route/fit.ts', 'src/lib/route/shapes.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/shapeFitHypotheses.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/loops.ts', 'src/lib/art/rdp.ts'];
  const codeHashes = Object.fromEntries(files.map(f => { const bytes = readFileSync(f); writeFileSync(path.join(out, `${path.basename(f)}.source`), bytes); return [f, sha(bytes)]; }));
  const protocol = { areaId, params: diverseStateQuota ? MACRO_CYCLE_DIVERSE_PARAMS : MACRO_CYCLE_PARAMS, diverseStateQuota, fitHypothesesPerGeometryShape: 8, refitTopPerShape: 8, refitEvaluations: 128, originalScore: true, originalTemplate: true, codeHashes, roadHash: sha(roadBytes), inputHash: sha(inputBytes), storedAutomaticIncumbentComparisonOnly: true, storedRoutesNotGenerationSeeds: true, fromRoadsWholeCascadeRerun: false, holdoutRead: false, generationQualityIndependent: true, arcDepthChosenAfterOriginal12RepresentationAudit: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const g = graphFromOverpass(JSON.parse(roadBytes.toString()), rows[0].bbox, { detail: 'simple', excludeSteps: true });
  const [minX, minY] = project(g.origin, rows[0].bbox.south, rows[0].bbox.west), [maxX, maxY] = project(g.origin, rows[0].bbox.north, rows[0].bbox.east), region = { minX, minY, maxX, maxY };
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const graphStart = Date.now(), pg = exactRoadPortGraph(g, region), graphMs = Date.now() - graphStart, generationStart = Date.now();
  writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ stage: 'generation', graphMs }));
  const generated = macroCycleSearch(g, pg, region, diverseStateQuota), generationMs = Date.now() - generationStart;
  expect(generated.candidates.length).toBeLessThanOrEqual(256); expect(generated.diagnostics.maxLiveStates).toBeLessThanOrEqual(4096);
  for (const c of generated.candidates) { expect(c.nodes[0]).toBe(c.nodes.at(-1)); expect(c.nodes.every((v, i) => inside(g.x[v], g.y[v]) && (!i || hasEdge(g, c.nodes[i - 1], v)))).toBe(true); }
  writeFileSync(path.join(out, 'generation.json'), JSON.stringify({ protocol, graphMs, generationMs, ...generated }, null, 2));
  const raw = (e: ReturnType<typeof evaluatePath>, scale: number) => 100 * Math.exp(-e.meanDev / (.08 * scale) - Math.log1p(.03 * e.zigzagPerKm) + Math.log(.55 + .45 * e.featureCoverage) + e.spikes * Math.log(.9));
  const index = new Map<string, number[]>(), nodeKey = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
  for (let v = 0; v < g.n; v++) { const k = nodeKey(g.lat[v], g.lon[v]); index.set(k, [...(index.get(k) ?? []), v]); }
  const cases = [];
  for (const row of rows) {
    writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ stage: 'fit', caseId: row.caseId }));
    const fitStart = Date.now(), shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
    const priorNodes = row.candidate.latlngs.map(([lat, lon]) => { const ids = index.get(nodeKey(lat, lon)); expect(ids).toHaveLength(1); const v = ids![0]; expect(Math.abs(g.lat[v] - lat)).toBeLessThan(1e-10); expect(Math.abs(g.lon[v] - lon)).toBeLessThan(1e-10); return v; });
    const beforeEval = evaluatePath(g, shape, row.candidate.placement, priorNodes, 3000, 8000), canonicalEval = evaluatePath(g, shape, row.candidate.placement, pairPhaseZero(g, shape, row.candidate.placement, priorNodes), 3000, 8000);
    expect(beforeEval.similarity).toBe(row.candidate.similarity); const beforeRaw = raw(beforeEval, row.candidate.placement.scale), strongBeforeRaw = Math.max(beforeRaw, raw(canonicalEval, row.candidate.placement.scale));
    const pool = []; let poseOutside = 0, nativeRejected = 0, nativeQCalls = 0, refitCalls = 0;
    for (const geometry of generated.candidates) for (const { placement } of shapeFitHypotheses(geometry.nodes.map(v => [g.x[v], g.y[v]]), shape, 8)) {
      if (!placeShape(shape.points, placement).every(([x, y]) => inside(x, y))) { poseOutside++; continue; }
      const nodes = pairPhaseZero(g, shape, placement, geometry.nodes), e = evaluatePath(g, shape, placement, nodes, 3000, 8000); nativeQCalls++;
      expect(e.lengthMeters).toBeCloseTo(geometry.lengthMeters, 3); expect(e.repeatRatio).toBeCloseTo(geometry.repeatRatio, 5);
      if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) { nativeRejected++; continue; }
      pool.push({ raw: raw(e, placement.scale), candidate: toCandidate(g, shape, placement, e), nodes });
    }
    pool.sort((a, b) => b.raw - a.raw); const top = pool.slice(0, 8);
    for (const item of top) {
      const refit = refinePathPlacement(g, shape, item.candidate.placement, item.nodes, region, 3000, 8000, 128);
      if (!refit) continue; refitCalls += refit.evaluations; const nodes = pairPhaseZero(g, shape, refit.placement, item.nodes), e = evaluatePath(g, shape, refit.placement, nodes, 3000, 8000); nativeQCalls++;
      pool.push({ raw: raw(e, refit.placement.scale), candidate: toCandidate(g, shape, refit.placement, e), nodes });
    }
    pool.sort((a, b) => b.raw - a.raw); const best = pool[0] ?? null, geometryChanged = !!best && pairEdgeKey(best.nodes) !== pairEdgeKey(priorNodes), improves = !!best && geometryChanged && best.raw > strongBeforeRaw + 1e-7;
    const result = { caseId: row.caseId, before: row.candidate.similarity, beforeRaw, canonicalBeforeRaw: raw(canonicalEval, row.candidate.placement.scale), strongBeforeRaw, newGeometryBest: best, geometryChanged, improves, after: improves ? best!.candidate.similarity : row.candidate.similarity, afterRaw: improves ? best!.raw : beforeRaw, acceptedCandidate: improves ? best!.candidate : row.candidate, poseOutside, nativeRejected, nativeQCalls, refitCalls, fitMs: Date.now() - fitStart };
    cases.push(result); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(result, null, 2));
  }
  for (const f of files) expect(sha(readFileSync(f))).toBe(codeHashes[f]);
  const summary = { denominator: 4, beforeAverage: cases.reduce((s, c) => s + c.before, 0) / 4, afterAverage: cases.reduce((s, c) => s + c.after, 0) / 4, improvements: cases.filter(c => c.improves).length, graphMs, generationMs, fitMs: cases.reduce((s, c) => s + c.fitMs, 0) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, diagnostics: generated.diagnostics, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
