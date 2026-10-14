import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { exactRoadPortGraph, encodeExactRoadPath, expandExactRoadPath } from '@/lib/route/exactRoadPortGraph';
import { evaluatePath, type RouteCandidate } from '@/lib/route/fit';
import { project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.EXACT_ROAD_PORT_AUDIT)('preserves every inside edge and all twelve automatic paths exactly', () => {
  const out = path.resolve('eval/recognition/route-improvement/exact-road-port-graph-20261013'); mkdirSync(out, { recursive: true });
  const hash = (s: Buffer) => createHash('sha256').update(s).digest('hex');
  const inputPath = 'eval/recognition/route-improvement/offline-cascade-20261013/results.json', inputBytes = readFileSync(inputPath);
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; sourceHash: string }> }; expect(input.cases).toHaveLength(12);
  const cases = [];
  for (const row of input.cases) {
    const area = row.caseId.split('-')[0], road = readFileSync(`eval/recognition/llm-routes-20261010/${area}-roads.json`); expect(hash(road)).toBe(row.sourceHash);
    const g = graphFromOverpass(JSON.parse(road.toString()), row.bbox, { detail: 'simple', excludeSteps: true });
    const [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY };
    const pg = exactRoadPortGraph(g, region), inside = (v: number) => g.x[v] >= minX && g.x[v] <= maxX && g.y[v] >= minY && g.y[v] <= maxY;
    let directedCount = 0;
    for (let v = 0; v < g.n; v++) if (inside(v)) for (let j = g.adjStart[v]; j < g.adjStart[v + 1]; j++) if (inside(g.adjTo[j])) { directedCount++; expect(pg.directedLocations.has(`${v}:${g.adjTo[j]}`)).toBe(true); }
    expect(pg.insideEdgeCount * 2).toBe(directedCount);
    for (const e of pg.edges) { let sum = 0; for (let i = 1; i < e.nodes.length; i++) { const a = e.nodes[i - 1], b = e.nodes[i]; let j = g.adjStart[a]; while (j < g.adjStart[a + 1] && g.adjTo[j] !== b) j++; expect(j).toBeLessThan(g.adjStart[a + 1]); sum += g.adjLen[j]; } expect(e.lengthMeters).toBe(sum); }
    const index = new Map<string, number[]>(), key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
    for (let v = 0; v < g.n; v++) { const k = key(g.lat[v], g.lon[v]); index.set(k, [...(index.get(k) ?? []), v]); }
    const ns = row.candidate.latlngs.map(([lat, lon]) => { const ids = index.get(key(lat, lon)); expect(ids).toHaveLength(1); const v = ids![0]; expect(Math.abs(g.lat[v] - lat)).toBeLessThan(1e-10); expect(Math.abs(g.lon[v] - lon)).toBeLessThan(1e-10); return v; });
    const spans = encodeExactRoadPath(pg, ns), expanded = expandExactRoadPath(pg, spans); expect(expanded).toEqual(ns);
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId]; expect(evaluatePath(g, shape, row.candidate.placement, expanded, 3000, 8000)).toEqual(evaluatePath(g, shape, row.candidate.placement, ns, 3000, 8000));
    const loop = ns.slice(0, -1), turns = loop.map((b, i) => { const a = loop[(i + loop.length - 1) % loop.length], c = loop[(i + 1) % loop.length]; return Math.atan2((g.x[b] - g.x[a]) * (g.y[c] - g.y[b]) - (g.y[b] - g.y[a]) * (g.x[c] - g.x[b]), (g.x[b] - g.x[a]) * (g.x[c] - g.x[b]) + (g.y[b] - g.y[a]) * (g.y[c] - g.y[b])) * 180 / Math.PI; });
    const signedArea = loop.reduce((s, v, i) => { const w = loop[(i + 1) % loop.length]; return s + g.x[v] * g.y[w] - g.x[w] * g.y[v]; }, 0), significant = turns.filter(a => Math.abs(a) >= 1), histogram: Record<string, number> = {};
    for (const v of new Set(loop)) histogram[pg.degree[v]] = (histogram[pg.degree[v]] ?? 0) + 1;
    cases.push({ caseId: row.caseId, graphPorts: pg.ports.length, graphMacroEdges: pg.edges.length, insideEdges: pg.insideEdgeCount, coverage: 1, orderedPathPreserved: true, nativeLengthsPreserved: true, pathMacroSpans: spans.length, pathDistinctMacroEdges: new Set(spans.map(s => s.edgeId)).size, fullNodeCount: ns.length, turnThresholdDegrees: 1, positiveTurns: significant.filter(a => a > 0).length, negativeTurns: significant.filter(a => a < 0).length, concaveTurns: significant.filter(a => a * signedArea < 0).length, signedTurnSum: turns.reduce((s, a) => s + a, 0), branchDegreeHistogram: histogram, spans });
  }
  const codeHashes = Object.fromEntries(['src/lib/route/exactRoadPortGraph.ts', 'tests/exact-road-port-graph.test.ts', 'tests/eval/exact-road-port-graph-20261013.test.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/fit.ts', 'src/lib/route/shapes.ts'].map(f => { const bytes = readFileSync(f); writeFileSync(path.join(out, `${path.basename(f)}.source`), bytes); return [f, hash(bytes)]; }));
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol: { inputHash: hash(inputBytes), codeHashes, originalGraphOnly: true, originalScore: true, holdoutRead: false, noSearch: true, noQualityGainClaim: true }, cases }, null, 2));
});
