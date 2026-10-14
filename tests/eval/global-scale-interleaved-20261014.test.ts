import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { globalSearch } from '@/lib/route/globalSearch';
import { globalSearchScaleInterleaved, SCALE_INTERLEAVED_GLOBAL_PARAMS } from '@/lib/route/globalSearchScaleInterleaved';
import { toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { rolloutPathAuditor } from './rollout-pilot-support';

const traces = vi.hoisted(() => ({ placements: [] as Array<{ cx: number; cy: number; scale: number; rotDeg: number }> }));
vi.mock('@/lib/route/fit', async () => {
  const actual = await vi.importActual<typeof import('@/lib/route/fit')>('@/lib/route/fit');
  return { ...actual, routePlacement: (...args: Parameters<typeof actual.routePlacement>) => {
    traces.placements.push({ ...args[3] });
    return actual.routePlacement(...args);
  } };
});

it.skipIf(process.env.GLOBAL_SCALE_INTERLEAVED !== '1')('routes original coarse poses in four scale tiers with the unchanged global generator', () => {
  const area = process.env.GLOBAL_SCALE_AREA ?? 'gwangalli';
  expect(['gwangalli', 'seomyeon', 'gangnam']).toContain(area);
  const out = path.resolve('eval/recognition/route-improvement/global-scale-interleaved-20261014', area);
  expect(existsSync(out), 'Never overwrite an existing experiment').toBe(false);
  mkdirSync(out, { recursive: true });
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  const inputPath = 'eval/recognition/route-improvement/offline-cascade-20261013/results.json';
  const inputBytes = readFileSync(inputPath);
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; raw: number; sourceHash: string }> };
  const rows = input.cases.filter(row => row.caseId.startsWith(`${area}-`));
  expect(rows).toHaveLength(4);
  expect(new Set(rows.map(row => row.candidate.shapeId))).toEqual(new Set(['square', 'heart', 'star', 'cat']));
  const roadPath = `eval/recognition/llm-routes-20261010/${area}-roads.json`, roadBytes = readFileSync(roadPath);
  expect(rows.every(row => row.sourceHash === hash(roadBytes))).toBe(true);
  const files = ['tests/eval/global-scale-interleaved-20261014.test.ts', 'tests/eval/create-scale-interleaved-global.mjs', 'tests/eval/rollout-pilot-support.ts', 'src/lib/route/globalSearchScaleInterleaved.ts', 'src/lib/route/globalSearch.ts', 'src/lib/route/fit.ts', 'src/lib/route/flex.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/art/rdp.ts'];
  const codeHashes = Object.fromEntries(files.map(file => {
    const bytes = readFileSync(file); writeFileSync(path.join(out, `${path.basename(file)}.source`), bytes); return [file, hash(bytes)];
  }));
  const protocol = { area, denominator: 4, originalScore: true, originalTemplate: true, originalROI: true,
    codeHashes, inputHash: hash(inputBytes), roadHash: hash(roadBytes), minMeters: 3000, maxMeters: 8000, repeatMax: .2,
    arms: ['original-flat-rank', 'four-scale-tier-rank-round-robin'], policy: SCALE_INTERLEAVED_GLOBAL_PARAMS,
    initialRoutingCalls: 240, localRoutingMaxCalls: 96, fullRotation: true, rankBySimilarity: true, fairRefitPerRepresentation: 128,
    sameConfiguredCapsNotSameActualWork: true, generationUsesStoredCandidates: false, comparisonReadsStoredBaselines: true,
    knownPosesNeverInjected: true, onlyOwnGlobalPoolEvaluated: true, freshWholeCascadeClaim: false, holdoutRead: false,
    invalidOutputDiscardedBeforeAdoptionAndReported: true, nullOrFailedArmsRetainZeroInGlobalDenominator: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const graphBegan = Date.now(), bbox = rows[0].bbox;
  const g = graphFromOverpass(JSON.parse(roadBytes.toString()), bbox, { detail: 'simple', excludeSteps: true });
  const [minX, minY] = project(g.origin, bbox.south, bbox.west), [maxX, maxY] = project(g.origin, bbox.north, bbox.east), region = { minX, minY, maxX, maxY };
  const graphMs = Date.now() - graphBegan;
  const records: Array<{ caseId: string; originalBefore: number; arms: Array<{ globalSimilarity: number; globalRaw: number; after: number; afterRaw: number; improvement: boolean; evaluated: number; rejected: unknown[] }> }> = [];
  for (const row of rows) {
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], auditor = rolloutPathAuditor(g, shape, region);
    type Scored = { candidate: RouteCandidate; nodes: number[]; raw: number; placement: Placement; nativeMeters: number; nativeRepeatRatio: number };
    const score = (nodes: number[], placement: Placement): Scored => {
      const a = auditor.audit(nodes, placement);
      let nativeMeters = 0, repeatedMeters = 0;
      const used = new Set<string>();
      for (let i = 1; i < nodes.length; i++) {
        const from = nodes[i - 1], to = nodes[i];
        let edge = -1;
        for (let k = g.adjStart[from]; k < g.adjStart[from + 1]; k++) if (g.adjTo[k] === to) { edge = k; break; }
        expect(edge).toBeGreaterThanOrEqual(0);
        const key = `${Math.min(from, to)}:${Math.max(from, to)}`, meters = g.adjLen[edge];
        nativeMeters += meters; if (used.has(key)) repeatedMeters += meters; used.add(key);
      }
      if (nativeMeters < 3000 || nativeMeters > 8000 || repeatedMeters / nativeMeters > .2) throw new Error('Native CSR distance/repetition constraint failed');
      return { candidate: toCandidate(g, shape, placement, a.evaluated), nodes, raw: a.raw, placement, nativeMeters, nativeRepeatRatio: repeatedMeters / nativeMeters };
    };
    const originalNodes = auditor.nodesFor(row.candidate), original = score(originalNodes, row.candidate.placement);
    expect(original.raw).toBeCloseTo(row.raw, 8);
    const originalKey = pairEdgeKey(originalNodes);
    let baselineRefitCalls = 0;
    const fair = (nodes: number[], placement: Placement, counter: { calls: number }): Scored[] => {
      const canonical = pairPhaseZero(g, shape, placement, nodes), values = [score(nodes, placement), score(canonical, placement)];
      for (const representation of [nodes, canonical]) {
        const refined = refinePathPlacement(g, shape, placement, representation, region, 3000, 8000, 128);
        if (!refined) continue;
        counter.calls += refined.evaluations;
        values.push(score(refined.evaluated.path, refined.placement), score(pairPhaseZero(g, shape, refined.placement, refined.evaluated.path), refined.placement));
      }
      return values;
    };
    const baselineCounter = { calls: 0 }, baselineValues = fair(originalNodes, row.candidate.placement, baselineCounter);
    baselineValues.sort((a, b) => b.raw - a.raw); const baseline = baselineValues[0]; baselineRefitCalls = baselineCounter.calls;
    const arms = [];
    for (const interleaved of [false, true]) {
      const name = interleaved ? 'scale-interleaved' : 'control';
      writeFileSync(path.join(out, 'progress.json'), JSON.stringify({ caseId: row.caseId, stage: name }));
      traces.placements.length = 0;
      const began = Date.now(), output = (interleaved ? globalSearchScaleInterleaved : globalSearch)(g, shape, region, 240, true, true), searchMs = Date.now() - began;
      expect(traces.placements.length).toBe(output.evaluated);
      expect(output.evaluated).toBeGreaterThanOrEqual(240); expect(output.evaluated).toBeLessThanOrEqual(336);
      const routingTrace = structuredClone(traces.placements), initialScales: Record<string, number> = {};
      for (const p of routingTrace.slice(0, 240)) initialScales[p.scale.toFixed(9)] = (initialScales[p.scale.toFixed(9)] ?? 0) + 1;
      const valid: Scored[] = [], rejected: Array<{ id: string; reason: string }> = [];
      const refitCounter = { calls: 0 }, refitBegan = Date.now();
      for (const c of output.pool) {
        try {
          const nodes = auditor.nodesFor(c), exact = score(nodes, c.placement);
          expect(exact.candidate.similarity).toBe(c.similarity);
          valid.push(...fair(nodes, c.placement, refitCounter));
        } catch (error) { rejected.push({ id: c.id, reason: error instanceof Error ? error.message : 'invalid output' }); }
      }
      valid.sort((a, b) => b.raw - a.raw);
      const best = valid[0] ?? null, bestNewGeometry = valid.find(item => pairEdgeKey(item.nodes) !== originalKey) ?? null;
      const improvement = !!bestNewGeometry && bestNewGeometry.raw > baseline.raw + 1e-7;
      const accepted = improvement ? bestNewGeometry! : baseline;
      expect(accepted.raw).toBeGreaterThanOrEqual(original.raw - 1e-8);
      const record = { name, searchMs, refitMs: Date.now() - refitBegan, coarseSeeds: output.coarseSeeds,
        evaluated: output.evaluated, initialRoutingCalls: 240, localRoutingCalls: output.evaluated - 240,
        initialScales, routingTrace, poolSize: output.pool.length, rejected, refitCalls: refitCounter.calls,
        best, bestNewGeometry, globalSimilarity: best?.candidate.similarity ?? 0, globalRaw: best?.raw ?? 0,
        improvement, after: accepted.candidate.similarity, afterRaw: accepted.raw, accepted };
      arms.push(record); writeFileSync(path.join(out, `${row.caseId}-${name}.json`), JSON.stringify(record, null, 2));
    }
    const record = { caseId: row.caseId, originalBefore: original.candidate.similarity, originalRaw: original.raw,
      fairBaseline: baseline.candidate.similarity, fairBaselineRaw: baseline.raw, baselineRefitCalls, arms };
    records.push(record); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(record, null, 2));
  }
  for (const file of files) expect(hash(readFileSync(file))).toBe(codeHashes[file]);
  expect(hash(readFileSync(inputPath))).toBe(protocol.inputHash); expect(hash(readFileSync(roadPath))).toBe(protocol.roadHash);
  const summary = { denominator: 4, graphMs, originalAverage: records.reduce((sum, row) => sum + row.originalBefore, 0) / 4,
    arms: [0, 1].map(i => ({ name: i ? 'scale-interleaved' : 'control',
      globalAverage: records.reduce((sum, row) => sum + row.arms[i].globalSimilarity, 0) / 4,
      globalRawAverage: records.reduce((sum, row) => sum + row.arms[i].globalRaw, 0) / 4,
      preservedAverage: records.reduce((sum, row) => sum + row.arms[i].after, 0) / 4,
      preservedRawAverage: records.reduce((sum, row) => sum + row.arms[i].afterRaw, 0) / 4,
      improvements: records.filter(row => row.arms[i].improvement).length,
      evaluated: records.reduce((sum, row) => sum + row.arms[i].evaluated, 0),
      rejected: records.reduce((sum, row) => sum + row.arms[i].rejected.length, 0) })) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases: records }, null, 2));
  console.log(JSON.stringify(summary));
}, 1_800_000);
