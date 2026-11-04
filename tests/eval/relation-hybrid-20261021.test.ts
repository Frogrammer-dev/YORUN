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
import { normalizeRoadReferenceRenderLine } from '@/lib/art/roadReference';

const source = 'eval/recognition/relation-generation-20261021/trial-v1/results.json';
const out = 'eval/recognition/relation-generation-20261021/hybrid-v1';
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

it.skipIf(process.env.RELATION_HYBRID !== '1')('measures two fixed half-budget hybrid schedules on the same six fresh-trial seeds', async () => {
  const bytes = readFileSync(source), trial = JSON.parse(bytes.toString()) as { cases: TrialCase[] };
  expect(trial.cases).toHaveLength(6);
  expect(new Set(trial.cases.map(c => c.id)).size).toBe(6);
  const levels = [32, 96, 192, 384], schedules = [['uniform', 'relation'], ['relation', 'uniform']] as const;
  const sourceFiles = ['tests/eval/relation-hybrid-20261021.test.ts', 'src/lib/route/relationGuidedSearch.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/route/fit.ts', 'src/lib/route/shapes.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/art/roadReference.ts'];
  mkdirSync(`${out}/sources`, { recursive: true });
  const codeHashes = Object.fromEntries(sourceFiles.map(file => {
    const content = readFileSync(file); writeFileSync(`${out}/sources/${file.replaceAll('/', '__')}.source.txt`, content);
    return [file, sha(content)];
  }));
  const spec = { denominator: 6, source, sourceSha256: sha(bytes), levels, schedules, totalBudgetSplit: '50/50', sameSeedAndPose: true, discoveryRerun: false,
    cohort: 'Fixed initial six fresh trial-v1 seeds, not saved best outputs. Follow-up development-cohort optimization, not independent validation.',
    maxExpanded: 12000, originalTwelveRead: false, holdoutV2Read: false, paidApiCalls: 0, codeHashes,
    timing: 'Includes both generator initializations and calls; excludes graph rebuilding, audit, PNG and file I/O. Wall times may include concurrent machine workloads.',
    selection: 'Both schedules and every budget reported; post-hoc maximum is not generalization performance.' };
  writeFileSync(`${out}/protocol.json`, JSON.stringify(spec, null, 2));
  const cases: Array<{ id: string; baseline: { rawSimilarity: number }; arms: Array<{ level: number; mode: string; elapsedMs: number; attempts: number; expanded: number; output: { rawSimilarity: number; valid: boolean } }> }> = [];
  const start = performance.now();
  const graphs = new Map<string, { g: RoadGraph; region: Region }>();
  for (const item of trial.cases) {
    if (!graphs.has(item.area)) {
      const roadBytes = readFileSync(`${roads}/${item.area}-roads.json`);
      expect(sha(roadBytes)).toBe(item.roadHash);
      const g = graphFromOverpass(JSON.parse(roadBytes.toString()), item.bbox, { detail: 'simple', excludeSteps: true });
      const [minX, minY] = project(g.origin, item.bbox.south, item.bbox.west), [maxX, maxY] = project(g.origin, item.bbox.north, item.bbox.east);
      graphs.set(item.area, { g, region: { minX, minY, maxX, maxY } });
    }
    const { g, region } = graphs.get(item.area)!, shape = SHAPE_BY_ID[item.shapeId], placement = item.baseline.placement, input = item.baseline.path;
    const original = evaluatePath(g, shape, placement, input, 3000, 8000), originalQ = relationOriginalObjective(original, placement);
    const canonicalQ = relationOriginalObjective(evaluatePath(g, shape, placement, pairPhaseZero(g, shape, placement, input), 3000, 8000), placement);
    const inputKey = pairEdgeKey(input), threshold = Math.min(originalQ, canonicalQ);
    const metrics = (path: number[]) => {
      const native = audit(g, region, path), e = evaluatePath(g, shape, placement, path, 3000, 8000), q = relationOriginalObjective(e, placement);
      const templateInside = placeShape(shape.points, placement).every(([x, y]) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY);
      const edgeChanged = pairEdgeKey(path) !== inputKey;
      const canonicalQualityPassed = !edgeChanged || q < threshold - 1e-9;
      const exactInputPreserved = path.length === input.length && path.every((v, i) => v === input[i]);
      const valid = native.valid && templateInside && canonicalQualityPassed && (edgeChanged || exactInputPreserved);
      return { ...native, valid, templateInside, edgeChanged, canonicalQualityPassed, exactInputPreserved,
        originalObjective: originalQ, canonicalOriginalObjective: canonicalQ, objective: q,
        rawSimilarity: valid ? 100 * Math.exp(-q) : 0, relation: relationDiagnostics(g, shape, placement, path),
        meanDeviationMeters: e.meanDev, featureCoverage: e.featureCoverage, spikes: e.spikes, zigzagPerKm: e.zigzagPerKm,
        placement, path, latlngs: path.map(v => [g.lat[v], g.lon[v]] as [number, number]) };
    };
    const baseline = metrics(input); expect(baseline.valid, item.id).toBe(true);
    expect(baseline.rawSimilarity).toBeCloseTo(item.baseline.rawSimilarity, 8);
    const arms = [];
    for (const level of levels) for (const schedule of schedules) {
      const armStart = performance.now(), stages = [];
      let nodes = input;
      for (const mode of schedule) {
        const stageStart = performance.now();
        const result = relationGuidedSearch(g, shape, placement, nodes, region,
          { mode, maxProposals: level / 2, maxExpanded: 12000, minMeters: 3000, maxMeters: 8000 });
        expect(result, `${item.id}/${level}/${mode}`).not.toBeNull();
        const stageElapsedMs = performance.now() - stageStart;
        nodes = result!.evaluated.path;
        stages.push({ mode, budget: level / 2, elapsedMs: stageElapsedMs, attempts: result!.attempts, expanded: result!.expanded,
          evaluatedCandidates: result!.evaluatedCandidates, acceptedRepairs: result!.acceptedRepairs, diagnostics: result!.diagnostics });
      }
      const elapsedMs = performance.now() - armStart, output = metrics(nodes);
      expect(output.valid, `${item.id}/${level}/${schedule.join('-')}`).toBe(true);
      expect(output.objective).toBeLessThanOrEqual(originalQ + 1e-9);
      const record = { level, mode: schedule.join('-'), schedule, elapsedMs, stages,
        attempts: stages.reduce((s, v) => s + v.attempts, 0), expanded: stages.reduce((s, v) => s + v.expanded, 0),
        evaluatedCandidates: stages.reduce((s, v) => s + v.evaluatedCandidates, 0), acceptedRepairs: stages.reduce((s, v) => s + v.acceptedRepairs, 0), output };
      expect(record.attempts).toBeLessThanOrEqual(level);
      arms.push(record);
      console.log(JSON.stringify({ id: item.id, level, mode: record.mode, attempts: record.attempts, elapsedMs: Math.round(elapsedMs), rawSimilarity: output.rawSimilarity }));
      writeFileSync(`${out}/${item.id}-progress.json`, JSON.stringify({ id: item.id, shapeId: item.shapeId, baseline, arms }, null, 2));
    }
    const result = { id: item.id, area: item.area, bbox: item.bbox, roadHash: item.roadHash, shapeId: item.shapeId, family: item.family, baseline, arms };
    cases.push(result); writeFileSync(`${out}/${item.id}.json`, JSON.stringify(result, null, 2));
    const images = [{ name: 'baseline', output: baseline }, ...arms.filter(a => a.level === 384).map(a => ({ name: a.mode, output: a.output }))];
    for (const image of images) {
      const line = normalizeRoadReferenceRenderLine({ id: 'raw', latlngs: image.output.latlngs });
      const d = line.map(([x, y], i) => `${i ? 'L' : 'M'}${(x * 400).toFixed(3)},${(y * 400).toFixed(3)}`).join(' ');
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round"/></svg>`)).png().toFile(`${out}/${item.id}-${image.name}.png`);
    }
  }
  expect(cases).toHaveLength(6);
  expect(sha(readFileSync(source))).toBe(spec.sourceSha256);
  for (const [file, hash] of Object.entries(codeHashes)) expect(sha(readFileSync(file))).toBe(hash);
  const summary = levels.flatMap(level => schedules.map(schedule => {
    const mode = schedule.join('-'), rows = cases.map(c => c.arms.find(a => a.level === level && a.mode === mode)!);
    return { level, mode, denominator: 6, meanRawSimilarity: rows.reduce((s, r) => s + r.output.rawSimilarity, 0) / 6,
      baselineMean: cases.reduce((s, c) => s + c.baseline.rawSimilarity, 0) / 6,
      totalWallMs: rows.reduce((s, r) => s + r.elapsedMs, 0), actualAttempts: rows.reduce((s, r) => s + r.attempts, 0),
      expanded: rows.reduce((s, r) => s + r.expanded, 0), invalid: rows.filter(r => !r.output.valid).length };
  }));
  writeFileSync(`${out}/results.json`, JSON.stringify({ spec, elapsedMs: performance.now() - start, summary, cases }, null, 2));
  console.log(JSON.stringify({ summary }));
}, 1800000);
