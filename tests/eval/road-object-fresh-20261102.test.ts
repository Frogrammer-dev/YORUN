// Opt-in development experiment: target-guided generation, NOT a model-only comparison.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, openSync, readSync, closeSync, statSync } from 'node:fs';
import path from 'node:path';
import { readLocalRoads } from '@/lib/route/roadData.server';
import { buildBlocks, growLoops } from '@/lib/route/loops';
import { StepBudget } from '@/lib/route/budget';
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

const AREAS = [
  {area: 'suwon-yeongtong', bbox: {south: 37.24, west: 127.04, north: 37.28, east: 127.09}},
  {area: 'cheongju-bokdae', bbox: {south: 36.62, west: 127.42, north: 36.66, east: 127.47}},
  {area: 'gwangju-sangmu', bbox: {south: 35.135, west: 126.83, north: 35.175, east: 126.88}},
] as const;

function hashFile(file: string) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(4 * 1024 * 1024);
  const fd = openSync(file, 'r');
  try { let count: number; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}

it.skipIf(!process.env.ROAD_OBJECT_FRESH)('freezes new local-road areas and generates strictly valid natural and six-object candidates', () => {
  const started = performance.now();
  const folder = 'eval/recognition/road-ranker-20261102';
  const output = `${folder}/fresh-v6.json`, progressFile = `${folder}/fresh-v6.running.json`;
  const snapshotDir = `${folder}/fresh-roads`;
  const protocol = 'reports/road-ranker-20261102/protocol-v6.md';
  expect(existsSync(protocol), 'Register protocol-v6 before execution').toBe(true);
  expect(existsSync(output), 'Never overwrite final v6 output').toBe(false);
  expect(existsSync(progressFile), 'Preserve any earlier partial run').toBe(false);
  for (const {area} of AREAS) expect(existsSync(`${snapshotDir}/${area}-roads.json`), 'Preserve any existing fresh snapshot').toBe(false);
  mkdirSync(snapshotDir, {recursive: true});
  const dataDir = path.resolve('data/roads');
  const manifestBytes = readFileSync(path.join(dataDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString()) as {file: string; schema: string; timestamp: string};
  expect(manifest.schema).toBe('1');
  expect(manifest.file).toMatch(/^roads-[\w-]+\.sqlite$/);
  const dbFile = path.join(dataDir, manifest.file), dbStat = statSync(dbFile);
  process.stdout.write('[v6] Hashing read-only SQLite source\n');
  const sqliteSHA256 = hashFile(dbFile);
  const results: SourceRow[] = [];
  const counts: Array<Record<string, unknown>> = [];
  const naturalCounts: Array<Record<string, unknown>> = [];
  const sourceSnapshots: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const graphs: Array<{area: string; bbox: BBox; g: RoadGraph; region: Region; roadHash: string; sourceFile: string; index: Map<string, number[]>}> = [];
  const areaErrors = new Map<string, string>();
  const provenance = {
    protocolSHA256: sha(readFileSync(protocol)), codeSHA256: sha(readFileSync('tests/eval/road-object-fresh-20261102.test.ts')),
    generatorSHA256: sha(readFileSync('src/lib/route/globalSearch.ts')),
    graphCodeSHA256: sha(readFileSync('src/lib/route/graph.ts')), osmCodeSHA256: sha(readFileSync('src/lib/route/osm.ts')),
    loopCodeSHA256: sha(readFileSync('src/lib/route/loops.ts')), shapesSHA256: sha(readFileSync('src/lib/route/shapes.ts')),
    readerCodeSHA256: sha(readFileSync('src/lib/route/roadData.server.ts')),
    areas: AREAS, sqliteFile: dbFile, sqliteSHA256, sqliteBytes: dbStat.size,
    sqliteManifest: JSON.parse(manifestBytes.toString()), sqliteManifestSHA256: sha(manifestBytes), sourceSnapshots,
    detail: 'simple', excludeSteps: true, minMeters: 3000, maxMeters: 8000, maxRepeatRatio: .2,
    naturalSeed: 83721, naturalStepBudget: 2000, naturalMaxPerArea: 120,
    naturalSampling: 'first two valid edge-unique returned loops as baseline; then fixed path-hash order; new edge Jaccard<=0.8',
    shapeIds: SHAPES, attempts: 60, fullRotation: true, rankBySimilarity: true, maxPoolPerCase: 8,
    requestedCases: 18, totalTestTimeoutMs: 1200000,
    budgetWarning: 'attempts60 caps initial routing seeds; coarseSeeds counts retained coarse seeds, not all coarse evaluations; local search adds evaluated calls. Not equal-budget to earlier regions.',
    humanRecognitionMeasured: false, semanticSelectionExecuted: false, holdoutV2Read: false,
    experiment: 'new-area candidate generation only; larger supplied bboxes; frozen v5 semantic selection performed separately',
  };
  const save = (status: 'running' | 'complete') => writeFileSync(progressFile, JSON.stringify({
    results, counts, naturalCounts, provenance, status, completedRequests: counts.length,
    sourceCount: results.filter(r => !r.proposalShape).length,
    addedCount: results.filter(r => r.proposalShape).length,
    elapsedSeconds: (performance.now() - started) / 1000,
  }));
  save('running');
  // Freeze/query only these explicitly supplied new regions. Never read old evaluation areas.
  for (const {area, bbox} of AREAS) {
    const begin = performance.now();
    process.stdout.write(`[v6] NATURAL START ${area}\n`);
    try {
      expect(readFileSync(path.join(dataDir, 'manifest.json'))).toEqual(manifestBytes);
      const raw = Buffer.from(JSON.stringify(readLocalRoads(bbox, dataDir)));
      const sourceFile = `${snapshotDir}/${area}-roads.json`;
      writeFileSync(sourceFile, raw, {flag: 'wx'});
      const roadHash = sha(raw), osm = JSON.parse(raw.toString());
      sourceSnapshots.push({area, bbox, sourceFile, roadHash, bytes: raw.length, timestamp: osm.osm3s?.timestamp_osm_base ?? null});
      const g = graphFromOverpass(osm, bbox, {detail: 'simple', excludeSteps: true});
      const [minX, minY] = project(g.origin, bbox.south, bbox.west), [maxX, maxY] = project(g.origin, bbox.north, bbox.east);
      const region = {minX, minY, maxX, maxY};
      const index = new Map<string, number[]>();
      for (let v = 0; v < g.n; v++) { const key = coordinateKey([g.lat[v], g.lon[v]]); const list = index.get(key) ?? []; list.push(v); index.set(key, list); }
      graphs.push({area, bbox, g, region, roadHash, sourceFile, index});
      const blocks = buildBlocks(g, (maxX - minX) * (maxY - minY) / 4);
      const loops = growLoops(g, blocks, region, 3000, 8000, {seeds: Math.min(2000, blocks.faces.length), budget: new StepBudget(2000), fraction: 1, seed: 83721});
      const failures: Record<string, number> = {};
      const acceptedEdges: Set<string>[] = [];
      const localSeen = new Set<string>();
      let checked = 0, duplicates = 0, nearDuplicates = 0, baselineCount = 0, validUnique = 0;
      const valid: Array<{path: number[]; checked: ReturnType<typeof audit>}> = [];
      for (const loop of loops) {
        checked++;
        const checkedPath = audit(g, region, loop.path);
        if (checkedPath.reasons.length) { for (const reason of checkedPath.reasons) failures[reason] = (failures[reason] ?? 0) + 1; continue; }
        if (localSeen.has(checkedPath.edgeHash!)) { duplicates++; continue; }
        localSeen.add(checkedPath.edgeHash!); validUnique++;
        valid.push({path: loop.path, checked: checkedPath});
      }
      const baseline = valid.slice(0, 2);
      const rest = valid.slice(2).map(r => ({...r, orderHash: sha(`83721:${r.path.join(',')}`)})).sort((a, b) => a.orderHash.localeCompare(b.orderHash));
      const natural = [...baseline, ...rest];
      let exported = 0;
      for (const entry of natural) {
        const edges = new Set(entry.path.slice(1).map((v, i) => entry.path[i] < v ? `${entry.path[i]}:${v}` : `${v}:${entry.path[i]}`));
        const isBaseline = exported < baseline.length;
        if (!isBaseline && acceptedEdges.some(other => {
          let intersection = 0; for (const e of edges) if (other.has(e)) intersection++;
          return intersection / (edges.size + other.size - intersection) > .8;
        })) { nearDuplicates++; continue; }
        const checkedPath = entry.checked;
        const id = `${area}-natural-v6-${exported + 1}`;
        results.push({id, area, baselineId: isBaseline ? id : null, source: 'natural-loop-v6', proposalShape: null,
          roadHash, sourceFile, edgeHash: checkedPath.edgeHash, path: entry.path,
          xy: entry.path.map(v => [g.x[v], g.y[v]]), latlon: entry.path.map(v => [g.lat[v], g.lon[v]]),
          meters: checkedPath.meters!, projectedMeters: checkedPath.projectedMeters!,
          repeatRatio: checkedPath.repeatRatio!, projectedRepeatRatio: checkedPath.projectedRepeatRatio!});
        seen.add(`${area}:${checkedPath.edgeHash}`); acceptedEdges.push(edges); exported++;
        if (isBaseline) baselineCount++;
        if (exported === 120) break;
      }
      naturalCounts.push({area, graphNodes: g.n, blocks: blocks.faces.length, returnedLoops: loops.length, checked, validUnique,
        duplicates, nearDuplicates, exported, baselineCount, missingBaselineSlots: 2 - baselineCount, failures,
        elapsedSeconds: (performance.now() - begin) / 1000, error: null});
    } catch (err) {
      const error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      // If a graph was frozen successfully, shape requests can still execute; no retry or parameter changes.
      areaErrors.set(area, error);
      naturalCounts.push({area, error, elapsedSeconds: (performance.now() - begin) / 1000});
    }
    save('running');
    process.stdout.write(`[v6] NATURAL DONE ${JSON.stringify(naturalCounts.at(-1))}\n`);
  }
  // All natural candidates precede all proposals; baseline markers stay on exactly first two valid loops.
  const naturalSnapshot = JSON.stringify(results);
  const sourceCount = results.length;
  for (const {area} of AREAS) {
    const state = graphs.find(g => g.area === area);
    for (const shapeId of SHAPES) {
      const begin = performance.now();
      const failureCounts: Record<string, number> = {};
      let coarseSeeds: number | null = null, evaluated: number | null = null, searchSeconds: number | null = null;
      let returnedPool = 0, validBeforeDedup = 0, duplicates = 0, added = 0, error: string | null = null;
      process.stdout.write(`[v6] SHAPE START ${area} ${shapeId}\n`);
      try {
        if (!state) throw new Error(areaErrors.get(area) ?? 'area_graph_unavailable');
        const {g, region, roadHash, sourceFile, index} = state;
        const searchStarted = performance.now();
        const found = globalSearch(g, SHAPE_BY_ID[shapeId], region, 60, true, true);
        searchSeconds = (performance.now() - searchStarted) / 1000;
        coarseSeeds = found.coarseSeeds; evaluated = found.evaluated; returnedPool = found.pool.length;
        expect(returnedPool).toBeLessThanOrEqual(8);
        for (const [rank, candidate] of found.pool.entries()) {
          const nodes = recoverPath(g, candidate.latlngs, index);
          if (!nodes) { failureCounts.exact_graph_path_recovery = (failureCounts.exact_graph_path_recovery ?? 0) + 1; continue; }
          const checkedPath = audit(g, region, nodes);
          if (checkedPath.reasons.length) { for (const reason of checkedPath.reasons) failureCounts[reason] = (failureCounts[reason] ?? 0) + 1; continue; }
          validBeforeDedup++;
          const key = `${area}:${checkedPath.edgeHash}`;
          if (seen.has(key)) { duplicates++; continue; }
          results.push({id: `${area}-proposal-v6-${shapeId}-${rank + 1}`, area, baselineId: null,
            proposalShape: shapeId, proposalPoolRank: rank + 1, source: 'globalSearch-six-fixed-objects-v6', sourceFile, roadHash,
            path: nodes, xy: nodes.map(v => [g.x[v], g.y[v]]), latlon: nodes.map(v => [g.lat[v], g.lon[v]]),
            meters: checkedPath.meters!, projectedMeters: checkedPath.projectedMeters!, repeatRatio: checkedPath.repeatRatio!,
            projectedRepeatRatio: checkedPath.projectedRepeatRatio!, edgeHash: checkedPath.edgeHash,
            generatorSimilarity: candidate.similarity, generatorPlacement: candidate.placement});
          seen.add(key); added++;
        }
      } catch (err) { error = err instanceof Error ? `${err.name}: ${err.message}` : String(err); }
      counts.push({area, proposalShape: shapeId, attempts: 60, coarseSeeds, evaluated, returnedPool, validBeforeDedup,
        duplicates, added, failureCounts, error, searchSeconds, elapsedSeconds: (performance.now() - begin) / 1000});
      save('running');
      process.stdout.write(`[v6] SHAPE DONE ${JSON.stringify(counts.at(-1))}\n`);
    }
  }
  expect(counts).toHaveLength(18);
  expect(JSON.stringify(results.slice(0, sourceCount))).toBe(naturalSnapshot);
  expect(results.length - sourceCount).toBeLessThanOrEqual(144);
  expect(new Set(results.map(r => r.id)).size).toBe(results.length);
  expect(new Set(results.map(r => `${r.area}:${r.edgeHash}`)).size).toBe(results.length);
  expect(readFileSync(path.join(dataDir, 'manifest.json'))).toEqual(manifestBytes);
  const after = statSync(dbFile);
  expect(after.size).toBe(dbStat.size); expect(after.mtimeMs).toBe(dbStat.mtimeMs);
  // Final independent pass over all included candidates and coordinate/node correspondence.
  for (const row of results) {
    const state = graphs.find(g => g.area === row.area)!;
    expect(audit(state.g, state.region, row.path).reasons, row.id).toEqual([]);
    expect(row.xy).toEqual(row.path.map(v => [state.g.x[v], state.g.y[v]]));
    expect(row.latlon).toEqual(row.path.map(v => [state.g.lat[v], state.g.lon[v]]));
    expect(row.roadHash).toBe(sha(readFileSync(state.sourceFile)));
  }
  for (const {area} of AREAS) expect(results.filter(r => r.area === area && r.baselineId).length).toBeLessThanOrEqual(2);
  // A final filename is published only after all work/checks. Readers must not consume .running.json.
  save('complete');
  renameSync(progressFile, output);
  process.stdout.write(`[v6] COMPLETE ${JSON.stringify({requests: counts.length, natural: sourceCount, added: results.length - sourceCount,
    total: results.length, errors: counts.filter(c => c.error).length, seconds: (performance.now() - started) / 1000, outputSHA256: sha(readFileSync(output))})}\n`);
}, 1200000);