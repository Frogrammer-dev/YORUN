import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { completeBoundaryOutline } from '@/lib/route/boundaryCompletion';
import { checkDistinctiveConstraints, type DistinctiveDefinition, type FeatureTriplet } from '@/lib/route/distinctiveFeatures';
import { evaluatePath, placeShape, type Placement, type Region } from '@/lib/route/fit';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { project, type RoadGraph } from '@/lib/route/graph';
import { auditObjectPath } from '@/lib/route/objectProposals';
import type { ShapeDef } from '@/lib/route/shapes';

type Mode = 'plain' | 'independent';
type Case = { area: string; key: string; kind: string; template: ShapeDef; definition: DistinctiveDefinition; poses: { sourceId: string; pose: Placement }[] };
type Snapshot = { area: string; sourceFile: string; roadHash: string; bbox: BBox };
type Row = { id: string; area: string; proposalShape: string; proposalCategory: string; proposalPoolRank: number;
  roadHash: string; geometryKey: string; path: number[]; xy: [number, number][]; latlon: [number, number][];
  meters: number; projectedMeters: number; repeatRatio: number; projectedRepeatRatio: number;
  generatorSimilarity: number; generatorPlacement: Placement; featureSatisfied: boolean; featureReasons: string[];
  attempt: number; fallbackOf?: string };
type Slot = { area: string; proposalShape: string; category: string; id: string | null; validRoad: boolean; featureSatisfied: boolean; featureInterventionApplied: boolean };
const sha = (x: Buffer | string) => createHash('sha256').update(x).digest('hex');
const folder = 'eval/recognition/road-ranker-20261102';
const protocolFile = 'reports/road-ranker-20261102/protocol-v14.md';

function chainContained(path: number[], chain: readonly number[]): boolean {
  const loop = path.slice(0, -1);
  return chain.length <= loop.length + 1 && loop.some((_, i) => chain.every((v, j) => loop[(i + j) % loop.length] === v));
}

it.skipIf(!process.env.ROAD_BOUNDARY_GENERATION)('compares all75 fixed requests with independent feature-boundary generation', () => {
  const began = performance.now(), prepDeadline = began + 60000;
  const bankFile = `${folder}/boundary-bank-v14.json`, progressFile = `${folder}/boundary-v14.running.json`;
  const files = { plain: `${folder}/boundary-v14-plain.json`, independent: `${folder}/boundary-v14-independent.json` };
  const reportFile = 'reports/road-ranker-20261102/v14-generation.json';
  for (const file of [progressFile, ...Object.values(files), reportFile]) expect(existsSync(file), `Preserve ${file}`).toBe(false);
  const bytes = readFileSync(bankFile), bank = JSON.parse(bytes.toString()) as { input: string; inputSHA256: string; definitionsSHA256: string; cases: Case[]; sourceSnapshots: Snapshot[] };
  expect(sha(readFileSync(bank.input))).toBe(bank.inputSHA256);
  expect(sha(readFileSync('src/lib/route/distinctiveFeatures.ts'))).toBe(bank.definitionsSHA256);
  expect(bank.cases).toHaveLength(75); expect(bank.sourceSnapshots).toHaveLength(3);
  const casesHash = sha(JSON.stringify(bank.cases));
  const provenance = { protocolFile, protocolSHA256: sha(readFileSync(protocolFile)), bankFile, bankSHA256: sha(bytes), casesSHA256: casesHash,
    sourceSnapshots: bank.sourceSnapshots, codeSHA256: sha(readFileSync('tests/eval/boundary-generation-20261102.test.ts')),
    coreSHA256: Object.fromEntries(['boundaryRouting.ts', 'boundaryCompletion.ts', 'distinctiveFeatures.ts', 'fit.ts', 'objectProposals.ts', 'osm.ts', 'graph.ts']
      .map(file => [file, sha(readFileSync(`src/lib/route/${file}`))])),
    requests: 75, maxAttempts: 60, routeMaxExpanded: 12000, requestMaxExpanded: 2000000, requestMs: 15000, sharedPreprocessingMs: 60000,
    humanRecognitionMeasured: false, independentHoldout: false, holdoutV2Read: false, original12BenchmarkRead: false,
    learnedModelUsed: false, canonicalDisplay: true, originalScoringUnchanged: true };
  const methods = Object.fromEntries((['plain', 'independent'] as const).map(mode => [mode, {
    results: [] as Row[], reviewSlots: [] as Slot[], counts: [] as Record<string, unknown>[],
  }])) as Record<Mode, { results: Row[]; reviewSlots: Slot[]; counts: Record<string, unknown>[] }>;
  const save = (status: string) => writeFileSync(progressFile, JSON.stringify({ status, methods, provenance, elapsedSeconds: (performance.now() - began) / 1000 }));
  save('preparing');
  const graphs = new Map<string, { g: RoadGraph; region: Region }>(), graphErrors = new Map<string, string>();
  for (const snap of bank.sourceSnapshots) {
    try {
      if (performance.now() >= prepDeadline) throw new Error('preprocessing_budget');
      const raw = readFileSync(snap.sourceFile); if (sha(raw) !== snap.roadHash) throw new Error('snapshot_hash_mismatch');
      const g = graphFromOverpass(JSON.parse(raw.toString()), snap.bbox, { detail: 'simple', excludeSteps: true });
      if (performance.now() >= prepDeadline) throw new Error('preprocessing_budget_after_graph');
      const [minX, minY] = project(g.origin, snap.bbox.south, snap.bbox.west), [maxX, maxY] = project(g.origin, snap.bbox.north, snap.bbox.east);
      graphs.set(snap.area, { g, region: { minX, minY, maxX, maxY } });
    } catch (error) { graphErrors.set(snap.area, String(error)); }
  }
  const prepared = bank.cases.map(c => {
    const state = graphs.get(c.area);
    const poses: { pose: Placement; outline: [number, number][]; pins: number[]; error: string | null }[] = [];
    for (const source of c.poses) {
      const outline = placeShape(c.template.points, source.pose).slice(0, -1);
      let error = graphErrors.get(c.area) ?? null;
      if (!state) error ??= 'missing_graph';
      if (performance.now() >= prepDeadline) error = 'preprocessing_budget';
      const pins = error ? [] : outline.map(([x, y]) => state!.g.nodeIndex.nearest(x, y, source.pose.scale * .12));
      if (pins.some(v => v < 0)) error = 'missing_anchor';
      if (performance.now() >= prepDeadline) error = 'preprocessing_budget_after_anchors';
      poses.push({ pose: source.pose, outline, pins, error });
    }
    return poses;
  });
  const preprocessingMs = performance.now() - began;
  save('generating');
  for (let ci = 0; ci < bank.cases.length; ci++) {
    const c = bank.cases[ci], state = graphs.get(c.area), snap = bank.sourceSnapshots.find(s => s.area === c.area)!;
    for (const mode of ['plain', 'independent'] as const) {
      const started = performance.now(), budget = { expanded: 0, maxExpanded: 2000000, deadlineMs: started + 15000 };
      const target = methods[mode], failures: Record<string, number> = {};
      const fail = (reason: string) => { failures[reason] = (failures[reason] ?? 0) + 1; };
      let attempted = 0, calls = 0, validCandidates = 0, completedCandidates = 0, expired = false, routingMs = 0, auditMs = 0, evaluationMs = 0;
      const pool: Row[] = [];
      const fallback = mode === 'independent' && !c.definition.supported;
      if (fallback) {
        for (const row of methods.plain.results.filter(r => r.area === c.area && r.proposalShape === c.key)) {
          pool.push({ ...row, id: row.id.replace('-plain-', '-fallback-'), path: row.path.slice(), fallbackOf: row.id });
        }
        validCandidates = pool.length;
      } else for (const [pi, preparedPose] of prepared[ci].entries()) {
        if (pi >= 60) break;
        if (performance.now() >= budget.deadlineMs || budget.expanded >= budget.maxExpanded) { expired = true; fail('request_budget'); break; }
        attempted++;
        if (preparedPose.error || !state) { fail(preparedPose.error ?? 'missing_graph'); continue; }
        const { g, region } = state, { pose, outline, pins } = preparedPose;
        const features = c.definition.supported ? c.definition.features : [];
        const routingBegan = performance.now();
        const completed = completeBoundaryOutline(g, outline, pins, features, { mode, region, maxExpandedPerCall: 12000,
          guideTolerance: Math.max(15, pose.scale * .06), guideWeight: 1.5 }, budget);
        routingMs += performance.now() - routingBegan; calls += completed.calls;
        if (!completed.path) { fail(completed.reason); continue; }
        completedCandidates++;
        const auditBegan = performance.now(), audit = auditObjectPath(g, region, completed.path);
        auditMs += performance.now() - auditBegan;
        if (!audit.valid) { fail(`road:${audit.reason}`); continue; }
        const triples: FeatureTriplet[] = features.map(f => f.triple.map(i => [g.x[pins[i]], g.y[pins[i]]]) as unknown as FeatureTriplet);
        const check = checkDistinctiveConstraints(c.definition, triples, { origin: [pose.cx, pose.cy], extent: pose.scale * (c.definition.supported ? c.definition.templateExtent : 1), rotationDeg: pose.rotDeg }, completed.chains);
        const chainsPresent = completed.chains.every(pair => chainContained(completed.path!, [...pair.entryToTip, ...pair.tipToExit.slice(1)]));
        if (!chainsPresent) { fail('feature_chain_not_preserved'); continue; }
        if (mode === 'independent' && !check.ok) { check.reasons.forEach(reason => fail(`feature:${reason}`)); continue; }
        const evaluationBegan = performance.now(), evaluated = evaluatePath(g, c.template, pose, completed.path, 3000, 8000);
        evaluationMs += performance.now() - evaluationBegan;
        if (!Number.isFinite(evaluated.similarity)) { fail('nonfinite_original_score'); continue; }
        if (performance.now() >= budget.deadlineMs) { expired = true; fail('request_budget_after_audit'); break; }
        validCandidates++;
        const path = completed.path;
        pool.push({ id: `${c.area}-v14-${mode}-${c.key}-${String(pi + 1).padStart(2, '0')}`, area: c.area, proposalShape: c.key,
          proposalCategory: c.kind, proposalPoolRank: 0, roadHash: snap.roadHash, geometryKey: JSON.stringify([c.area, snap.roadHash, audit.edgeKey]),
          path, xy: path.map(v => [g.x[v], g.y[v]]), latlon: path.map(v => [g.lat[v], g.lon[v]]),
          meters: audit.meters, projectedMeters: audit.projectedMeters, repeatRatio: audit.repeatRatio, projectedRepeatRatio: audit.projectedRepeatRatio,
          generatorSimilarity: evaluated.similarity, generatorPlacement: { ...pose }, featureSatisfied: check.ok, featureReasons: check.reasons, attempt: pi + 1 });
      }
      pool.sort((a, b) => b.generatorSimilarity - a.generatorSimilarity || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      const retained: Row[] = [], seen = new Set<string>();
      for (const row of pool) if (!seen.has(row.geometryKey)) { seen.add(row.geometryKey); retained.push({ ...row, proposalPoolRank: retained.length + 1 }); if (retained.length === 8) break; }
      expired ||= !fallback && performance.now() >= budget.deadlineMs;
      target.results.push(...retained);
      target.reviewSlots.push({ area: c.area, proposalShape: c.key, category: c.kind, id: retained[0]?.id ?? null, validRoad: retained.length > 0,
        featureSatisfied: retained[0]?.featureSatisfied ?? false, featureInterventionApplied: mode === 'independent' && !fallback });
      target.counts.push({ area: c.area, proposalShape: c.key, plannedPlacements: prepared[ci].length, attempted, calls, expanded: budget.expanded,
        completedCandidates, validCandidates, validRoadOutputs: retained.length, retained: retained.length, validCandidatesBeforeDedup: validCandidates,
        failures, budgetExhausted: expired || budget.expanded >= budget.maxExpanded, partial: expired || budget.expanded >= budget.maxExpanded,
        fallback, fallbackMethod: fallback ? 'plain' : null, featureDefinitionSupported: c.definition.supported,
        preprocessingShared: true, routingMs, auditMs, evaluationMs, elapsedMs: performance.now() - started,
        overrunMs: Math.max(0, performance.now() - budget.deadlineMs) });
      process.stdout.write(`[v14] ${ci + 1}/75 ${mode} ${c.area} ${c.key} valid=${retained.length} expanded=${budget.expanded} fallback=${fallback}\n`);
      save('generating');
    }
  }
  expect(sha(JSON.stringify(bank.cases))).toBe(casesHash);
  const summary: Record<string, unknown> = {};
  for (const mode of ['plain', 'independent'] as const) {
    const data = methods[mode]; expect(data.reviewSlots).toHaveLength(75); expect(data.counts).toHaveLength(75);
    for (const row of data.results) {
      const { g, region } = graphs.get(row.area)!; const audit = auditObjectPath(g, region, row.path); expect(audit.valid).toBe(true);
      expect(row.xy).toEqual(row.path.map(v => [g.x[v], g.y[v]])); expect(row.latlon).toEqual(row.path.map(v => [g.lat[v], g.lon[v]]));
    }
    const final = { status: 'complete', ...data, provenance: { ...provenance, mode }, preprocessingMs, humanRecognitionMeasured: false, elapsedSeconds: (performance.now() - began) / 1000 };
    const temporary = files[mode] + '.running'; expect(existsSync(temporary)).toBe(false); writeFileSync(temporary, JSON.stringify(final), { flag: 'wx' }); renameSync(temporary, files[mode]);
    summary[mode] = { requests: 75, validRequests: data.reviewSlots.filter(s => s.id).length,
      animalFeatureSatisfied: data.reviewSlots.filter(s => s.category === 'animal' && s.featureSatisfied).length,
      fallbackRequests: data.counts.filter(c => c.fallback).length, outputSHA256: sha(readFileSync(files[mode])), counts: data.counts };
  }
  writeFileSync(reportFile, JSON.stringify({ summary, provenance, preprocessingMs, humanRecognitionMeasured: false, newAIReviewsComplete: false }, null, 2), { flag: 'wx' });
  save('complete');
}, 2400000);
