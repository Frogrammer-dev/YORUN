import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { continuousArcPhase, continuousEdgePhase } from '@/lib/route/continuousEdgePhase';
import { encodeExactRoadPath, exactRoadPortGraph, expandExactRoadPath } from '@/lib/route/exactRoadPortGraph';
import { type Placement, type RouteCandidate } from '@/lib/route/fit';
import { project, type RoadGraph } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { rolloutGuide } from '@/lib/route/shapeGuidedPortRolloutAStar';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { rolloutPathAuditor, rolloutStartPorts } from './rollout-pilot-support';

type XY = [number, number];
type ReplayStep = { step: number; from: number; to: number; phases: number[]; labelsEmitted: number; capSkipped: number; };

/** Fixed actual path, no path search: all phase states survive between steps. */
function replay(g: RoadGraph, guide: XY[], radius: number, tol: number, parts: number[][], cappedMacro: boolean) {
  let frontier = new Map<number, number>([[0, 0]]), firstEmptyStep: number | null = null, labelCalls = 0, totalCapSkipped = 0;
  const trace: ReplayStep[] = [];
  for (let step = 0; step < parts.length; step++) {
    const nodes = parts[step], next = new Map<number, number>(); let labelsEmitted = 0, capSkipped = 0;
    for (const [phase, cost] of frontier) {
      let labels;
      if (cappedMacro) {
        const result = continuousArcPhase(g, nodes, guide, phase, radius, tol);
        labels = result.labels; capSkipped += result.work.phaseChoiceCapSkipped;
      } else {
        expect(nodes).toHaveLength(2);
        const from = nodes[0], to = nodes[1]; let native = -1;
        for (let edge = g.adjStart[from]; edge < g.adjStart[from + 1]; edge++) if (g.adjTo[edge] === to) { native = g.adjLen[edge]; break; }
        expect(native).toBeGreaterThanOrEqual(0);
        labels = continuousEdgePhase(g, from, to, guide, phase, radius, native, tol).labels;
      }
      labelCalls++; labelsEmitted += labels.length;
      for (const label of labels) if (cost + label.proxyExtra < (next.get(label.phase) ?? Infinity)) next.set(label.phase, cost + label.proxyExtra);
    }
    totalCapSkipped += capSkipped; frontier = next;
    trace.push({ step, from: nodes[0], to: nodes.at(-1)!, phases: [...frontier.keys()].sort((a, b) => a - b), labelsEmitted, capSkipped });
    if (!frontier.size) { firstEmptyStep = step; break; }
  }
  const terminalPhases = [...frontier.keys()].sort((a, b) => a - b);
  return { completedLastPhaseAtActualClosure: frontier.has(guide.length - 1), terminalPhases, firstEmptyStep, maxReachableTerminalPhase: Math.max(-1, ...terminalPhases), labelCalls, totalCapSkipped, trace };
}

it.skipIf(!process.env.ROLLOUT_KNOWN_PATH_REPLAY)('diagnoses representation and phase reachability of twelve fixed actual native paths', () => {
  const runTag = process.env.ROLLOUT_KNOWN_PATH_REPLAY_TAG ?? 'initial'; expect(runTag).toMatch(/^[a-z0-9-]+$/);
  const out = path.resolve('eval/recognition/route-improvement/rollout-known-path-replay-20261014', runTag); mkdirSync(out, { recursive: true });
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const inputBytes = readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json');
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; sourceHash: string; raw: number; candidate: RouteCandidate }> };
  expect(input.cases).toHaveLength(12);
  const files = ['tests/eval/rollout-known-path-replay-20261014.test.ts', 'tests/eval/rollout-pilot-support.ts', 'src/lib/route/continuousEdgePhase.ts', 'src/lib/route/continuousGuideDistance.ts', 'src/lib/route/segmentRadiusInterval.ts', 'src/lib/route/exactRoadPortGraph.ts', 'src/lib/route/shapeGuidedPortRolloutAStar.ts', 'src/lib/route/orderedClosureBound.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/art/rdp.ts'];
  const codeHashes = Object.fromEntries(files.map(file => { const bytes = readFileSync(file); writeFileSync(path.join(out, `${path.basename(file)}.source`), bytes); return [file, sha(bytes)]; }));
  const protocol = { inputHash: sha(inputBytes), codeHashes, denominator: 12, fixedKnownPathsOnly: true, storedRouteUsedForStructuralDiagnosticOnly: true, noRouteGeneration: true, noAlgorithmChange: true, noQualityGainClaim: true, holdoutRead: false, radiusFraction: .16, nativePhaseUnion: 'continuousEdgePhase all returned labels; phase-minimum cost; no global pruning', macroPhaseUnion: 'current continuousArcPhase endpoint cap per incoming phase; phase-minimum cost between spans', partialSpansDiagnosticOnly: true, budgetAndHistoryDominanceNotSimulated: true, nativeReplayIsNotExactContinuousFrechet: true, originalPlacementUnchanged: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const cases = []; const began = Date.now();
  for (const row of input.cases) {
    const area = row.caseId.split('-')[0], roads = readFileSync(`eval/recognition/llm-routes-20261010/${area}-roads.json`); expect(sha(roads)).toBe(row.sourceHash);
    const g = graphFromOverpass(JSON.parse(roads.toString()), row.bbox, { detail: 'simple', excludeSteps: true });
    const [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY };
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], placement: Placement = row.candidate.placement, guide = rolloutGuide(shape, placement), radius = .16 * placement.scale, tol = Math.max(20, .06 * placement.scale), pg = exactRoadPortGraph(g, region), auditor = rolloutPathAuditor(g, shape, region);
    const original = auditor.nodesFor(row.candidate), audit = auditor.audit(original, placement); expect(audit.raw).toBeCloseTo(row.raw, 8); expect(audit.evaluated.similarity).toBe(row.candidate.similarity);
    const canonical = pairPhaseZero(g, shape, placement, original), loop = canonical.slice(0, -1), key = pairEdgeKey(original), portSet = new Set(pg.ports);
    const distance = (v: number) => Math.hypot(g.x[v] - guide[0][0], g.y[v] - guide[0][1]);
    const graphStarts = rolloutStartPorts(g, pg.ports, shape, placement), pathPorts = [...new Set(loop.filter(v => portSet.has(v)))].sort((a, b) => distance(a) - distance(b) || g.x[a] - g.x[b] || g.y[a] - g.y[b]);
    const representations: Array<{ name: string; nodes: number[] }> = [{ name: 'original-seam-direction', nodes: original }, { name: 'canonical-nearest-native-node', nodes: canonical }];
    for (const [rank, port] of pathPorts.slice(0, 2).entries()) {
      const i = loop.indexOf(port), rotated = [...loop.slice(i), ...loop.slice(0, i)];
      representations.push({ name: `nearest-path-port-${rank + 1}-canonical-direction`, nodes: [...rotated, port] });
      representations.push({ name: `nearest-path-port-${rank + 1}-reverse-direction`, nodes: [port, ...rotated.slice(1).reverse(), port] });
    }
    const results = representations.map(({ name, nodes }) => {
      expect(pairEdgeKey(nodes)).toBe(key); const e = auditor.audit(nodes, placement).evaluated;
      expect(e.lengthMeters).toBeCloseTo(audit.evaluated.lengthMeters, 6); expect(e.repeatRatio).toBeCloseTo(audit.evaluated.repeatRatio, 10);
      const spans = encodeExactRoadPath(pg, nodes); expect(expandExactRoadPath(pg, spans)).toEqual(nodes);
      const partialSpans = spans.flatMap((s, i) => { const last = pg.edges[s.edgeId].nodes.length - 1; return (s.from === 0 && s.to === last) || (s.from === last && s.to === 0) ? [] : [{ span: i, edgeId: s.edgeId, from: s.from, to: s.to, fullEdgeLastIndex: last }]; });
      const native = replay(g, guide, radius, tol, nodes.slice(1).map((v, i) => [nodes[i], v]), false), macro = replay(g, guide, radius, tol, spans.map(s => expandExactRoadPath(pg, [s])), true);
      // Every capped-macro witness is a native-edge witness. This is a diagnostic, not a score optimization.
      if (macro.completedLastPhaseAtActualClosure) expect(native.completedLastPhaseAtActualClosure).toBe(true);
      return { name, start: nodes[0], startIsPort: portSet.has(nodes[0]), startDistanceMeters: distance(nodes[0]), startWithinProductionRadius: distance(nodes[0]) <= radius, startSelectedByProductionNearestTwo: graphStarts.includes(nodes[0]), originalEdgeGeometryPreserved: true, nativeLengthPreserved: true, orderedNativeEdgesPreservedByCompression: true, nativeMeters: e.lengthMeters, repeatRatio: e.repeatRatio, arcSpanCount: spans.length, arcDepthWithin128: spans.length <= 128, partialSpans, fullMacroRepresentation: partialSpans.length === 0, adjacentMacroReverse: spans.some((s, i) => i > 0 && spans[i - 1].edgeId === s.edgeId && Math.sign(spans[i - 1].to - spans[i - 1].from) !== Math.sign(s.to - s.from)), endpointCapLosesKnownClosure: native.completedLastPhaseAtActualClosure && !macro.completedLastPhaseAtActualClosure, native, macro };
    });
    const c = { caseId: row.caseId, roadHash: sha(roads), originalRaw: row.raw, originalSimilarity: row.candidate.similarity, placement, guideCount: guide.length, radiusMeters: radius, productionGraphStarts: graphStarts, productionStartsOnKnownPath: graphStarts.filter(v => loop.includes(v)), nearestPathPorts: pathPorts.slice(0, 2).map(v => ({ node: v, distanceMeters: distance(v), withinRadius: distance(v) <= radius, selectedByProductionNearestTwo: graphStarts.includes(v) })), representations: results };
    cases.push(c); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(c, null, 2));
    writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ completedCases: cases.length, caseId: row.caseId, elapsedMs: Date.now() - began }));
  }
  for (const file of files) expect(sha(readFileSync(file))).toBe(codeHashes[file]);
  const nativeCases = cases.filter(c => c.representations.some(r => r.native.completedLastPhaseAtActualClosure)), cappedCases = cases.filter(c => c.representations.some(r => r.macro.completedLastPhaseAtActualClosure));
  const productionCases = cases.filter(c => c.representations.some(r => r.startSelectedByProductionNearestTwo && r.fullMacroRepresentation && r.arcDepthWithin128 && !r.adjacentMacroReverse && r.macro.completedLastPhaseAtActualClosure));
  const summary = { denominator: cases.length, nativeReplaySomeRepresentationCloses: nativeCases.length, cappedMacroReplaySomeRepresentationCloses: cappedCases.length, productionStartAndFullMacroKnownPathCloses: productionCases.length, endpointCapLossCases: cases.filter(c => c.representations.some(r => r.endpointCapLosesKnownClosure)).map(c => c.caseId), geometryUnrepresentableByCurrentNativePhaseReplayCases: cases.filter(c => !c.representations.some(r => r.native.completedLastPhaseAtActualClosure)).map(c => c.caseId), noAutomaticQualityGainClaim: true, elapsedMs: Date.now() - began };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
