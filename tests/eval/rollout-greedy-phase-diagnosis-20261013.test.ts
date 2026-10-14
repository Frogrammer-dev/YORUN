import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { shapeGuidedPortRolloutScheduled } from '@/lib/route/shapeGuidedPortRolloutScheduled';
import { shapeGuidedPortRolloutPhaseDiagnostic, type PhaseGreedyObservation } from '@/lib/route/shapeGuidedPortRolloutPhaseDiagnostic';
import { project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import type { Placement } from '@/lib/route/fit';

it.skipIf(!process.env.ROLLOUT_PHASE_DIAG)('observes mandatory greedy phase loss without changing frozen actual search', () => {
  const caseId = process.env.ROLLOUT_PHASE_CASE ?? 'gwangalli-cat', knownPose = process.env.ROLLOUT_PHASE_KNOWN_POSE === '1'; expect(['gwangalli-cat', 'gwangalli-square']).toContain(caseId);
  const [areaId, shapeId] = caseId.split('-'), mode = knownPose ? 'known-pose-positive-control' : 'automatic-pose-replay', root = `eval/recognition/route-improvement/shape-guided-rollout-scheduled-20261013/${areaId}`, out = path.resolve('eval/recognition/route-improvement/rollout-greedy-phase-diagnosis-20261013', caseId, mode); mkdirSync(out, { recursive: true });
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex'), source = readFileSync('src/lib/route/shapeGuidedPortRolloutScheduled.ts'), frozen = JSON.parse(readFileSync(`${root}/protocol-before-run.json`, 'utf8'));
  expect(sha(source)).toBe(frozen.codeHashes['src/lib/route/shapeGuidedPortRolloutScheduled.ts']);
  const clone = readFileSync('src/lib/route/shapeGuidedPortRolloutPhaseDiagnostic.ts', 'utf8'), restored = clone.slice(0, clone.indexOf('\nexport interface PhaseGreedyObservation')).replace(/\/\* PHASEOBS_START \*\/[\s\S]*?\/\* PHASEOBS_END \*\//g, '').replace('export function shapeGuidedPortRolloutPhaseDiagnostic(', 'export function shapeGuidedPortRolloutScheduled(').replace('poses: Placement[], feedback: boolean, observer: (trace: PhaseGreedyObservation) => void)', 'poses: Placement[], feedback: boolean)');
  expect(restored).toBe(source.toString());
  const originalInput = JSON.parse(readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8')) as { cases: Array<{ caseId: string; bbox: BBox; sourceHash: string; candidate: { placement: Placement } }> }, row = originalInput.cases.find(c => c.caseId === caseId)!;
  const poseBytes = readFileSync(`${root}/${caseId}.json`), automatic = JSON.parse(poseBytes.toString()) as { selectedPoses: Placement[] }, poses = knownPose ? [row.candidate.placement] : automatic.selectedPoses;
  const roads = readFileSync(`eval/recognition/llm-routes-20261010/${areaId}-roads.json`); expect(sha(roads)).toBe(row.sourceHash);
  const files = ['src/lib/route/shapeGuidedPortRolloutScheduled.ts', 'src/lib/route/shapeGuidedPortRolloutPhaseDiagnostic.ts', 'tests/eval/create-greedy-phase-observer.mjs', 'tests/eval/rollout-greedy-phase-diagnosis-20261013.test.ts', 'src/lib/route/exactRoadPortGraph.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts'];
  const hashes = Object.fromEntries(files.map(f => { const b = readFileSync(f); writeFileSync(path.join(out, `${path.basename(f)}.source`), b); return [f, sha(b)]; }));
  const protocol = { caseId, mode, hashes, bodyIdentity: true, observationOnly: true, knownAutomaticPoseDiagnosticOnly: knownPose, manualQualityGainClaim: false, positiveControlIsNotAutomaticSeedPolicy: true, automaticPoseSourceHash: sha(poseBytes), roadHash: sha(roads), holdoutRead: false, scheduleUnchanged: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const g = graphFromOverpass(JSON.parse(roads.toString()), row.bbox, { detail: 'simple', excludeSteps: true }), [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY }, pg = exactRoadPortGraph(g, region), observations: PhaseGreedyObservation[] = [];
  const began = Date.now(), observed = shapeGuidedPortRolloutPhaseDiagnostic(g, pg, SHAPE_BY_ID[shapeId as ShapeId], region, poses, false, o => observations.push(o));
  if (knownPose) { const original = shapeGuidedPortRolloutScheduled(g, pg, SHAPE_BY_ID[shapeId as ShapeId], region, poses, false); expect(observed).toEqual(original); }
  else { const prior = JSON.parse(readFileSync(`${root}/${caseId}-control.json`, 'utf8')); expect(observed.pool).toEqual(prior.pool); expect(observed.diagnostics).toEqual(prior.diagnostics); }
  for (const f of files) expect(sha(readFileSync(f))).toBe(hashes[f]);
  const summary = { units: observations.length, guideCount: observations[0]?.guideCount, expansions: observed.diagnostics.expansions, strictRollouts: observed.diagnostics.strictRollouts, rolloutQCalls: observed.diagnostics.rolloutQCalls, advanceCalls: observations.reduce((s, o) => s + o.advanceCalls, 0), multiPhaseCalls: observations.reduce((s, o) => s + o.multiPhaseCalls, 0), maxAdvanceRun: Math.max(0, ...observations.map(o => o.maxAdvanceRun)), segmentRejectedAfterGreedy: observations.reduce((s, o) => s + o.segmentRejectedAfterGreedy, 0), earlierPhasePassWitnesses: observations.reduce((s, o) => s + o.earlierPhasePassWitnesses, 0), exactOriginalResult: true, localWitnessIsNotWholeQualityProof: true, elapsedMs: Date.now() - began };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, observations, diagnostics: observed.diagnostics }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
