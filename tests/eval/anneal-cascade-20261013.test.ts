import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { annealLoopSearch } from '@/lib/route/annealLoopSearch';
import { evaluatePath, placeShape, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.ANNEAL_CASCADE)('tests annealing after the completed automatic cascade on all original twelve cases', () => {
  const root = path.resolve('eval/recognition/route-improvement');
  const out = path.join(root, 'anneal-cascade-20261013'); mkdirSync(out, { recursive: true });
  const inputText = readFileSync(path.join(root, 'offline-cascade-20261013/results.json'), 'utf8');
  const input = JSON.parse(inputText) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; pool: RouteCandidate[]; raw: number; sourceHash: string }> };
  expect(input.cases).toHaveLength(12);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const params = { seed: 0xA11E2026, proposalBudget: 2000, maxSeeds: 3, temperatureStart: .03, temperatureEnd: .003, refitTopCount: 8, refitEvaluationsPerPath: 120 };
  const codeHashes = Object.fromEntries(['tests/eval/anneal-cascade-20261013.test.ts', 'src/lib/route/annealLoopSearch.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/loops.ts', 'src/lib/route/shapes.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/art/rdp.ts'].map(f => [f, sha(readFileSync(f, 'utf8'))]));
  const protocol = { inputHash: sha(inputText), codeHashes, params, denominator: 12, originalScore: true, extraStageAfterAutomaticCascade: true, storedManualBestUsed: false, fromRoadsRerun: false, holdoutRead: false };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const cases = [];
  for (const row of input.cases) {
    const area = row.caseId.split('-')[0], text = readFileSync(path.resolve(`eval/recognition/llm-routes-20261010/${area}-roads.json`), 'utf8');
    expect(sha(text)).toBe(row.sourceHash);
    const g = graphFromOverpass(JSON.parse(text), row.bbox, { detail: 'simple', excludeSteps: true });
    const [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY };
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], index = new Map<string, number[]>();
    const key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
    for (let v = 0; v < g.n; v++) { const k = key(g.lat[v], g.lon[v]); index.set(k, [...(index.get(k) ?? []), v]); }
    const nodesFor = (c: RouteCandidate) => c.latlngs.map(([lat, lon]) => { const ids = index.get(key(lat, lon)); expect(ids?.length).toBe(1); return ids![0]; });
    const rawFor = (c: RouteCandidate) => {
      const nodes = nodesFor(c); expect(nodes[0]).toBe(nodes.at(-1));
      expect(nodes.every((v, i) => g.x[v] >= minX && g.x[v] <= maxX && g.y[v] >= minY && g.y[v] <= maxY && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
      expect(placeShape(shape.points, c.placement).every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY)).toBe(true);
      const e = evaluatePath(g, shape, c.placement, nodes, 3000, 8000); expect(e.similarity).toBe(c.similarity);
      expect(e.lengthMeters).toBeGreaterThanOrEqual(3000); expect(e.lengthMeters).toBeLessThanOrEqual(8000); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
      return 100 * Math.exp(-e.meanDev / (.08 * c.placement.scale) - Math.log1p(.03 * e.zigzagPerKm) + Math.log(.55 + .45 * e.featureCoverage) + e.spikes * Math.log(.9));
    };
    expect(rawFor(row.candidate)).toBeCloseTo(row.raw, 8);
    writeFileSync(path.join(out, `${row.caseId}-progress.json`), JSON.stringify({ caseId: row.caseId, stage: 'anneal-after-cascade' }));
    const began = Date.now(), result = annealLoopSearch(g, shape, region, [row.candidate, ...row.pool], params, 3000, 8000);
    expect(result.candidate).not.toBeNull();
    const candidate = result.candidate!, raw = rawFor(candidate); expect(raw).toBeGreaterThanOrEqual(row.raw - 1e-8);
    if (raw > row.raw + 1e-7) {
      const nodes = nodesFor(candidate); expect(nodes).toEqual(pairPhaseZero(g, shape, candidate.placement, nodes));
      expect(pairEdgeKey(nodes)).not.toBe(pairEdgeKey(nodesFor(row.candidate)));
      expect(raw).toBeGreaterThan(result.canonicalInputBestRaw);
    }
    const output = { ...result, caseId: row.caseId, before: row.candidate.similarity, after: candidate.similarity, beforeRaw: row.raw, afterRaw: raw, elapsedMs: Date.now() - began };
    cases.push(output); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(output, null, 2));
  }
  const summary = { count: cases.length, beforeAverage: cases.reduce((s, c) => s + c.before, 0) / 12, afterAverage: cases.reduce((s, c) => s + c.after, 0) / 12, beforeRawAverage: cases.reduce((s, c) => s + c.beforeRaw, 0) / 12, afterRawAverage: cases.reduce((s, c) => s + c.afterRaw, 0) / 12, improvements: cases.filter(c => c.afterRaw > c.beforeRaw + 1e-7).length, elapsedMs: cases.reduce((s, c) => s + c.elapsedMs, 0) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
