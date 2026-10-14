import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { globalSearch } from '@/lib/route/globalSearch';
import { ALL_POSE_SELECTION_PARAMS, globalSearchAllPoseSeeds, poseScaleDiversityMetadata, selectPoseScaleDiversity } from '@/lib/route/globalSearchAllPoseSeeds';
import { DistanceField, toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { rolloutPoseSeeds, shapeGuidedPortRolloutProductStages, SHAPE_GUIDED_ROLLOUT_PARAMS } from '@/lib/route/shapeGuidedPortRolloutProductStages';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { rolloutPathAuditor, rolloutStartPorts, selectRolloutPoses } from './rollout-pilot-support';

it.skipIf(!process.env.SHAPE_GUIDED_SCALE_DIVERSITY)('compares legacy top48 placement selection and original full-catalog scale diversity with identical feedback search caps', () => {
  const area = process.env.ROLLOUT_AREA ?? 'gwangalli';
  expect(['gwangalli', 'seomyeon', 'gangnam']).toContain(area);
  const out = path.resolve('eval/recognition/route-improvement/shape-guided-scale-diversity-20261014', area);
  if (existsSync(out)) throw new Error('Frozen scale-diversity output already exists; preserve it and use a newly versioned harness');
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const inputFile = 'eval/recognition/route-improvement/offline-cascade-20261013/results.json';
  const roadFile = `eval/recognition/llm-routes-20261010/${area}-roads.json`;
  const inputBytes = readFileSync(inputFile), roadBytes = readFileSync(roadFile);
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; raw: number; sourceHash: string }> };
  const rows = input.cases.filter(row => row.caseId.startsWith(`${area}-`));
  expect(rows).toHaveLength(4); expect(new Set(rows.map(row => row.candidate.shapeId))).toEqual(new Set(['square', 'heart', 'star', 'cat']));
  const fixedBoxes: Record<string, BBox> = {
    gwangalli: { south: 35.143, west: 129.100, north: 35.166, east: 129.128 },
    seomyeon: { south: 35.145, west: 129.048, north: 35.170, east: 129.076 },
    gangnam: { south: 37.490, west: 127.020, north: 37.515, east: 127.051 },
  };
  expect(new Set(rows.map(row => row.caseId))).toEqual(new Set(['square', 'heart', 'star', 'cat'].map(shapeId => `${area}-${shapeId}`)));
  for (const row of rows) expect(row.bbox).toEqual(fixedBoxes[area]);
  expect(rows.every(row => row.sourceHash === hash(roadBytes))).toBe(true);
  const files = [
    'tests/eval/shape-guided-scale-diversity-20261014.test.ts', 'tests/eval/rollout-pilot-support.ts',
    'src/lib/route/globalSearch.ts', 'src/lib/route/globalSearchAllPoseSeeds.ts', 'tests/eval/create-all-pose-seeds.mjs',
    'src/lib/route/exactRoadPortGraph.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts',
    'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/refinePlacement.ts',
    'src/lib/route/loops.ts', 'src/lib/route/flex.ts', 'src/lib/art/rdp.ts', 'src/lib/route/budget.ts',
    'src/lib/route/shapeGuidedPortRolloutProductStages.ts', 'src/lib/route/shapeGuidedPortRolloutProductBound.ts',
    'src/lib/route/guideProductClosureBound.ts', 'src/lib/route/continuousEdgePhase.ts',
    'src/lib/route/continuousGuideDistance.ts', 'src/lib/route/segmentRadiusInterval.ts',
    'tests/eval/create-product-stage-rollout.mjs', 'tests/eval/create-product-bound-rollout.mjs',
  ];
  const originalBody = readFileSync('src/lib/route/globalSearch.ts', 'utf8'), fullBody = readFileSync('src/lib/route/globalSearchAllPoseSeeds.ts', 'utf8');
  expect(fullBody.slice(0, fullBody.indexOf('\n/* ALL_POSE_SCALE_DIVERSITY_HELPER */\n'))
    .replace('export function globalSearchAllPoseSeeds(', 'export function globalSearch(')
    .replace('placementSeeds:seeds.map(s=>s.p)', 'placementSeeds:seeds.slice(0,48).map(s=>s.p)')).toBe(originalBody);
  mkdirSync(out, { recursive: true });
  const codeHashes = Object.fromEntries(files.map(file => {
    const bytes = readFileSync(file); writeFileSync(path.join(out, `${path.basename(file)}.source`), bytes); return [file, hash(bytes)];
  }));
  const protocol = {
    area, denominator: 4, originalScore: true, originalTemplate: true, graphDetail: 'simple', excludeSteps: true,
    originalROI: rows[0].bbox, minMeters: 3000, maxMeters: 8000, repeatMax: .2,
    placementPolicies: [
      { name: 'legacy-top48', catalog: 'original-globalSearch-top48', selection: 'selectRolloutPoses', limit: 8 },
      { name: 'full-scale-diversity', catalog: 'original-coarse-bucket-all-ranked', selection: ALL_POSE_SELECTION_PARAMS, limit: 8 },
    ],
    commonExecutionOrder: 'existing-rolloutPoseSeeds applied to each selected eight without changing membership',
    feedback: true, feedbackControlArm: false, params: SHAPE_GUIDED_ROLLOUT_PARAMS,
    inputHash: hash(inputBytes), roadHash: hash(roadBytes), codeHashes,
    coarseAttemptCount: 0, fullRotation: true, originalTop48MustEqualFullFirst48: true,
    selectedPosesMustBeOriginalCatalogMembers: true, originalDistanceFieldSharedReadonlyWithinCase: true,
    storedAutomaticIncumbentComparisonOnly: true, storedRouteGenerationSeeds: false,
    fromRoadsWholeCascadeRerun: false, holdoutRead: false, baselineRefitPerRepresentation: 128,
    baselineRepresentations: 2, armRefitTop: 8, armRefitPerCanonicalCandidate: 128,
    unusedUnitBudgetRedistributed: false, actualWorkEqualAcrossArms: false,
    preprocessingAndRefitOutsideExpansionBudget: true, noSemanticOrHumanRecognitionClaim: true,
    nativeCSRLengthAndRepeatedUndirectedEdgeLengthAuditedIndependently: true,
  };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const graphStart = Date.now(), g = graphFromOverpass(JSON.parse(roadBytes.toString()), rows[0].bbox, { detail: 'simple', excludeSteps: true });
  const [minX, minY] = project(g.origin, rows[0].bbox.south, rows[0].bbox.west), [maxX, maxY] = project(g.origin, rows[0].bbox.north, rows[0].bbox.east), region = { minX, minY, maxX, maxY };
  const pg = exactRoadPortGraph(g, region), graphMs = Date.now() - graphStart;
  const poseKey = (p: Placement) => [p.cx, p.cy, p.scale, p.rotDeg].join(':');
  const nativeAudit = (nodes: number[]) => {
    let nativeLengthMeters = 0, nativeRepeatedMeters = 0;
    const seenEdges = new Set<string>();
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i]; let meters: number | undefined;
      for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) { meters = g.adjLen[e]; break; }
      if (meters === undefined || !Number.isFinite(meters) || meters <= 0) throw new Error('Native CSR edge absent or invalid');
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      nativeLengthMeters += meters; if (seenEdges.has(key)) nativeRepeatedMeters += meters; seenEdges.add(key);
    }
    const nativeRepeatRatio = nativeRepeatedMeters / nativeLengthMeters;
    if (nativeLengthMeters < 3000 || nativeLengthMeters > 8000 || nativeRepeatRatio > .2) throw new Error('Independent native CSR length or repetition gate failed');
    return { nativeLengthMeters, nativeRepeatedMeters, nativeRepeatRatio };
  };
  type Scored = { candidate: RouteCandidate; raw: number; nodes: number[]; placement: Placement; native: ReturnType<typeof nativeAudit> };
  const cases: Array<{
    originalBefore: number; beforeFairRefit: number;
    arms: Array<{
      after: number; afterRaw: number; improvement: boolean; directRolloutQCalls: number;
      searchMs: number; productSetupMs: number; reverseBoundSetupMs: number; refitMs: number; refitEvaluations: number;
      diagnostics: { expansions: number };
    }>;
  }> = [];
  for (const row of rows) {
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], auditor = rolloutPathAuditor(g, shape, region);
    writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ caseId: row.caseId, stage: 'freeze-coarse-policy-selections' }));
    const fieldStart = Date.now(), field = new DistanceField(g, region, 12), fieldMs = Date.now() - fieldStart;
    const legacyCoarseStart = Date.now(), legacyCoarse = globalSearch(g, shape, region, 0, true, true, { distanceField: field }), legacyCoarseMs = Date.now() - legacyCoarseStart;
    const fullCoarseStart = Date.now(), fullCoarse = globalSearchAllPoseSeeds(g, shape, region, 0, true, true, { distanceField: field }), fullCoarseMs = Date.now() - fullCoarseStart;
    expect(legacyCoarse.evaluated).toBe(0); expect(fullCoarse.evaluated).toBe(0);
    expect(legacyCoarse.pool).toEqual([]); expect(fullCoarse.pool).toEqual([]);
    expect(legacyCoarse.placementSeeds).toEqual(fullCoarse.placementSeeds.slice(0, 48));
    expect(legacyCoarse.coarseSeeds).toBe(fullCoarse.coarseSeeds); expect(fullCoarse.placementSeeds).toHaveLength(fullCoarse.coarseSeeds);
    const metadata = poseScaleDiversityMetadata(fullCoarse.placementSeeds, region, shape);
    const selections = [
      { name: 'legacy-top48', policyPoses: selectRolloutPoses(legacyCoarse.placementSeeds, region), selectionParams: { catalogLimit: 48, scaleTiers: 0 } },
      { name: 'full-scale-diversity', policyPoses: selectPoseScaleDiversity(fullCoarse.placementSeeds, region, shape, 8), selectionParams: ALL_POSE_SELECTION_PARAMS },
    ].map(selection => {
      expect(selection.policyPoses).toHaveLength(8);
      const poses = rolloutPoseSeeds(selection.policyPoses, region);
      expect(poses).toHaveLength(8); expect(new Set(poses.map(poseKey))).toEqual(new Set(selection.policyPoses.map(poseKey)));
      const selectedMetadata = poses.map(p => {
        const entry = metadata.entries.find(e => poseKey(e.pose) === poseKey(p)); expect(entry).toBeDefined();
        return { ...entry!, starts: rolloutStartPorts(g, pg.ports, shape, p), idealGuideMeters: p.scale * shape.perimeter };
      });
      if (selection.name === 'full-scale-diversity') {
        for (const pose of selection.policyPoses) expect(fullCoarse.placementSeeds.includes(pose)).toBe(true);
        expect(new Set(selection.policyPoses.slice(0, 4).map(p => metadata.entries.find(e => e.pose === p)!.scaleTier))).toEqual(new Set([0, 1, 2, 3]));
      }
      return { ...selection, poses, selectedMetadata, distinctScales: new Set(poses.map(p => p.scale)).size, distinctOutlineOrbits: new Set(selectedMetadata.map(e => e.outlineOrbit)).size };
    });
    // Lock both automatic selections before inspecting or refitting the saved incumbent.
    writeFileSync(path.join(out, `${row.caseId}-selection-before-quality.json`), JSON.stringify({ coarseSeeds: fullCoarse.coarseSeeds, scaleValues: metadata.scaleValues, symmetryDegrees: metadata.symmetryDegrees, selections, fullCatalogMetadata: metadata }, null, 2));
    const originalNodes = auditor.nodesFor(row.candidate), original = auditor.audit(originalNodes, row.candidate.placement), originalNative = nativeAudit(originalNodes);
    expect(original.raw).toBeCloseTo(row.raw, 8); expect(original.evaluated.similarity).toBe(row.candidate.similarity);
    const originalKey = pairEdgeKey(originalNodes);
    const scored = (nodes: number[], placement: Placement): Scored => { const a = auditor.audit(nodes, placement); return { candidate: toCandidate(g, shape, placement, a.evaluated), raw: a.raw, nodes, placement, native: nativeAudit(nodes) }; };
    const canonical = pairPhaseZero(g, shape, row.candidate.placement, originalNodes);
    const baselineStart = Date.now(), baselinePool = [scored(originalNodes, row.candidate.placement), scored(canonical, row.candidate.placement)];
    let baselineRefitEvaluations = 0;
    for (const nodes of [originalNodes, canonical]) {
      const fit = refinePathPlacement(g, shape, row.candidate.placement, nodes, region, 3000, 8000, 128);
      if (!fit) continue; baselineRefitEvaluations += fit.evaluations;
      baselinePool.push(scored(fit.evaluated.path, fit.placement));
      baselinePool.push(scored(pairPhaseZero(g, shape, fit.placement, fit.evaluated.path), fit.placement));
    }
    baselinePool.sort((a, b) => b.raw - a.raw); const baseline = baselinePool[0], baselineRefitMs = Date.now() - baselineStart;
    const arms = [];
    for (const selection of selections) {
      const { name, poses } = selection, expectedStarts = selection.selectedMetadata.map(e => e.starts);
      writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ caseId: row.caseId, stage: name }));
      const began = Date.now(), result = shapeGuidedPortRolloutProductStages(g, pg, shape, region, poses, true), searchMs = Date.now() - began;
      expect(result.selectedPoses).toEqual(poses);
      expect(result.diagnostics.expansions).toBeLessThanOrEqual(400000); expect(result.diagnostics.rolloutQCalls).toBeLessThanOrEqual(512);
      expect(result.diagnostics.maxCallCapOvershoot).toBeLessThanOrEqual(3);
      for (const unit of result.diagnostics.units) {
        expect(unit.expansions).toBeLessThanOrEqual(25000);
        if (unit.noStart) continue;
        expect(unit.start).toBe(expectedStarts[unit.poseId][unit.startId]);
        expect(unit.maxCallCapOvershoot).toBeLessThanOrEqual(3); expect(unit.searchCalls).toBeDefined(); expect(unit.stages).toBeDefined();
        for (const call of unit.searchCalls ?? []) expect(call.expanded).toBeLessThanOrEqual(call.effectiveCap + 3);
        for (const stage of unit.stages ?? []) expect(stage.feedbackOutsideControlSelected).toBeLessThanOrEqual(stage.selectedSetDifference.selectedOnlyHashes.length);
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
      const productSetupMs = result.diagnostics.productPoses.reduce((s, p) => s + p.setupMs, 0);
      const reverseBoundSetupMs = result.diagnostics.units.reduce((s, unit) => s + (unit.closureBound?.boundSetupMs ?? 0), 0);
      const arm = {
        name, feedback: true, selection, searchParams: result.params, searchMs, productSetupMs, reverseBoundSetupMs,
        searchExcludingProductAndReverseSetupMs: searchMs - productSetupMs - reverseBoundSetupMs,
        refitMs, refitEvaluations, refitFinalAuditCalls, directRolloutQCalls: result.diagnostics.rolloutQCalls,
        totalSearchAndRefitQCalls: result.diagnostics.rolloutQCalls + refitEvaluations + refitFinalAuditCalls,
        diagnostics: result.diagnostics, pool: result.pool, bestGeometry, improvement,
        after: accepted.candidate.similarity, afterRaw: accepted.raw, acceptedCandidate: accepted.candidate, acceptedNative: accepted.native,
      };
      arms.push(arm); writeFileSync(path.join(out, `${row.caseId}-${name}.json`), JSON.stringify(arm, null, 2));
    }
    const record = {
      caseId: row.caseId, originalBefore: row.candidate.similarity, originalRaw: original.raw, originalNative,
      beforeFairRefit: baseline.candidate.similarity, beforeFairRaw: baseline.raw, baselineRefitEvaluations, baselineRefitMs,
      fieldMs, legacyCoarseMs, fullCoarseMs, coarseSeeds: fullCoarse.coarseSeeds, scaleValues: metadata.scaleValues,
      selectedPolicyMetadata: selections, arms,
    };
    cases.push(record); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(record, null, 2));
  }
  for (const file of files) expect(hash(readFileSync(file))).toBe(codeHashes[file]);
  expect(hash(readFileSync(inputFile))).toBe(protocol.inputHash); expect(hash(readFileSync(roadFile))).toBe(protocol.roadHash);
  expect(cases).toHaveLength(4);
  const summary = {
    denominator: 4, graphMs, originalAverage: cases.reduce((s, c) => s + c.originalBefore, 0) / 4,
    fairBaselineAverage: cases.reduce((s, c) => s + c.beforeFairRefit, 0) / 4,
    arms: [0, 1].map(i => ({
      name: i ? 'full-scale-diversity' : 'legacy-top48',
      average: cases.reduce((s, c) => s + c.arms[i].after, 0) / 4,
      rawAverage: cases.reduce((s, c) => s + c.arms[i].afterRaw, 0) / 4,
      improvements: cases.filter(c => c.arms[i].improvement).length,
      rolloutQCalls: cases.reduce((s, c) => s + c.arms[i].directRolloutQCalls, 0),
      expansions: cases.reduce((s, c) => s + c.arms[i].diagnostics.expansions, 0),
      searchMs: cases.reduce((s, c) => s + c.arms[i].searchMs, 0),
      productSetupMs: cases.reduce((s, c) => s + c.arms[i].productSetupMs, 0),
      reverseBoundSetupMs: cases.reduce((s, c) => s + c.arms[i].reverseBoundSetupMs, 0),
      refitMs: cases.reduce((s, c) => s + c.arms[i].refitMs, 0),
      refitEvaluations: cases.reduce((s, c) => s + c.arms[i].refitEvaluations, 0),
    })),
    sourceAndInputByteIdentityVerified: true, fullCatalogFirst48IdenticalToOriginal: true,
    originalCatalogMembershipVerified: true, allCandidatesNativeAudited: true,
    twelveConditionGoalVerified: false, newRegionValidationPerformed: false,
  };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2));
  writeFileSync(path.join(out, 'complete.json'), JSON.stringify({ assertionsPassed: true, resultsHash: hash(readFileSync(path.join(out, 'results.json'))), protocolHash: hash(readFileSync(path.join(out, 'protocol-before-run.json'))), denominator: 4, completedAt: new Date().toISOString(), holdoutRead: false }, null, 2));
  console.log(JSON.stringify(summary));
}, 1800000);
