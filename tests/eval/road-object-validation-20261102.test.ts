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
import { generateObjectProposals, auditObjectPath } from '@/lib/route/objectProposals';
import { OBJECT_TEMPLATES } from '@/lib/route/objectTemplates';
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
  {area: 'cheonan-buldang', bbox: {south: 36.79, west: 127.10, north: 36.83, east: 127.15}},
  {area: 'jeonju-hyoja', bbox: {south: 35.80, west: 127.10, north: 35.84, east: 127.15}},
  {area: 'ulsan-samsan', bbox: {south: 35.52, west: 129.32, north: 35.56, east: 129.37}},
] as const;

function hashFile(file: string) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(4 * 1024 * 1024);
  const fd = openSync(file, 'r');
  try { let count: number; while ((count = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count)); }
  finally { closeSync(fd); }
  return hash.digest('hex');
}

it.skipIf(!process.env.ROAD_OBJECT_VALIDATION)('freezes new local-road areas and generates strictly valid natural and twelve-object candidates', () => {
  const started = performance.now();
  const folder = 'eval/recognition/road-ranker-20261102';
  const output = `${folder}/validation-v8.json`, progressFile = `${folder}/validation-v8.running.json`;
  const snapshotDir = 'data/fresh-v8-roads';
  const protocol = 'reports/road-ranker-20261102/protocol-v8.md';
  expect(existsSync(protocol), 'Register protocol-v8 before execution').toBe(true);
  expect(existsSync(output), 'Never overwrite final v8 output').toBe(false);
  expect(existsSync(progressFile), 'Preserve any earlier partial run').toBe(false);
  for (const {area} of AREAS) expect(existsSync(`${snapshotDir}/${area}-roads.json`), 'Preserve any existing fresh snapshot').toBe(false);
  mkdirSync(snapshotDir, {recursive: true});
  const dataDir = path.resolve('data/roads');
  const manifestBytes = readFileSync(path.join(dataDir, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString()) as {file: string; schema: string; timestamp: string};
  expect(manifest.schema).toBe('1');
  expect(manifest.file).toMatch(/^roads-[\w-]+\.sqlite$/);
  const dbFile = path.join(dataDir, manifest.file), dbStat = statSync(dbFile);
  process.stdout.write('[v8] Hashing read-only SQLite source\n');
  const sqliteSHA256 = hashFile(dbFile);
  const results: SourceRow[] = [];
  const counts: Array<Record<string, unknown>> = [];
  const naturalCounts: Array<Record<string, unknown>> = [];
  const sourceSnapshots: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  const graphs: Array<{area: string; bbox: BBox; g: RoadGraph; region: Region; roadHash: string; sourceFile: string}> = [];
  const areaErrors = new Map<string, string>();
  const templates = [...SHAPES.map(key => ({key, shape: SHAPE_BY_ID[key]})), ...OBJECT_TEMPLATES];
  expect(new Set(templates.map(t => t.key)).size).toBe(12);
  const legacyCoreSnapshot = 'reports/road-ranker-20261102/code-snapshots/objectProposals-v7.ts.txt';
  expect(sha(readFileSync(legacyCoreSnapshot))).toBe('c1069322455b7d96d86975f3310ea0a68c66924f1b8aa6a7e99cd65136f5f9f4');
  const provenance = {
    protocolSHA256: sha(readFileSync(protocol)), codeSHA256: sha(readFileSync('tests/eval/road-object-validation-20261102.test.ts')),
    generatorSHA256: sha(readFileSync('src/lib/route/globalSearch.ts')),
    graphCodeSHA256: sha(readFileSync('src/lib/route/graph.ts')), osmCodeSHA256: sha(readFileSync('src/lib/route/osm.ts')),
    loopCodeSHA256: sha(readFileSync('src/lib/route/loops.ts')), shapesSHA256: sha(readFileSync('src/lib/route/shapes.ts')),
    readerCodeSHA256: sha(readFileSync('src/lib/route/roadData.server.ts')),
    areas: AREAS, sqliteFile: dbFile, sqliteSHA256, sqliteBytes: dbStat.size,
    sqliteManifest: JSON.parse(manifestBytes.toString()), sqliteManifestSHA256: sha(manifestBytes), sourceSnapshots,
    detail: 'simple', excludeSteps: true, minMeters: 3000, maxMeters: 8000, maxRepeatRatio: .2,
    naturalSeed: 83721, naturalStepBudget: 2000, naturalMaxPerArea: 120,
    naturalSampling: 'first two valid edge-unique returned loops as baseline; then fixed path-hash order; new edge Jaccard<=0.8',
    shapeIds: templates.map(t => t.key), preserveHypotheses: false,
    coreSHA256: sha(readFileSync('src/lib/route/objectProposals.ts')),
    templatesModuleSHA256: sha(readFileSync('src/lib/route/objectTemplates.ts')),
    templatesSHA256: sha(JSON.stringify(templates)),
    legacyCoreSnapshot, legacyCoreSHA256: sha(readFileSync(legacyCoreSnapshot)),
    attempts: 60, fullRotation: true, rankBySimilarity: true, maxPoolPerCase: 8,
    requestedCases: 36, totalTestTimeoutMs: 1200000,
    budgetWarning: 'attempts60 caps initial routing seeds; coarseSeeds counts retained coarse seeds, not all coarse evaluations; local search adds evaluated calls. Not equal-budget to earlier regions.',
    humanRecognitionMeasured: false, semanticSelectionExecuted: false, holdoutV2Read: false,
    experiment: 'new-area candidate generation only; larger supplied bboxes; frozen v7 semantic selection performed separately',
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
    process.stdout.write(`[v8] NATURAL START ${area}\n`);
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
      graphs.push({area, bbox, g, region, roadHash, sourceFile});
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
        const id = `${area}-natural-v8-${exported + 1}`;
        results.push({id, area, baselineId: isBaseline ? id : null, source: 'natural-loop-v8', proposalShape: null,
          roadHash, sourceFile, edgeHash: checkedPath.edgeHash,
          geometryKey: JSON.stringify([area, roadHash, [...edges].sort().join('|')]), path: entry.path,
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
    process.stdout.write(`[v8] NATURAL DONE ${JSON.stringify(naturalCounts.at(-1))}\n`);
  }
  // All natural candidates precede all proposals; baseline markers stay on exactly first two valid loops.
  const naturalSnapshot = JSON.stringify(results);
  const sourceCount = results.length;
  for (const {area} of AREAS) {
    const state = graphs.find(g => g.area === area);
    process.stdout.write(`[v8] PROPOSALS START ${area} (12 templates, preserveHypotheses:false)\n`);
    if (!state) {
      for (const template of templates) {
        const count = {area, proposalShape: template.key, attempts: 60, preserveHypotheses: false,
          evaluated: 0, coarseSeeds: 0, returned: 0, added: 0, outputAdded: 0, duplicates: 0, outputDuplicates: 0,
          failures: {}, error: areaErrors.get(area) ?? 'area_graph_unavailable', partial: true, status: 'error',
          budgetBefore: null, budgetAfter: null, budgetExhausted: false, elapsedSeconds: 0};
        counts.push(count); save('running'); process.stdout.write(`[v8] SHAPE DONE ${JSON.stringify(count)}\n`);
      }
      continue;
    }
    const {g, region, roadHash, sourceFile} = state;
    const proposed = generateObjectProposals(g, region, templates, {
      area, roadHash, idPrefix: 'proposal-v8', attempts: 60, preserveHypotheses: false,
      onProgress: count => {
        counts.push({...count, outputAdded: null, outputDuplicates: null});
        save('running');
        process.stdout.write(`[v8] SHAPE DONE ${JSON.stringify(count)}\n`);
      },
    });
    const outputTally = new Map<string, {added: number; duplicates: number}>(templates.map(t => [t.key, {added: 0, duplicates: 0}]));
    for (const row of proposed.results) {
      const checked = auditObjectPath(g, region, row.path);
      expect(checked.valid, row.id).toBe(true);
      if (!checked.valid) continue;
      const edgeHash = sha(checked.edgeKey), key = `${area}:${edgeHash}`;
      const tally = outputTally.get(row.proposalShape)!;
      if (seen.has(key)) { tally.duplicates++; continue; }
      seen.add(key); tally.added++;
      results.push({...row, sourceFile, edgeHash, source: 'globalSearch-twelve-fixed-objects-v8'});
    }
    for (const count of counts.filter(c => c.area === area)) {
      const tally = outputTally.get(count.proposalShape as string)!;
      count.outputAdded = tally.added; count.outputDuplicates = tally.duplicates;
    }
    save('running');
    process.stdout.write(`[v8] PROPOSALS DONE ${area} ${JSON.stringify(Object.fromEntries(outputTally))}\n`);
  }
  expect(counts).toHaveLength(36);
  expect(JSON.stringify(results.slice(0, sourceCount))).toBe(naturalSnapshot);
  expect(results.length - sourceCount).toBeLessThanOrEqual(288);
  expect(new Set(results.map(r => r.id)).size).toBe(results.length);
  expect(new Set(results.map(r => `${r.area}:${r.edgeHash}`)).size).toBe(results.length);
  expect(new Set(results.map(r => r.geometryKey)).size).toBe(results.length);
  expect(counts.every(c => c.preserveHypotheses === false)).toBe(true);
  expect(counts.reduce((n, c) => n + Number(c.outputAdded), 0)).toBe(results.length - sourceCount);
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
  // A final filename is published only after all 36 requests and work/checks. Readers must not consume .running.json.
  save('complete');
  renameSync(progressFile, output);
  process.stdout.write(`[v8] COMPLETE ${JSON.stringify({requests: counts.length, natural: sourceCount, added: results.length - sourceCount,
    total: results.length, errors: counts.filter(c => c.error).length, seconds: (performance.now() - started) / 1000, outputSHA256: sha(readFileSync(output))})}\n`);
}, 1200000);
