import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { StepBudget } from '@/lib/route/budget';
import { hasEdge, project, type RoadGraph } from '@/lib/route/graph';
import { buildBlocks, growLoops, type NaturalLoop, type Region } from '@/lib/route/loops';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { normalizeRoadReferenceInput, normalizeRoadReferenceRenderLine } from '@/lib/art/roadReference';

type XY = [number, number];
const areas: Array<{ id: string; bbox: BBox }> = [
  { id: 'gwangalli', bbox: { south: 35.143, west: 129.100, north: 35.166, east: 129.128 } },
  { id: 'seomyeon', bbox: { south: 35.145, west: 129.048, north: 35.170, east: 129.076 } },
  { id: 'gangnam', bbox: { south: 37.490, west: 127.020, north: 37.515, east: 127.051 } },
];
const params = { seed: 83721, faceSeeds: 2000, budgetUnits: 2000, budgetFraction: 1, minMeters: 3000, maxMeters: 8000, repeatMax: .2, perArea: 2, spatialFractionPreferred: .10, pairWeights: { spatial: .40, length: .20, complexity: .20, compactness: .10, aspect: .10 }, imagePixels: 512, strokePixels: 3 } as const;
const fixedRoadHashes: Record<string, string> = { gwangalli: 'e31aa49adb02b6ec5e74759ad5fb3b2111084013df6ff48391ebd88d42ddf828', seomyeon: 'a0cfff6d6c89046910ed26f36bc6a56bc3671d65dfb341af33303f0e11e785c0', gangnam: '3263a3fc9739978d75a7ef73b3b793100b9aa4372c07a14d2c5730ef6caf9df5' };
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const edgeKey = (a: number, b: number) => a < b ? a + ':' + b : b + ':' + a;

function auditLoop(g: RoadGraph, region: Region, loop: NaturalLoop) {
  const nodes = loop.path, inside = (v: number) => v >= 0 && v < g.n && g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY;
  if (nodes.length < 4 || nodes[0] !== nodes.at(-1)) return { valid: false as const, reason: 'not-closed' };
  if (!nodes.every(inside)) return { valid: false as const, reason: 'outside-original-roi' };
  let nativeMeters = 0, projectedMeters = 0, nativeRepeatedMeters = 0, projectedRepeatedMeters = 0;
  const counts = new Map<string, number>();
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i]; if (!hasEdge(g, a, b)) return { valid: false as const, reason: 'nonexistent-edge' };
    let native = -1; for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) { native = g.adjLen[e]; break; }
    const projected = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]), key = edgeKey(a, b), previous = counts.get(key) ?? 0;
    nativeMeters += native; projectedMeters += projected;
    if (previous) { nativeRepeatedMeters += native; projectedRepeatedMeters += projected; }
    counts.set(key, previous + 1);
  }
  const nativeRepeatRatio = nativeRepeatedMeters / nativeMeters, projectedRepeatRatio = projectedRepeatedMeters / projectedMeters;
  if (nativeMeters < 3000 || nativeMeters > 8000 || projectedMeters < 3000 || projectedMeters > 8000) return { valid: false as const, reason: 'native-or-projected-distance' };
  if (nativeRepeatRatio > .2 || projectedRepeatRatio > .2) return { valid: false as const, reason: 'native-or-projected-repeat' };
  expect(projectedMeters).toBeCloseTo(loop.length, 6);
  const polygon = nodes.slice(0, -1); let doubleArea = 0, centerXNumerator = 0, centerYNumerator = 0, sharpTurns = 0, absoluteTurn = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], previous = polygon[(i + polygon.length - 1) % polygon.length], cross = g.x[a] * g.y[b] - g.x[b] * g.y[a];
    doubleArea += cross; centerXNumerator += (g.x[a] + g.x[b]) * cross; centerYNumerator += (g.y[a] + g.y[b]) * cross;
    const dx = g.x[a] - g.x[previous], dy = g.y[a] - g.y[previous], ex = g.x[b] - g.x[a], ey = g.y[b] - g.y[a], turn = Math.abs(Math.atan2(dx * ey - dy * ex, dx * ex + dy * ey));
    absoluteTurn += turn; if (turn >= Math.PI / 4) sharpTurns++;
  }
  const xs = polygon.map(v => g.x[v]), ys = polygon.map(v => g.y[v]), width = Math.max(...xs) - Math.min(...xs), height = Math.max(...ys) - Math.min(...ys);
  if (Math.abs(doubleArea) < 1e-8 || !width || !height) return { valid: false as const, reason: 'degenerate-polygon' };
  const geometry = [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => k + '=' + n).join(',');
  return { valid: true as const, nativeMeters, projectedMeters, nativeRepeatRatio, projectedRepeatRatio, closed: true, actualEdges: true, originalROI: true, nodes, faces: loop.faces, geometryKey: geometry, geometryHash: sha(geometry), cx: centerXNumerator / (3 * doubleArea), cy: centerYNumerator / (3 * doubleArea), areaMeters2: Math.abs(doubleArea) / 2, compactness: 2 * Math.PI * Math.abs(doubleArea) / (projectedMeters * projectedMeters), complexity: absoluteTurn / (2 * Math.PI), sharpTurns, logAspect: Math.log(width / height), nodeCount: nodes.length };
}
type ValidLoop = Extract<ReturnType<typeof auditLoop>, { valid: true }>;

function diversePair(pool: ValidLoop[], region: Region) {
  expect(pool.length).toBeGreaterThanOrEqual(2);
  const diagonal = Math.hypot(region.maxX - region.minX, region.maxY - region.minY), complexityMin = Math.min(...pool.map(c => c.complexity)), complexityRange = Math.max(...pool.map(c => c.complexity)) - complexityMin;
  const compactnessRange = Math.max(...pool.map(c => c.compactness)) - Math.min(...pool.map(c => c.compactness)), aspectRange = Math.max(...pool.map(c => c.logAspect)) - Math.min(...pool.map(c => c.logAspect));
  let best: { a: ValidLoop; b: ValidLoop; distanceMeters: number; metric: number; spatialPreferred: boolean } | undefined;
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j], distanceMeters = Math.hypot(a.cx - b.cx, a.cy - b.cy), spatial = distanceMeters / diagonal, spatialPreferred = spatial >= params.spatialFractionPreferred;
    const w = params.pairWeights, metric = w.spatial * spatial + w.length * Math.abs(a.nativeMeters - b.nativeMeters) / 5000 + w.complexity * Math.abs(a.complexity - b.complexity) / Math.max(1e-12, complexityRange) + w.compactness * Math.abs(a.compactness - b.compactness) / Math.max(1e-12, compactnessRange) + w.aspect * Math.abs(a.logAspect - b.logAspect) / Math.max(1e-12, aspectRange);
    if (!best || (spatialPreferred && !best.spatialPreferred) || (spatialPreferred === best.spatialPreferred && metric > best.metric + 1e-12)) best = { a, b, distanceMeters, metric, spatialPreferred };
  }
  expect(best).toBeDefined(); expect(best!.a.geometryHash).not.toBe(best!.b.geometryHash);
  return best!;
}

it.skipIf(!process.env.ROAD_FIRST_REFERENCE_INPUTS)('builds six anonymous real road loops without a shape template or expected name', async () => {
  const out = path.resolve('eval/recognition/road-first-reference-20261014/inputs');
  if (existsSync(path.join(out, 'complete.json')) || existsSync(path.join(out, 'packets.json'))) throw new Error('Refusing to overwrite completed road-first inputs');
  mkdirSync(path.join(out, 'private-sources'), { recursive: true });
  const files = ['tests/eval/road-first-reference-inputs-20261014.test.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/loops.ts', 'src/lib/route/budget.ts', 'src/lib/art/roadReference.ts', 'src/lib/route/shapes.ts'];
  const codeHashes = Object.fromEntries(files.map(file => { const bytes = readFileSync(file); writeFileSync(path.join(out, 'private-sources', path.basename(file) + '.source'), bytes); return [file, sha(bytes)]; }));
  const roadHashes = Object.fromEntries(areas.map(area => [area.id, sha(readFileSync('eval/recognition/llm-routes-20261010/' + area.id + '-roads.json'))]));
  expect(roadHashes).toEqual(fixedRoadHashes);
  const protocol = { denominator: 6, anonymousIds: true, generatedFromRoads: true, nonguidedGeneration: 'original-buildBlocks-growLoops', originalRegionsUnchanged: true, originalNativeDistanceConstraints: true, minMeters: 3000, maxMeters: 8000, repeatMax: .2, bothNativeAndProjectedConstraints: true, wholePoolSelection: true, selectionUsesOnlyUnlabelledGeometryAndSpace: true, fixedTemplatesUsed: false, storedQualityCandidateUsed: false, expectedNamesUsed: false, originalTwelveBenchmarkReplaced: false, originalMean80Proof: false, holdoutRead: false, coordinateSpace: 'normalized-route-xy-v1', imageOnlyActualOriginalVertices: true, numericPacketIsNotARunnableRoute: true, imagePixels: 512, imageStyle: 'white-background-black-polyline-only' };
  const privateProtocol = { ...protocol, areas, params, codeHashes, roadHashes, coordinatePacketSource: 'normalizeRoadReferenceInput', fullNativeRenderSource: 'normalizeRoadReferenceRenderLine', sharpVersions: sharp.versions };
  writeFileSync(path.join(out, 'protocol-before-run.private.json'), JSON.stringify(privateProtocol, null, 2));
  const candidates: Array<{ packet: ReturnType<typeof normalizeRoadReferenceInput>; image: string; renderLine: XY[] }> = [], auditCases = [], areaDiagnostics = []; const began = Date.now();
  for (const area of areas) {
    const road = readFileSync('eval/recognition/llm-routes-20261010/' + area.id + '-roads.json'); expect(sha(road)).toBe(roadHashes[area.id]);
    const g = graphFromOverpass(JSON.parse(road.toString()), area.bbox, { detail: 'simple', excludeSteps: true }), [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
    const blocks = buildBlocks(g, (maxX - minX) * (maxY - minY) / 4), budget = new StepBudget(params.budgetUnits), generated = growLoops(g, blocks, region, 3000, 8000, { seeds: Math.min(params.faceSeeds, blocks.faces.length), budget, fraction: 1, seed: params.seed });
    const distinct = new Map<string, ValidLoop>(), invalid: Record<string, number> = {};
    for (const loop of generated) { const audited = auditLoop(g, region, loop); if (audited.valid) { if (!distinct.has(audited.geometryKey)) distinct.set(audited.geometryKey, audited); } else invalid[audited.reason] = (invalid[audited.reason] ?? 0) + 1; }
    const pool = [...distinct.values()].sort((a, b) => a.geometryHash.localeCompare(b.geometryHash)), pair = diversePair(pool, region);
    areaDiagnostics.push({ area: area.id, blockCount: blocks.faces.length, growthSeedAttempts: budget.spent, generatedCount: generated.length, validDistinctCount: pool.length, invalid, selectedPairMetric: pair.metric, selectedCentroidDistanceMeters: pair.distanceMeters, selectedSpatialPreferenceSatisfied: pair.spatialPreferred, allValidPool: pool.map(c => ({ geometryHash: c.geometryHash, nativeMeters: c.nativeMeters, projectedMeters: c.projectedMeters, compactness: c.compactness, complexity: c.complexity, logAspect: c.logAspect, cx: c.cx, cy: c.cy })) });
    for (const selected of [pair.a, pair.b]) {
      const id: string = 'road-' + String(candidates.length + 1).padStart(2, '0'), latlngs: XY[] = selected.nodes.map(v => [g.lat[v], g.lon[v]]), input = { id, latlngs }, packet = normalizeRoadReferenceInput(input), renderLine = normalizeRoadReferenceRenderLine(input);
      expect(packet.candidateId).toBe(id); expect(packet.coordinateSpace).toBe('normalized-route-xy-v1'); expect(packet).toEqual(normalizeRoadReferenceInput(input)); expect(renderLine).toEqual(normalizeRoadReferenceRenderLine(input));
      expect(renderLine).toHaveLength(selected.nodes.length); expect(renderLine[0]).toEqual(renderLine.at(-1)); expect(packet.route[0]).toEqual(packet.route.at(-1));
      expect(packet.route.length).toBeLessThanOrEqual(256); if (selected.nodes.length <= 256) expect(packet.route).toEqual(renderLine);
      expect(renderLine.every(p => p.every(value => Number.isFinite(value) && value >= .1 - 1e-6 && value <= .9 + 1e-6))).toBe(true);
      const d = renderLine.map(([x, y], i) => (i ? 'L' : 'M') + (x * 512).toFixed(6) + ',' + (y * 512).toFixed(6)).join(' '), svg = '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" fill="white"/><path d="' + d + ' Z" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg>';
      const png = await sharp(Buffer.from(svg)).flatten({ background: '#fff' }).png().toBuffer(), image = id + '.png'; writeFileSync(path.join(out, image), png); writeFileSync(path.join(out, id + '.json'), JSON.stringify(packet, null, 2));
      const imageMeta = await sharp(png).metadata(); expect(imageMeta.width).toBe(512); expect(imageMeta.height).toBe(512);
      const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true }); expect(info.channels).toBe(3);
      let darkPixels = 0, colorPixels = 0; for (let i = 0; i < data.length; i += 3) { if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) colorPixels++; if (data[i] < 128) darkPixels++; }
      expect(darkPixels).toBeGreaterThan(512); expect(colorPixels).toBe(0);
      candidates.push({ packet, image, renderLine });
      auditCases.push({ id, area: area.id, bbox: area.bbox, roadHash: roadHashes[area.id], graphOrigin: g.origin, originalNativeNodes: selected.nodes, originalLatlngs: latlngs, originalFaces: selected.faces, nativeMeters: selected.nativeMeters, projectedMeters: selected.projectedMeters, nativeRepeatRatio: selected.nativeRepeatRatio, projectedRepeatRatio: selected.projectedRepeatRatio, actualEdges: selected.actualEdges, closed: selected.closed, originalROI: selected.originalROI, geometryHash: selected.geometryHash, complexity: selected.complexity, compactness: selected.compactness, centroid: [selected.cx, selected.cy], packetFingerprint: packet.fingerprint, packetRoutePointCount: packet.route.length, fullRenderPointCount: renderLine.length, packetResampledForNumericDescriptionOnly: packet.route.length < renderLine.length, pngHash: sha(png), svgHash: sha(svg), noExpectedLabel: true });
      writeFileSync(path.join(out, 'progress.private.json'), JSON.stringify({ anonymousInputsWritten: candidates.length, elapsedMs: Date.now() - began }));
    }
  }
  expect(candidates).toHaveLength(6); expect(new Set(candidates.map(c => c.packet.candidateId)).size).toBe(6);
  for (const file of files) expect(sha(readFileSync(file))).toBe(codeHashes[file]);
  for (const area of areas) expect(sha(readFileSync('eval/recognition/llm-routes-20261010/' + area.id + '-roads.json'))).toBe(roadHashes[area.id]);
  const audit = { protocol: privateProtocol, cases: auditCases, areaDiagnostics, sourceHashesStable: true, elapsedMs: Date.now() - began };
  writeFileSync(path.join(out, 'audit.json'), JSON.stringify(audit, null, 2)); writeFileSync(path.join(out, 'packets.json'), JSON.stringify({ protocol, candidates }, null, 2));
  writeFileSync(path.join(out, 'complete.json'), JSON.stringify({ denominator: 6, verified: true, packetsSha256: sha(readFileSync(path.join(out, 'packets.json'))), privateAuditSha256: sha(readFileSync(path.join(out, 'audit.json'))), noOriginalMean80Proof: true, holdoutRead: false, elapsedMs: Date.now() - began }, null, 2));
  console.log(JSON.stringify({ anonymousInputs: candidates.length, originalBenchmarkUnchanged: true, sourceHashesStable: true, holdoutRead: false, elapsedMs: Date.now() - began }));
}, 1800000);
