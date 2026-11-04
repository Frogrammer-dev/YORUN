// Opt-in development experiment: target-guided generation, NOT a model-only comparison.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { hasEdge, project, type RoadGraph } from '@/lib/route/graph';
import { globalSearch } from '@/lib/route/globalSearch';
import { SHAPE_BY_ID } from '@/lib/route/shapes';
import type { Region } from '@/lib/route/fit';

type XY = [number, number];
type SourceRow = {
  id: string; area: string; path: number[]; xy: XY[]; latlon: XY[];
  meters: number; repeatRatio: number; roadHash: string; baselineId: string | null;
  [key: string]: unknown;
};
const SHAPES = ['house', 'tree', 'car', 'rocket', 'mug', 'airplane'] as const;
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const coordinateKey = ([lat, lon]: XY) => `${lat},${lon}`;

/** Recover exact graph-node IDs from returned coordinates. Never nearest-node snap.
 * Coincident OSM nodes remain distinct: only a fully adjacent closed trace is accepted.
 */
function recoverPath(g: RoadGraph, latlon: XY[], index: Map<string, number[]>): number[] | null {
  if (latlon.length < 4) return null;
  const choices = latlon.map(p => index.get(coordinateKey(p)) ?? []);
  if (choices.some(c => !c.length)) return null;
  for (const first of choices[0]) {
    let frontier = new Map<number, number[]>([[first, [first]]]);
    for (let i = 1; i < choices.length && frontier.size; i++) {
      const next = new Map<number, number[]>();
      for (const v of choices[i]) {
        if (i === choices.length - 1 && v !== first) continue;
        for (const [u, path] of frontier) {
          if (hasEdge(g, u, v)) { next.set(v, [...path, v]); break; }
        }
      }
      frontier = next;
    }
    const closed = frontier.get(first);
    if (closed?.length === latlon.length) return closed;
  }
  return null;
}

function audit(g: RoadGraph, region: Region, path: number[]) {
  const reasons: string[] = [];
  if (path.length < 4 || path[0] !== path.at(-1)) reasons.push('not_closed');
  if (!path.every(v => Number.isInteger(v) && v >= 0 && v < g.n)) return { reasons: ['invalid_node'] };
  if (!path.every(v => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY)) reasons.push('outside_region');
  let meters = 0, projectedMeters = 0, repeated = 0, projectedRepeated = 0;
  const edges = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (!hasEdge(g, a, b)) return { reasons: [...reasons, 'missing_edge'] };
    let length = NaN;
    for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) { length = g.adjLen[e]; break; }
    if (!Number.isFinite(length) || length <= 0) return { reasons: [...reasons, 'invalid_edge_length'] };
    const projected = Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    meters += length; projectedMeters += projected;
    if (edges.has(key)) { repeated += length; projectedRepeated += projected; }
    edges.add(key);
  }
  const repeatRatio = repeated / meters, projectedRepeatRatio = projectedRepeated / projectedMeters;
  if (![meters, projectedMeters, repeatRatio, projectedRepeatRatio].every(Number.isFinite)) reasons.push('nonfinite_measurement');
  if (meters < 3000 || meters > 8000) reasons.push('native_distance');
  if (projectedMeters < 3000 || projectedMeters > 8000) reasons.push('projected_distance');
  if (repeatRatio > .2) reasons.push('native_repeat');
  if (projectedRepeatRatio > .2) reasons.push('projected_repeat');
  return { reasons, meters, projectedMeters, repeatRatio, projectedRepeatRatio, edgeHash: sha([...edges].sort().join('|')) };
}

it.skipIf(!process.env.ROAD_OBJECT_PROPOSALS)('adds fixed six-object real-road proposals with strict independent route audits', () => {
  const started = performance.now();
  const folder = 'eval/recognition/road-ranker-20261102';
  const output = `${folder}/proposals-v3.json`;
  const protocol = 'reports/road-ranker-20261102/protocol-v3.md';
  expect(existsSync(protocol), 'Pre-register protocol-v3.md before execution').toBe(true);
  expect(existsSync(output), 'Do not overwrite a prior v3 experiment').toBe(false);
  const bytes = readFileSync(`${folder}/roads.json`);
  expect(sha(bytes)).toBe('fc4c1089af9607682d142f28a1d9e6a58ac92628b6f6a921399aa566c561828d');
  const source = JSON.parse(bytes.toString()).results as SourceRow[];
  expect(source).toHaveLength(360);
  const sourceSnapshot = JSON.stringify(source);
  const seeds = JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json', 'utf8')).cases as {area: string; bbox: BBox; roadHash: string}[];
  const areas = seeds.filter((r, i) => seeds.findIndex(s => s.area === r.area) === i);
  expect(areas).toHaveLength(3);
  const results: SourceRow[] = [...source];
  const seen = new Set<string>();
  const counts: Array<Record<string, unknown>> = [];
  const provenance = {
    sourceSHA256: sha(bytes), protocolSHA256: sha(readFileSync(protocol)),
    codeSHA256: sha(readFileSync('tests/eval/road-object-proposals-20261102.test.ts')),
    generatorSHA256: sha(readFileSync('src/lib/route/globalSearch.ts')),
    shapesSHA256: sha(readFileSync('src/lib/route/shapes.ts')),
    shapeIds: SHAPES, attempts: 60, fullRotation: true, rankBySimilarity: true,
    requestedCases: 18, maxReturnedPoolPerCase: 8, minMeters: 3000, maxMeters: 8000,
    totalTestTimeoutMs: 1200000, sharedStepBudget: null,
    budgetWarning: 'attempts60 caps initial routed seeds, NOT coarse enumeration or local refinements; evaluated may exceed 60. Not equal-budget versus v2.',
    humanRecognitionMeasured: false, appDefaultChanged: false,
    experiment: 'joint target-guided generation and frozen broad selection; this file generates candidates only',
  };
  const save = (status: 'running' | 'complete') => writeFileSync(output, JSON.stringify({
    results, counts, provenance, status, sourceCount: 360, addedCount: results.length - 360,
    completedRequests: counts.length, elapsedSeconds: (performance.now() - started) / 1000,
  }));
  for (const area of areas) {
    const roadBytes = readFileSync(`eval/recognition/route-improvement/holdout/${area.area}-roads.json`);
    expect(sha(roadBytes)).toBe(area.roadHash);
    const g = graphFromOverpass(JSON.parse(roadBytes.toString()), area.bbox, {detail: 'simple', excludeSteps: true});
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west);
    const [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east);
    const region = {minX, minY, maxX, maxY};
    const index = new Map<string, number[]>();
    for (let v = 0; v < g.n; v++) {
      const key = coordinateKey([g.lat[v], g.lon[v]]);
      const list = index.get(key) ?? []; list.push(v); index.set(key, list);
    }
    // Re-audit original pool on the exact graph, retaining original objects verbatim.
    for (const row of source.filter(r => r.area === area.area)) {
      expect(row.roadHash).toBe(area.roadHash);
      const checked = audit(g, region, row.path);
      expect(checked.reasons, row.id).toEqual([]);
      expect(row.xy).toEqual(row.path.map(v => [g.x[v], g.y[v]]));
      expect(row.latlon).toEqual(row.path.map(v => [g.lat[v], g.lon[v]]));
      expect(checked.meters).toBe(row.meters);
      expect(checked.repeatRatio).toBe(row.repeatRatio);
      const key = `${area.area}:${checked.edgeHash}`;
      expect(seen.has(key)).toBe(false); seen.add(key);
    }
    for (const shapeId of SHAPES) {
      const begin = performance.now();
      const failureCounts: Record<string, number> = {};
      const addFailure = (reason: string) => { failureCounts[reason] = (failureCounts[reason] ?? 0) + 1; };
      let added = 0, duplicates = 0, validBeforeDedup = 0, returnedPool = 0;
      let coarseSeeds: number | null = null, evaluated: number | null = null;
      let searchSeconds: number | null = null, error: string | null = null;
      process.stdout.write(`[v3] START ${area.area} ${shapeId}\n`);
      try {
        const beginSearch = performance.now();
        const found = globalSearch(g, SHAPE_BY_ID[shapeId], region, 60, true, true);
        searchSeconds = (performance.now() - beginSearch) / 1000;
        coarseSeeds = found.coarseSeeds; evaluated = found.evaluated;
        returnedPool = found.pool.length;
        expect(returnedPool).toBeLessThanOrEqual(8);
        for (const [rank, candidate] of found.pool.entries()) {
          const path = recoverPath(g, candidate.latlngs, index);
          if (!path) { addFailure('exact_graph_path_recovery'); continue; }
          const checked = audit(g, region, path);
          if (checked.reasons.length) { checked.reasons.forEach(addFailure); continue; }
          validBeforeDedup++;
          const key = `${area.area}:${checked.edgeHash}`;
          if (seen.has(key)) { duplicates++; continue; }
          seen.add(key);
          results.push({id: `${area.area}-proposal-v3-${shapeId}-${rank + 1}`, area: area.area,
            baselineId: null, proposalShape: shapeId, proposalPoolRank: rank + 1,
            roadHash: area.roadHash, path, xy: path.map(v => [g.x[v], g.y[v]]),
            latlon: path.map(v => [g.lat[v], g.lon[v]]),
            meters: checked.meters!, projectedMeters: checked.projectedMeters!,
            repeatRatio: checked.repeatRatio!, projectedRepeatRatio: checked.projectedRepeatRatio!,
            edgeHash: checked.edgeHash, generatorSimilarity: candidate.similarity,
            generatorPlacement: candidate.placement, source: 'globalSearch-six-fixed-objects-v3'});
          added++;
        }
      } catch (err) {
        // Fixed parameters are never changed or retried. Keep the failed request in denominator18.
        error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      }
      counts.push({area: area.area, proposalShape: shapeId, attempts: 60, coarseSeeds, evaluated,
        returnedPool, validBeforeDedup, duplicates, added, failureCounts, error,
        searchSeconds, elapsedSeconds: (performance.now() - begin) / 1000});
      save('running');
      process.stdout.write(`[v3] DONE ${JSON.stringify(counts.at(-1))}\n`);
    }
  }
  expect(JSON.stringify(source)).toBe(sourceSnapshot);
  expect(results.slice(0, 360)).toEqual(source);
  expect(results.filter(r => r.baselineId)).toHaveLength(18);
  expect(counts).toHaveLength(18);
  expect(results.length - 360).toBeLessThanOrEqual(144);
  expect(new Set(results.map(r => r.id)).size).toBe(results.length);
  save('complete');
  process.stdout.write(`[v3] COMPLETE ${JSON.stringify({requests: counts.length, added: results.length - 360, total: results.length, errors: counts.filter(c => c.error).length, seconds: (performance.now() - started) / 1000})}\n`);
}, 1200000);
