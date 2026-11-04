import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { hasEdge, project, type RoadGraph } from '@/lib/route/graph';
import { evaluatePath, placeShape, type Placement, type Region } from '@/lib/route/fit';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { relationDiagnostics, relationGuidedSearch, relationOriginalObjective } from '@/lib/route/relationGuidedSearch';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { normalizeRoadReferenceRenderLine } from '@/lib/art/roadReference';

const source = 'eval/recognition/relation-generation-20261021/trial-v1/results.json';
const out = 'eval/recognition/relation-generation-20261021/cascade-v1';
const roads = 'eval/recognition/route-improvement/holdout';
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
interface TrialCase {
  id: string; area: string; bbox: BBox; roadHash: string; shapeId: ShapeId; family: string;
  baseline: { path: number[]; placement: Placement; rawSimilarity: number };
}
function audit(g: RoadGraph, region: Region, nodes: number[]) {
  let native = 0, projected = 0, repeated = 0, projectedRepeated = 0;
  const seen = new Set<string>();
  let valid = nodes.length >= 4 && nodes[0] === nodes.at(-1);
  for (let i = 0; i < nodes.length; i++) {
    const v = nodes[i];
    if (!Number.isInteger(v) || v < 0 || v >= g.n || g.x[v] < region.minX || g.x[v] > region.maxX || g.y[v] < region.minY || g.y[v] > region.maxY) { valid = false; break; }
    if (!i) continue;
    const a = nodes[i - 1];
    if (!hasEdge(g, a, v)) { valid = false; break; }
    let d = NaN;
    for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === v) { d = g.adjLen[k]; break; }
    if (!Number.isFinite(d) || d < 0) { valid = false; break; }
    const p = Math.hypot(g.x[v] - g.x[a], g.y[v] - g.y[a]), key = a < v ? `${a}:${v}` : `${v}:${a}`;
    native += d; projected += p;
    if (seen.has(key)) { repeated += d; projectedRepeated += p; }
    seen.add(key);
  }
  const repeatRatio = repeated / native, projectedRepeatRatio = projectedRepeated / projected;
  valid &&= native >= 3000 && native <= 8000 && projected >= 3000 && projected <= 8000 && repeatRatio <= .2 && projectedRepeatRatio <= .2;
  return { valid, nativeMeters: native, projectedMeters: projected, repeatRatio, projectedRepeatRatio, edgeHash: sha([...seen].sort().join(',')) };
}

it.skipIf(process.env.RELATION_CASCADE !== '1')('measures repeated native road repair and uniform-pose optimization on six fixed initial seeds', async () => {
  const bytes = readFileSync(source), trial = JSON.parse(bytes.toString()) as { cases: TrialCase[] };
  expect(trial.cases).toHaveLength(6);
  const sourceFiles = ['tests/eval/relation-cascade-20261021.test.ts', 'src/lib/route/relationGuidedSearch.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/fit.ts', 'src/lib/route/shapes.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/art/roadReference.ts'];
  mkdirSync(`${out}/sources`, { recursive: true });
  const codeHashes = Object.fromEntries(sourceFiles.map(file => {
    const content = readFileSync(file); writeFileSync(`${out}/sources/${file.replaceAll('/', '__')}.source.txt`, content);
    return [file, sha(content)];
  }));
  const spec = { denominator: 6, source, sourceSha256: sha(bytes), modes: ['uniform', 'relation'], rounds: 6, checkpointRounds: [3, 6],
    proposalsPerRound: 64, poseEvaluationsPerRound: 80, maxExpanded: 12000,
    cohort: 'Fixed initial six fresh trial-v1 seeds, not saved best paths. Follow-up development cohort, not independent validation.',
    uniformTransformsOnly: true, originalFitAndShapesUnchanged: true, paidApiCalls: 0, originalTwelveRead: false, holdoutV2Read: false,
    poseOnlyControl: 'Auxiliary six-round pose refinement on unchanged initial path, 80 evaluations per round; not a new road arm.', codeHashes,
    timing: 'Generator and pose-refit calls include their initialization. Geometry audit/render/file I/O excluded; concurrent machine workloads may affect wall times.',
    fixedPoseComparison: '192/384 road proposals plus up to 240/480 additional pose evaluations; not equal total computation to fixed-pose runs.' };
  writeFileSync(`${out}/protocol.json`, JSON.stringify(spec, null, 2));
  type SummaryOutput = { rawSimilarity: number; valid: boolean; edgeChanged: boolean; changeType: string; edgeBetterAtFinalPose: boolean };
  const cases: Array<{ id: string; baseline: { rawSimilarity: number }; poseOnly: Array<{ output: { rawSimilarity: number } }>; arms: Array<{ mode: string; rounds: Array<{ output: SummaryOutput; elapsedMs: number; attempts: number; expanded: number; evaluatedCandidates: number; poseEvaluations: number }> }> }> = [];
  const start = performance.now(), graphs = new Map<string, { g: RoadGraph; region: Region }>();
  for (const item of trial.cases) {
    if (!graphs.has(item.area)) {
      const roadBytes = readFileSync(`${roads}/${item.area}-roads.json`); expect(sha(roadBytes)).toBe(item.roadHash);
      const g = graphFromOverpass(JSON.parse(roadBytes.toString()), item.bbox, { detail: 'simple', excludeSteps: true });
      const [minX, minY] = project(g.origin, item.bbox.south, item.bbox.west), [maxX, maxY] = project(g.origin, item.bbox.north, item.bbox.east);
      graphs.set(item.area, { g, region: { minX, minY, maxX, maxY } });
    }
    const { g, region } = graphs.get(item.area)!, shape = SHAPE_BY_ID[item.shapeId], input = item.baseline.path, initialPlacement = item.baseline.placement;
    const initialQ = relationOriginalObjective(evaluatePath(g, shape, initialPlacement, input, 3000, 8000), initialPlacement);
    const initialCanonicalQ = relationOriginalObjective(evaluatePath(g, shape, initialPlacement, pairPhaseZero(g, shape, initialPlacement, input), 3000, 8000), initialPlacement);
    const inputKey = pairEdgeKey(input);
    const metrics = (path: number[], placement: Placement) => {
      const native = audit(g, region, path), e = evaluatePath(g, shape, placement, path, 3000, 8000), q = relationOriginalObjective(e, placement);
      const templateInside = placeShape(shape.points, placement).every(([x, y]) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY);
      const edgeChanged = pairEdgeKey(path) !== inputKey, poseChanged = ['cx', 'cy', 'scale', 'rotDeg'].some(k => placement[k as keyof Placement] !== initialPlacement[k as keyof Placement]);
      const exactInputPreserved = path.length === input.length && path.every((v, i) => v === input[i]);
      const phaseOnlyArtifact = !edgeChanged && !exactInputPreserved;
      const samePoseInputQ = relationOriginalObjective(evaluatePath(g, shape, placement, input, 3000, 8000), placement);
      const samePoseCanonicalQ = relationOriginalObjective(evaluatePath(g, shape, placement, pairPhaseZero(g, shape, placement, input), 3000, 8000), placement);
      const canonicalQualityPassed = q <= Math.min(initialQ, initialCanonicalQ) + 1e-9;
      const valid = native.valid && templateInside && !phaseOnlyArtifact && q <= initialQ + 1e-9;
      return { ...native, valid, templateInside, edgeChanged, poseChanged, exactInputPreserved, phaseOnlyArtifact, canonicalQualityPassed,
        changeType: edgeChanged ? poseChanged ? 'edge-and-pose' : 'edge-only' : poseChanged ? 'pose-only' : 'unchanged',
        initialObjective: initialQ, initialCanonicalObjective: initialCanonicalQ, objective: q, samePoseInputObjective: samePoseInputQ,
        edgeBetterAtFinalPose: edgeChanged && q < Math.min(samePoseInputQ, samePoseCanonicalQ) - 1e-9,
        rawSimilarity: valid ? 100 * Math.exp(-q) : 0, relation: relationDiagnostics(g, shape, placement, path),
        meanDeviationMeters: e.meanDev, featureCoverage: e.featureCoverage, spikes: e.spikes, zigzagPerKm: e.zigzagPerKm,
        placement, path, latlngs: path.map(v => [g.lat[v], g.lon[v]] as [number, number]) };
    };
    const baseline = metrics(input, initialPlacement); expect(baseline.valid).toBe(true);
    expect(baseline.rawSimilarity).toBeCloseTo(item.baseline.rawSimilarity, 8);
    const poseOnly = []; let controlPose = initialPlacement;
    for (let round = 1; round <= 6; round++) {
      const t = performance.now(), refit = refinePathPlacement(g, shape, controlPose, input, region, 3000, 8000, 80), elapsedMs = performance.now() - t;
      controlPose = refit?.placement ?? controlPose;
      poseOnly.push({ round, elapsedMs, evaluations: refit?.evaluations ?? 0, output: metrics(input, controlPose) });
    }
    const arms = [];
    for (const mode of ['uniform', 'relation'] as const) {
      let nodes = input, placement = initialPlacement, objective = initialQ;
      const rounds = [];
      for (let round = 1; round <= 6; round++) {
        const generationStart = performance.now(), repaired = relationGuidedSearch(g, shape, placement, nodes, region,
          { mode, maxProposals: 64, maxExpanded: 12000, minMeters: 3000, maxMeters: 8000 });
        const generationMs = performance.now() - generationStart; expect(repaired).not.toBeNull();
        let candidatePath = repaired!.evaluated.path;
        // Returning to the original edge geometry restores its exact initial seam.
        if (pairEdgeKey(candidatePath) === inputKey) candidatePath = input;
        const repairQ = relationOriginalObjective(evaluatePath(g, shape, placement, candidatePath, 3000, 8000), placement);
        if (repairQ <= objective + 1e-9) { nodes = candidatePath; objective = repairQ; }
        const refitStart = performance.now(), refit = refinePathPlacement(g, shape, placement, nodes, region, 3000, 8000, 80);
        const refitMs = performance.now() - refitStart;
        if (refit) {
          const candidateQ = relationOriginalObjective(refit.evaluated, refit.placement);
          if (candidateQ < objective - 1e-9) { placement = refit.placement; objective = candidateQ; }
        }
        const output = metrics(nodes, placement); expect(output.valid, `${item.id}/${mode}/${round}`).toBe(true);
        expect(output.objective).toBeLessThanOrEqual(rounds.at(-1)?.output.objective ?? initialQ);
        rounds.push({ round, generationMs, refitMs, elapsedMs: generationMs + refitMs, attempts: repaired!.attempts, expanded: repaired!.expanded,
          evaluatedCandidates: repaired!.evaluatedCandidates, acceptedRepairs: repaired!.acceptedRepairs, poseEvaluations: refit?.evaluations ?? 0, output });
        console.log(JSON.stringify({ id: item.id, mode, round, rawSimilarity: output.rawSimilarity, changeType: output.changeType }));
      }
      arms.push({ mode, rounds });
      writeFileSync(`${out}/${item.id}-progress.json`, JSON.stringify({ id: item.id, shapeId: item.shapeId, baseline, poseOnly, arms }, null, 2));
    }
    const result = { id: item.id, area: item.area, bbox: item.bbox, roadHash: item.roadHash, shapeId: item.shapeId, family: item.family, baseline, poseOnly, arms };
    cases.push(result); writeFileSync(`${out}/${item.id}.json`, JSON.stringify(result, null, 2));
    for (const image of [{ name: 'baseline', output: baseline }, ...arms.map(a => ({ name: a.mode, output: a.rounds[5].output }))]) {
      const line = normalizeRoadReferenceRenderLine({ id: 'raw', latlngs: image.output.latlngs });
      const d = line.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 400).toFixed(3)},${(y * 400).toFixed(3)}`).join(' ');
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round"/></svg>`)).png().toFile(`${out}/${item.id}-${image.name}.png`);
    }
  }
  expect(cases).toHaveLength(6); expect(sha(readFileSync(source))).toBe(spec.sourceSha256);
  for (const [file, hash] of Object.entries(codeHashes)) expect(sha(readFileSync(file))).toBe(hash);
  const summary = [3, 6].flatMap(round => ['uniform', 'relation'].map(mode => {
    const rows = cases.map(c => c.arms.find(a => a.mode === mode)!.rounds.slice(0, round));
    const final = rows.map(r => r.at(-1)!.output);
    return { mode, round, roadProposalCap: round * 64, poseEvaluationCap: round * 80, denominator: 6,
      meanRawSimilarity: final.reduce((s, v) => s + v.rawSimilarity, 0) / 6,
      auxiliaryPoseOnlyMean: cases.reduce((s, c) => s + c.poseOnly[round - 1].output.rawSimilarity, 0) / 6,
      baselineMean: cases.reduce((s, c) => s + c.baseline.rawSimilarity, 0) / 6,
      maxRawSimilarity: Math.max(...final.map(v => v.rawSimilarity)), invalid: final.filter(v => !v.valid).length,
      edgeChanged: final.filter(v => v.edgeChanged).length, poseOnly: final.filter(v => v.changeType === 'pose-only').length,
      edgeBetterAtFinalPose: final.filter(v => v.edgeBetterAtFinalPose).length,
      actualAttempts: rows.flat().reduce((s, r) => s + r.attempts, 0), expanded: rows.flat().reduce((s, r) => s + r.expanded, 0),
      evaluatedCandidates: rows.flat().reduce((s, r) => s + r.evaluatedCandidates, 0), poseEvaluations: rows.flat().reduce((s, r) => s + r.poseEvaluations, 0),
      totalWallMs: rows.flat().reduce((s, r) => s + r.elapsedMs, 0) };
  }));
  writeFileSync(`${out}/results.json`, JSON.stringify({ spec, elapsedMs: performance.now() - start, summary, cases }, null, 2));
  console.log(JSON.stringify({ summary }));
}, 1800000);
