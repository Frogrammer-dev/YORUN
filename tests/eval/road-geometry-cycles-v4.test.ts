import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { matchShape } from '@/lib/route/loops';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { roadGeometrySeeds } from '@/lib/route/roadGeometrySeeds';
import { roadGeometryCycles, ROAD_GEOMETRY_CYCLE_PARAMS } from '@/lib/route/roadGeometryCycles';
import { maximalRoadCorridors, MAXIMAL_CORRIDOR_PARAMS } from '@/lib/route/roadCorridorDecomposition';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.skipIf(!process.env.ROAD_GEOMETRY_CYCLES_V4)('evaluates score-independent automatic actual four-corridor cycles in an original benchmark square', () => {
  const areaId = process.env.ROAD_CYCLE_AREA ?? 'gwangalli'; expect(['gwangalli', 'seomyeon', 'gangnam']).toContain(areaId);
  const out = path.resolve('eval/recognition/route-improvement/road-geometry-cycles-v4-20261013', areaId); mkdirSync(out, { recursive: true });
  const files = ['src/lib/route/roadGeometryCycles.ts', 'src/lib/route/roadCorridorDecomposition.ts', 'src/lib/route/roadGeometrySeeds.ts', 'tests/eval/road-geometry-cycles-v4.test.ts', 'src/lib/route/fit.ts', 'src/lib/route/loops.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/art/rdp.ts'];
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const codeHashes = Object.fromEntries(files.map(f => [f, hash(readFileSync(f, 'utf8'))]));
  const areas = JSON.parse(readFileSync('eval/recognition/llm-routes-20261010/round2-results.json', 'utf8')).protocol.areas as Array<{ id: string; bbox: BBox }>, area = areas.find(a => a.id === areaId)!;
  const sourceText = readFileSync(`eval/recognition/llm-routes-20261010/${areaId}-roads.json`, 'utf8');
  const protocol = { params: ROAD_GEOMETRY_CYCLE_PARAMS, corridorParams: MAXIMAL_CORRIDOR_PARAMS, codeHashes, sourceHash: hash(sourceText), noHoldout: true, noManualCoords: true, noSavedBestSeed: true, extraBudgetBeyondPose48: true, exactGraphNodeCorners: true, evaluationFormulaUnchanged: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const began = Date.now(), g = graphFromOverpass(JSON.parse(sourceText), area.bbox, { detail: 'simple', excludeSteps: true }), shape = SHAPE_BY_ID.square;
  const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY }, inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const priorText = readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8'), priorRows = JSON.parse(priorText).cases as Array<{ caseId: string; candidate: RouteCandidate }>;
  const incumbent = priorRows.find(c => c.caseId === `${areaId}-square`)!.candidate;
  const incumbentNodes = incumbent.latlngs.map(([lat, lon]) => { const [x, y] = project(g.origin, lat, lon); return g.nodeIndex.nearest(x, y, 1); });
  expect(incumbentNodes.every((v, i) => v >= 0 && inside(g.x[v], g.y[v]) && (!i || hasEdge(g, incumbentNodes[i - 1], v)))).toBe(true);
  const nativeRaw = (e: ReturnType<typeof evaluatePath>, scale: number) => 100 * Math.exp(-e.meanDev / (.08 * scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes) / (1 + .03 * e.zigzagPerKm);
  const incumbentOriginal = evaluatePath(g, shape, incumbent.placement, incumbentNodes, 3000, 8000), incumbentCanonical = evaluatePath(g, shape, incumbent.placement, pairPhaseZero(g, shape, incumbent.placement, incumbentNodes), 3000, 8000);
  expect(incumbentOriginal.similarity).toBe(incumbent.similarity);
  const incumbentRaw = nativeRaw(incumbentOriginal, incumbent.placement.scale), incumbentCanonicalRaw = nativeRaw(incumbentCanonical, incumbent.placement.scale);
  const decompositionStarted = Date.now(), decomposition = maximalRoadCorridors(g, region), decompositionMs = Date.now() - decompositionStarted;
  const unusedLegacyProposalStarted = Date.now(), support = { ...roadGeometrySeeds(g, shape, region), supportChains: decomposition.chains }, unusedLegacyProposalMs = Date.now() - unusedLegacyProposalStarted;
  const cycleStarted = Date.now(), cycles = roadGeometryCycles(g, support), cycleEnumerationMs = Date.now() - cycleStarted, candidates = []; let invalidPose = 0, invalidNative = 0;
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`, supportEdges = new Set<string>();
  for (const c of support.supportChains) for (let i = 1; i < c.nodes.length; i++) supportEdges.add(edgeKey(c.nodes[i - 1], c.nodes[i]));
  let incumbentCoveredMeters = 0, incumbentCoveredEdges = 0;
  for (let i = 1; i < incumbentNodes.length; i++) if (supportEdges.has(edgeKey(incumbentNodes[i - 1], incumbentNodes[i]))) {
    incumbentCoveredEdges++; const a = incumbentNodes[i - 1], b = incumbentNodes[i]; for (let ei = g.adjStart[a]; ei < g.adjStart[a + 1]; ei++) if (g.adjTo[ei] === b) { incumbentCoveredMeters += g.adjLen[ei]; break; }
  }
  const incumbentSupportCoverage = { coveredEdges: incumbentCoveredEdges, totalEdges: incumbentNodes.length - 1, coveredMeters: incumbentCoveredMeters, totalMeters: incumbentOriginal.lengthMeters, coveredLengthFraction: incumbentCoveredMeters / incumbentOriginal.lengthMeters, diagnosticOnlyNotSeed: true };
  const fitStarted = Date.now();
  for (const { nodes } of cycles.candidates) {
    expect(nodes[0]).toBe(nodes.at(-1)); expect(nodes.every((v, i) => inside(g.x[v], g.y[v]) && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
    const fit = matchShape(nodes.map(v => [g.x[v], g.y[v]] as [number, number]), shape, undefined, true, undefined, { fullRotation: true });
    if (!fit || !placeShape(shape.points, fit).every(([x, y]) => inside(x, y))) { invalidPose++; continue; }
    const finalNodes = pairPhaseZero(g, shape, fit, nodes), e = evaluatePath(g, shape, fit, finalNodes, 3000, 8000);
    if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) { invalidNative++; continue; }
    const raw = 100 * Math.exp(-e.meanDev / (.08 * fit.scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes) / (1 + .03 * e.zigzagPerKm);
    candidates.push({ raw, candidate: toCandidate(g, shape, fit, e), nodes: finalNodes });
  }
  candidates.sort((a, b) => b.raw - a.raw); expect(cycles.candidates.length).toBeLessThanOrEqual(48);
  const best = candidates[0] ?? null, improvesStrongInput = !!best && best.raw > Math.max(incumbentRaw, incumbentCanonicalRaw) + 1e-7;
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, areaId, incumbentSourceHash: hash(priorText), incumbentSimilarity: incumbent.similarity, incumbentRaw, incumbentCanonicalRaw, incumbentSupportCoverage, preservesIncumbent: true, improvesStrongInput, acceptedCandidate: improvesStrongInput ? best!.candidate : incumbent, decompositionDiagnostics: decomposition.diagnostics, supportDiagnostics: support.diagnostics, cycleDiagnostics: cycles.diagnostics, invalidPose, invalidNative, timings: { decompositionMs, unusedLegacyProposalMs, legacyProposalsUsed: false, cycleEnumerationMs, uniformFitAndNativeEvalMs: Date.now() - fitStarted }, elapsedMs: Date.now() - began, candidates }, null, 2));
}, 3600000);

