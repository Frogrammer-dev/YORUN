import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { globalSearch } from '@/lib/route/globalSearch';
import { shapeGuidedPortRolloutWitness } from '@/lib/route/shapeGuidedPortRolloutWitness';
import { placeShape, toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { pointSegDist, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { SHAPE_GUIDED_ROLLOUT_PARAMS } from '@/lib/route/shapeGuidedPortRolloutBeam';




import { shapeGuidedPortRolloutProductStages } from '@/lib/route/shapeGuidedPortRolloutProductStages';
import { CONTINUOUS_PHASE_PARAMS } from '@/lib/route/continuousEdgePhase';
import { polylineLength, resample, SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { rolloutPathAuditor, rolloutStartPorts, selectRolloutPoses } from './rollout-pilot-support';

it.skipIf(!process.env.SHAPE_GUIDED_WITNESS)('compares actual native outline evidence retention with the identical legacy selector and feedback caps', () => {
  const area = process.env.ROLLOUT_AREA ?? 'gwangalli';
  const productBound = true;
  const astar = productBound || process.env.ROLLOUT_SCHEDULE === 'completed-suffix-bound';
  const noBacktrack = astar || process.env.ROLLOUT_SCHEDULE === 'no-immediate-reverse';
  const continuous = noBacktrack || process.env.ROLLOUT_SCHEDULE === 'continuous-edge';
  const scheduled = continuous || process.env.ROLLOUT_SCHEDULE === 'remaining-unit';
  expect(['gwangalli', 'seomyeon', 'gangnam']).toContain(area);
  const out = path.resolve('eval/recognition/route-improvement', productBound ? 'shape-guided-witness-20261014' : astar ? 'shape-guided-rollout-astar-20261014' : noBacktrack ? 'shape-guided-rollout-no-backtrack-20261014' : continuous ? 'shape-guided-rollout-continuous-20261013' : scheduled ? 'shape-guided-rollout-scheduled-20261013' : 'shape-guided-rollout-20261013', area);
  if (existsSync(out)) throw new Error('Frozen witness output already exists; never overwrite it');
  mkdirSync(out, { recursive: true });
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const inputBytes = readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json');
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; raw: number; sourceHash: string }> };
  const rows = input.cases.filter(row => row.caseId.startsWith(`${area}-`)); expect(rows).toHaveLength(4);
  expect(new Set(rows.map(row => row.caseId))).toEqual(new Set(['square', 'heart', 'star', 'cat'].map(id => `${area}-${id}`)));
  const fixedBoxes: Record<string, BBox> = { gwangalli: { south: 35.143, west: 129.100, north: 35.166, east: 129.128 }, seomyeon: { south: 35.145, west: 129.048, north: 35.170, east: 129.076 }, gangnam: { south: 37.490, west: 127.020, north: 37.515, east: 127.051 } };
  for (const row of rows) expect(row.bbox).toEqual(fixedBoxes[area]);
  const roadBytes = readFileSync(`eval/recognition/llm-routes-20261010/${area}-roads.json`);
  expect(rows.every(row => row.sourceHash === hash(roadBytes))).toBe(true);
  const files = ['tests/eval/shape-guided-witness-20261014.test.ts', 'tests/eval/create-witness-pilot.mjs', 'tests/eval/create-witness-rollout.mjs', 'src/lib/route/shapeGuidedPortRolloutWitness.ts', 'src/lib/route/nativeGuideWitness.ts', 'tests/eval/rollout-pilot-support.ts', 'src/lib/route/shapeGuidedPortRolloutBeam.ts', 'src/lib/route/exactRoadPortGraph.ts', 'src/lib/route/globalSearch.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/loops.ts', 'src/lib/route/flex.ts', 'src/lib/art/rdp.ts'];
  if (scheduled) files.push('src/lib/route/shapeGuidedPortRolloutScheduled.ts');
  if (continuous) files.push('src/lib/route/shapeGuidedPortRolloutContinuous.ts', 'src/lib/route/continuousEdgePhase.ts', 'src/lib/route/continuousGuideDistance.ts', 'src/lib/route/segmentRadiusInterval.ts');
  if (noBacktrack) files.push('src/lib/route/shapeGuidedPortRolloutNoBacktrack.ts', 'tests/eval/create-no-backtrack-rollout.mjs');
  if (astar) files.push('src/lib/route/shapeGuidedPortRolloutAStar.ts', 'src/lib/route/orderedClosureBound.ts', 'tests/eval/create-astar-rollout.mjs');
  if (productBound) files.push('src/lib/route/shapeGuidedPortRolloutProductStages.ts', 'src/lib/route/shapeGuidedPortRolloutProductBound.ts', 'src/lib/route/guideProductClosureBound.ts', 'tests/eval/create-product-stage-rollout.mjs', 'tests/eval/create-product-bound-rollout.mjs');
  const codeHashes = Object.fromEntries(files.map(file => { const bytes = readFileSync(file); writeFileSync(path.join(out, `${path.basename(file)}.source`), bytes); return [file, hash(bytes)]; }));
  const params = scheduled ? { ...SHAPE_GUIDED_ROLLOUT_PARAMS, scheduling: 'remaining-unit', callCapIsRemainingUnitBudget: true, legacySubcapsIgnored: true, actualWorkEqualAcrossArms: false, ...(continuous ? { continuousPhase: CONTINUOUS_PHASE_PARAMS, transitionBudgetCountsReturnedPhaseBranches: true, continuousDPWorkMeasuredSeparately: true } : {}), ...(noBacktrack ? { immediateMacroReverseExcluded: true } : {}), ...(astar ? { priority: 'cost-plus-completed-suffix-lower-bound', closureBoundSetupMeasuredSeparately: true, prefixOptimalityClaim: false } : {}) } : SHAPE_GUIDED_ROLLOUT_PARAMS;
  if (productBound) Object.assign(params, { priority: 'cost-plus-guide-product-suffix-lower-bound', scheduling: 'fixed-subcaps', callCapIsRemainingUnitBudget: false, legacySubcapsIgnored: false, boundedCallCapOvershoot: 3, feedbackOutsideControlSelectionMeasured: true, productSetupMeasuredSeparately: true, productSetupIncludedInExpansionBudget: false, relaxedUnreachableStatePruning: true, productCertificateUsedForRouteGeneration: false });
  const protocol = { area, witnessArms: ['legacy-cost-hash-with-observation', 'native-outline-witness'], feedbackEnabledInBothArms: true, witnessLineageVerifiedWithActualGoalArcPrefixes: true, allRescuedQLineageAudited: true, returnedTop16NativeAudited: true, legacyGwangalliCountersRequired: true, schedule: productBound ? 'actual-native-outline-witness' : astar ? 'completed-suffix-bound' : noBacktrack ? 'no-immediate-reverse' : continuous ? 'continuous-edge' : scheduled ? 'remaining-unit' : 'fixed-subcaps', params, codeHashes, inputHash: hash(inputBytes), roadHash: hash(roadBytes), denominator: 4, originalScore: true, originalTemplate: true, storedAutomaticIncumbentComparisonOnly: true, storedRouteGenerationSeeds: false, fromRoadsWholeCascadeRerun: false, holdoutRead: false, baselineRefitPerRepresentation: 128, baselineRepresentations: 2, armRefitTop: 8, armRefitPerCanonicalCandidate: 128, unusedUnitBudgetRedistributed: false };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const graphStart = Date.now(), g = graphFromOverpass(JSON.parse(roadBytes.toString()), rows[0].bbox, { detail: 'simple', excludeSteps: true });
  const [minX, minY] = project(g.origin, rows[0].bbox.south, rows[0].bbox.west), [maxX, maxY] = project(g.origin, rows[0].bbox.north, rows[0].bbox.east), region = { minX, minY, maxX, maxY };
  const pg = exactRoadPortGraph(g, region), graphMs = Date.now() - graphStart;
  const cases: Array<{ originalBefore: number; beforeFairRefit: number; arms: Array<{ after: number; afterRaw: number; improvement: boolean; directRolloutQCalls: number; diagnostics: { expansions: number } }> }> = [];
  for (const row of rows) {
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], auditor = rolloutPathAuditor(g, shape, region);
    const originalNodes = auditor.nodesFor(row.candidate), original = auditor.audit(originalNodes, row.candidate.placement);
    expect(original.raw).toBeCloseTo(row.raw, 8); expect(original.evaluated.similarity).toBe(row.candidate.similarity);
    const originalKey = pairEdgeKey(originalNodes);
    const nativeCheck = (nodes: number[]) => {
      let meters = 0, repeated = 0; const used = new Set<string>();
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b = nodes[i]; let edge = -1;
        for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) { edge = k; break; }
        expect(edge).toBeGreaterThanOrEqual(0);
        const key = Math.min(a, b) + ':' + Math.max(a, b); meters += g.adjLen[edge];
        if (used.has(key)) repeated += g.adjLen[edge]; used.add(key);
      }
      expect(meters).toBeGreaterThanOrEqual(3000); expect(meters).toBeLessThanOrEqual(8000); expect(repeated / meters).toBeLessThanOrEqual(.2);
    };
    type Scored = { candidate: RouteCandidate; raw: number; nodes: number[]; placement: Placement };
    const scored = (nodes: number[], placement: Placement): Scored => { nativeCheck(nodes); const a = auditor.audit(nodes, placement); return { candidate: toCandidate(g, shape, placement, a.evaluated), raw: a.raw, nodes, placement }; };
    const canonical = pairPhaseZero(g, shape, row.candidate.placement, originalNodes);
    const baselinePool = [scored(originalNodes, row.candidate.placement), scored(canonical, row.candidate.placement)];
    let baselineRefitEvaluations = 0;
    for (const nodes of [originalNodes, canonical]) {
      const fit = refinePathPlacement(g, shape, row.candidate.placement, nodes, region, 3000, 8000, 128);
      if (!fit) continue; baselineRefitEvaluations += fit.evaluations;
      baselinePool.push(scored(fit.evaluated.path, fit.placement));
      baselinePool.push(scored(pairPhaseZero(g, shape, fit.placement, fit.evaluated.path), fit.placement));
    }
    baselinePool.sort((a, b) => b.raw - a.raw); const baseline = baselinePool[0];
    writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ caseId: row.caseId, stage: 'automatic-coarse-poses' }));
    const coarseStart = Date.now(), coarse = globalSearch(g, shape, region, 0, true, true), coarseMs = Date.now() - coarseStart;
    expect(coarse.evaluated).toBe(0);
    const poses = selectRolloutPoses(coarse.placementSeeds, region), expectedStarts = poses.map(p => rolloutStartPorts(g, pg.ports, shape, p));
    const arms = [];
    for (const witnessEnabled of [false, true]) {
      const feedback = true;
      const name = witnessEnabled ? 'witness' : 'control';
      writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ caseId: row.caseId, stage: name }));
      const search = (...args: Parameters<typeof shapeGuidedPortRolloutProductStages>) => shapeGuidedPortRolloutWitness(...args, witnessEnabled);
      const began = Date.now(), result = search(g, pg, shape, region, poses, feedback), searchMs = Date.now() - began;
      expect(result.selectedPoses).toEqual(poses);
      expect(result.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(result.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
      for (const unit of result.diagnostics.units) { expect(unit.expansions).toBeLessThanOrEqual(25000); if (!unit.noStart) expect(unit.start).toBe(expectedStarts[unit.poseId][unit.startId]); }
      if (productBound) {
        const staged = result as ReturnType<typeof shapeGuidedPortRolloutProductStages>;
        expect(staged.diagnostics.maxCallCapOvershoot).toBeLessThanOrEqual(3);
        for (const unit of staged.diagnostics.units) if (!unit.noStart) {
          expect(unit.maxCallCapOvershoot).toBeLessThanOrEqual(3);
          expect(unit.searchCalls).toBeDefined(); expect(unit.stages).toBeDefined();
          for (const call of unit.searchCalls ?? []) expect(call.expanded).toBeLessThanOrEqual(call.effectiveCap + 3);
          for (const stage of unit.stages ?? []) {
            expect(stage.feedbackOutsideControlSelected).toBeLessThanOrEqual(stage.selectedSetDifference.selectedOnlyHashes.length);
            if (!feedback) expect(stage.selectedSetDifference.symmetricCount).toBe(0);
          }
        }
      }
      const witnessed = result as ReturnType<typeof shapeGuidedPortRolloutWitness>;
      expect(witnessed.params.witnessPolicy).toBe(witnessEnabled);
      expect(witnessed.diagnostics.witnessRescueTraces.length).toBeLessThanOrEqual(512);
      expect(witnessed.diagnostics.witnessCompletedLineage.length).toBeLessThanOrEqual(witnessed.diagnostics.rolloutQCalls);
      if (!witnessEnabled) { expect(witnessed.diagnostics.witnessRescueTraces).toEqual([]); expect(witnessed.diagnostics.witnessRescueAttempts).toBe(0); }
      if (!witnessEnabled && area === 'gwangalli') {
        const expectedLegacy: Record<string, [number, number]> = { 'gwangalli-square': [245, 205319], 'gwangalli-heart': [146, 176621], 'gwangalli-star': [104, 147145], 'gwangalli-cat': [230, 218728] };
        expect([witnessed.diagnostics.rolloutQCalls, witnessed.diagnostics.expansions]).toEqual(expectedLegacy[row.caseId]);
      }
      for (const [id, trace] of witnessed.diagnostics.witnessRescueTraces.entries()) {
        expect(trace.id).toBe(id); expect(trace.incoming).toBe(trace.arcPath.at(-1) ?? -1);
        if (trace.parentStateId !== null) expect(trace.stateId).toBeGreaterThan(trace.parentStateId);
        for (const competitor of trace.costCompetitors ?? []) {
          expect(competitor.incoming).toBe(trace.incoming); expect(competitor.phase).toBe(trace.phase); expect(competitor.lengthBucket).toBe(trace.lengthBucket);
        }
      }
      for (const lineage of witnessed.diagnostics.witnessCompletedLineage) {
        const p = witnessed.selectedPoses[Math.floor(lineage.unit / 2)], raw = auditor.audit(lineage.nativeNodes, p).raw;
        nativeCheck(lineage.nativeNodes); expect(raw).toBeCloseTo(lineage.raw, 8);
        const actual = lineage.goalArcPath.flatMap((id, i) => {
          expect(Number.isInteger(id) && id >= 0 && id < pg.edges.length * 2).toBe(true);
          const nodes = pg.edges[Math.floor(id / 2)].nodes, segment = id % 2 ? nodes.slice().reverse() : nodes;
          return i ? segment.slice(1) : segment.slice();
        });
        expect(pairPhaseZero(g, shape, p, actual)).toEqual(lineage.nativeNodes);
        for (const id of lineage.witnessRescueIds) {
          const trace = witnessed.diagnostics.witnessRescueTraces[id];
          expect(trace.id).toBe(id); expect(trace.unit).toBe(lineage.unit);
          expect(trace.stateId).toBeLessThanOrEqual(lineage.goalStateId);
          expect(lineage.goalArcPath.slice(0, trace.arcPath.length)).toEqual(trace.arcPath);
        }
      }
      for (const entry of witnessed.pool) {
        const arcPath = entry.provenance.goalArcPath;
        const native = arcPath.flatMap((id, i) => {
          expect(Number.isInteger(id) && id >= 0 && id < pg.edges.length * 2).toBe(true);
          const original = pg.edges[Math.floor(id / 2)].nodes;
          const segment = id % 2 ? original.slice().reverse() : original;
          return i ? segment.slice(1) : segment.slice();
        });
        nativeCheck(native);
        expect(pairPhaseZero(g, shape, entry.candidate.placement, native)).toEqual(entry.nodes);
        const outline = placeShape(shape.points, entry.candidate.placement), samples = resample(outline, Math.max(8, Math.round(polylineLength(outline) / 12)));
        let d2 = 0;
        for (const [x, y] of samples) {
          let d = Infinity;
          for (let i = 1; i < native.length; i++) d = Math.min(d, pointSegDist(x, y, g.x[native[i - 1]], g.y[native[i - 1]], g.x[native[i]], g.y[native[i]]));
          d2 += d;
        }
        expect(entry.nativeWitness.guideToRoute).toBeCloseTo(d2 / samples.length, 8);
        expect(entry.nativeWitness.featureCoverage).toBe(auditor.audit(entry.nodes, entry.candidate.placement).evaluated.featureCoverage);
        for (const id of entry.provenance.witnessRescueIds) {
          const trace = witnessed.diagnostics.witnessRescueTraces[id];
          expect(trace.id).toBe(id); expect(trace.unit).toBe(entry.provenance.unit);
          expect(trace.stateId).toBeLessThanOrEqual(entry.provenance.goalStateId);
          expect(trace.arcPath.length).toBeLessThanOrEqual(arcPath.length);
          expect(arcPath.slice(0, trace.arcPath.length)).toEqual(trace.arcPath);
        }
      }
      const candidates: Scored[] = [];
      for (const entry of result.pool) {
        expect(entry.nodes).toEqual(pairPhaseZero(g, shape, entry.candidate.placement, entry.nodes));
        const item = scored(entry.nodes, entry.candidate.placement); expect(item.raw).toBeCloseTo(entry.raw, 8); candidates.push(item);
      }
      const refitStart = Date.now(); let refitEvaluations = 0, refitFinalAuditCalls = 0;
      for (const entry of result.pool.slice(0, 8)) {
        const fit = refinePathPlacement(g, shape, entry.candidate.placement, entry.nodes, region, 3000, 8000, 128);
        if (!fit) continue; refitEvaluations += fit.evaluations;
        candidates.push(scored(pairPhaseZero(g, shape, fit.placement, entry.nodes), fit.placement)); refitFinalAuditCalls++;
      }
      const refitMs = Date.now() - refitStart;
      candidates.sort((a, b) => b.raw - a.raw);
      const bestGeometry = candidates.find(c => pairEdgeKey(c.nodes) !== originalKey) ?? null;
      const improvement = !!bestGeometry && bestGeometry.raw > baseline.raw + 1e-7;
      const accepted = improvement ? bestGeometry! : baseline;
      expect(accepted.raw).toBeGreaterThanOrEqual(original.raw - 1e-8);
      const arm = { name, feedback, witnessEnabled, searchParams: result.params, searchMs, refitMs, refitEvaluations, refitFinalAuditCalls, directRolloutQCalls: result.diagnostics.rolloutQCalls, totalSearchAndRefitQCalls: result.diagnostics.rolloutQCalls + refitEvaluations + refitFinalAuditCalls, diagnostics: result.diagnostics, pool: result.pool, bestGeometry, improvement, after: accepted.candidate.similarity, afterRaw: accepted.raw, acceptedCandidate: accepted.candidate };
      arms.push(arm); writeFileSync(path.join(out, `${row.caseId}-${name}.json`), JSON.stringify(arm, null, 2));
    }
    const record = { caseId: row.caseId, originalBefore: row.candidate.similarity, originalRaw: original.raw, beforeFairRefit: baseline.candidate.similarity, beforeFairRaw: baseline.raw, baselineRefitEvaluations, coarseMs, coarseSeeds: coarse.coarseSeeds, selectedPoses: poses, expectedStarts, arms };
    cases.push(record); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(record, null, 2));
  }
  for (const file of files) expect(hash(readFileSync(file))).toBe(codeHashes[file]);
  const summary = { denominator: 4, graphMs, originalAverage: cases.reduce((s, c) => s + c.originalBefore, 0) / 4, fairBaselineAverage: cases.reduce((s, c) => s + c.beforeFairRefit, 0) / 4, arms: [0, 1].map(i => ({ name: i ? 'witness' : 'control', average: cases.reduce((s, c) => s + c.arms[i].after, 0) / 4, rawAverage: cases.reduce((s, c) => s + c.arms[i].afterRaw, 0) / 4, improvements: cases.filter(c => c.arms[i].improvement).length, rolloutQCalls: cases.reduce((s, c) => s + c.arms[i].directRolloutQCalls, 0), expansions: cases.reduce((s, c) => s + c.arms[i].diagnostics.expansions, 0) })) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
