import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { matchShape } from '@/lib/route/loops';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';

import { roadConnectorCycles, ROAD_CONNECTOR_CYCLE_PARAMS, corridorIntersection } from '@/lib/route/roadConnectorCycles';
import { clippedRoadCorridors, CLIPPED_CORRIDOR_PARAMS } from '@/lib/route/clippedRoadCorridors';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.skipIf(!process.env.ROAD_GEOMETRY_CYCLES_V6)('evaluates score-independent automatic actual four-corridor cycles in an original benchmark square', () => {
  const areaId = process.env.ROAD_CYCLE_AREA ?? 'gwangalli'; expect(['gwangalli', 'seomyeon', 'gangnam']).toContain(areaId);
  const out = path.resolve('eval/recognition/route-improvement/road-geometry-cycles-v6-20261013', areaId); mkdirSync(out, { recursive: true });
  const files = ['src/lib/route/roadGeometryCycles.ts', 'src/lib/route/roadConnectorCycles.ts', 'src/lib/route/roadCorridorDecomposition.ts', 'src/lib/route/clippedRoadCorridors.ts', 'src/lib/route/roadGeometrySeeds.ts', 'tests/eval/road-geometry-cycles-v6.test.ts', 'src/lib/route/fit.ts', 'src/lib/route/loops.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/art/rdp.ts'];
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const codeHashes = Object.fromEntries(files.map(f => [f, hash(readFileSync(f, 'utf8'))]));
  const areas = JSON.parse(readFileSync('eval/recognition/llm-routes-20261010/round2-results.json', 'utf8')).protocol.areas as Array<{ id: string; bbox: BBox }>, area = areas.find(a => a.id === areaId)!;
  const sourceText = readFileSync(`eval/recognition/llm-routes-20261010/${areaId}-roads.json`, 'utf8');
  const protocol = { params: ROAD_CONNECTOR_CYCLE_PARAMS, corridorParams: CLIPPED_CORRIDOR_PARAMS, codeHashes, sourceHash: hash(sourceText), noHoldout: true, noManualCoords: true, noSavedBestSeed: true, extraBudgetBeyondPose48: true, exactGraphNodeCorners: true, evaluationFormulaUnchanged: true };
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
  const decompositionStarted = Date.now(), decomposition = clippedRoadCorridors(g, region), decompositionMs = Date.now() - decompositionStarted;
  const diagnosed = JSON.parse(readFileSync(`eval/recognition/route-improvement/road-corridor-coverage-20261013/${areaId}.json`, 'utf8')) as { missingRuns: Array<{ nodes: number[]; meters: number; reasons: string[] }> };
  const positiveControlCornerDiagnostics = diagnosed.missingRuns.filter(r => r.reasons.every(s => s === 'too-short')).map(run => {
    const starts = decomposition.chains.filter(c => c.nodes.includes(run.nodes[0])), targets = decomposition.chains.filter(c => c.nodes.includes(run.nodes.at(-1)!));
    const possibilities = [];
    for (const a of starts) for (const b of targets) {
      const delta = Math.min(Math.abs(a.heading - b.heading), 180 - Math.abs(a.heading - b.heading)); if (Math.abs(delta - 90) > 10) continue;
      const center = corridorIntersection(g, a, b); if (!center) continue;
      const maxRadius = Math.max(...run.nodes.map(v => Math.hypot(g.x[v] - center[0], g.y[v] - center[1])));
      possibilities.push({ maxRadius, actualLength: run.meters, satisfies60mCircle120mLength: maxRadius <= 60 && run.meters <= 120 });
    }
    return { actualLength: run.meters, possibilities, diagnosticOnlyNoSearchSeed: true };
  });
  const support = { supportChains: decomposition.chains, diagnostics: decomposition.diagnostics }, unusedLegacyProposalMs = 0;
  const cycleStarted = Date.now(), cycles = roadConnectorCycles(g, decomposition.chains, region), cycleEnumerationMs = Date.now() - cycleStarted, candidates = []; let invalidPose = 0, invalidNative = 0;
  const v5Text = readFileSync(`eval/recognition/route-improvement/road-geometry-cycles-v5-20261013/${areaId}/results.json`, 'utf8'), v5 = JSON.parse(v5Text) as { candidates: Array<{ nodes: number[]; raw: number }>; acceptedCandidate: RouteCandidate };
  const simpleGeometryKey = (nodes: number[]) => nodes.slice(1).map((v, i) => nodes[i] < v ? `${nodes[i]}:${v}` : `${v}:${nodes[i]}`).sort().join('|');
  const beforeCapSet = new Set(cycles.allGeometryKeysBeforeCap), selectedSet = new Set(cycles.candidates.map(c => c.geometryKey));
  expect(v5.candidates.every(c => beforeCapSet.has(simpleGeometryKey(c.nodes)))).toBe(true);
  expect(v5.acceptedCandidate).toEqual(incumbent);
  const v5Comparison = { sourceHash: hash(v5Text), v5ValidCandidates: v5.candidates.length, v5AllValidPreservedBeforeCap: true, v5ValidRetainedAfterCap: v5.candidates.filter(c => selectedSet.has(simpleGeometryKey(c.nodes))).length, v5FinalIncumbentPreserved: true };
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`, supportEdges = new Set<string>();
  for (const c of support.supportChains) for (let i = 1; i < c.nodes.length; i++) supportEdges.add(edgeKey(c.nodes[i - 1], c.nodes[i]));
  let incumbentCoveredMeters = 0, incumbentCoveredEdges = 0;
  for (let i = 1; i < incumbentNodes.length; i++) if (supportEdges.has(edgeKey(incumbentNodes[i - 1], incumbentNodes[i]))) {
    incumbentCoveredEdges++; const a = incumbentNodes[i - 1], b = incumbentNodes[i]; for (let ei = g.adjStart[a]; ei < g.adjStart[a + 1]; ei++) if (g.adjTo[ei] === b) { incumbentCoveredMeters += g.adjLen[ei]; break; }
  }
  const incumbentSupportCoverage = { coveredEdges: incumbentCoveredEdges, totalEdges: incumbentNodes.length - 1, coveredMeters: incumbentCoveredMeters, totalMeters: incumbentOriginal.lengthMeters, coveredLengthFraction: incumbentCoveredMeters / incumbentOriginal.lengthMeters, diagnosticOnlyNotSeed: true };
  const fitStarted = Date.now();
  for (const { nodes, usesConnector } of cycles.candidates) {
    expect(nodes[0]).toBe(nodes.at(-1)); expect(nodes.every((v, i) => inside(g.x[v], g.y[v]) && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
    const fit = matchShape(nodes.map(v => [g.x[v], g.y[v]] as [number, number]), shape, undefined, true, undefined, { fullRotation: true });
    if (!fit || !placeShape(shape.points, fit).every(([x, y]) => inside(x, y))) { invalidPose++; continue; }
    const finalNodes = pairPhaseZero(g, shape, fit, nodes), e = evaluatePath(g, shape, fit, finalNodes, 3000, 8000);
    if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) { invalidNative++; continue; }
    const raw = 100 * Math.exp(-e.meanDev / (.08 * fit.scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes) / (1 + .03 * e.zigzagPerKm);
    candidates.push({ raw, candidate: toCandidate(g, shape, fit, e), nodes: finalNodes, usesConnector, sameGeometryAsIncumbent: pairEdgeKey(finalNodes) === pairEdgeKey(incumbentNodes) });
  }
  candidates.sort((a, b) => b.raw - a.raw); expect(cycles.candidates.length).toBeLessThanOrEqual(48);
  const best = candidates[0] ?? null, improvesStrongInput = !!best && best.raw > Math.max(incumbentRaw, incumbentCanonicalRaw) + 1e-7;
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, areaId, positiveControlCornerDiagnostics, v5Comparison, incumbentSourceHash: hash(priorText), incumbentSimilarity: incumbent.similarity, incumbentRaw, incumbentCanonicalRaw, incumbentSupportCoverage, preservesIncumbent: true, improvesStrongInput, acceptedCandidate: improvesStrongInput ? best!.candidate : incumbent, decompositionDiagnostics: decomposition.diagnostics, supportDiagnostics: support.diagnostics, cycleDiagnostics: cycles.diagnostics, invalidPose, invalidNative, timings: { decompositionMs, unusedLegacyProposalMs, legacyProposalsUsed: false, cycleEnumerationMs, uniformFitAndNativeEvalMs: Date.now() - fitStarted }, elapsedMs: Date.now() - began, candidates }, null, 2));
}, 3600000);



