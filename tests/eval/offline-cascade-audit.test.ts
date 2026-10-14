import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, turnStats, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.CASCADE_AUDIT)('independently audits completed cascade outputs with unique exact-coordinate road mappings', () => {
  const dir = path.resolve('eval/recognition/route-improvement/offline-cascade-20261013');
  const source = path.resolve('eval/recognition/llm-routes-20261010');
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const originalBoxes: Record<string, BBox> = {
    gwangalli: { south: 35.143, west: 129.1, north: 35.166, east: 129.128 },
    seomyeon: { south: 35.145, west: 129.048, north: 35.17, east: 129.076 },
    gangnam: { south: 37.49, west: 127.02, north: 37.515, east: 127.051 },
  };
  const full = process.env.CASCADE_AUDIT_FULL === '1';
  const protocol = JSON.parse(readFileSync(path.join(dir, full ? 'full-protocol-before-run.json' : 'pilot-protocol-before-run.json'), 'utf8'));
  // This audits generated candidates, never searches or repairs the outputs.
  for (const [file, digest] of Object.entries(protocol.codeHashes)) expect(sha(readFileSync(file, 'utf8'))).toBe(digest);
  const files = readdirSync(dir).filter(f => /^(gwangalli|seomyeon|gangnam)-(square|heart|star|cat)\.json$/.test(f));
  expect(files.length).toBeGreaterThanOrEqual(Number(process.env.CASCADE_AUDIT_MIN ?? 1));
  if (full) expect(files.sort()).toEqual(Object.keys(originalBoxes).flatMap(area => ['square', 'heart', 'star', 'cat'].map(shape => `${area}-${shape}.json`)).sort());
  const cases = [];
  for (const file of files) {
    const row = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
    expect(row.caseId).toBe(file.replace(/\.json$/, ''));
    const area = row.caseId.split('-')[0];
    expect(row.bbox).toEqual(originalBoxes[area]);
    expect(row.candidate.shapeId).toBe(row.caseId.split('-')[1]);
    expect(row.cold.candidate.shapeId).toBe(row.candidate.shapeId);
    const roadText = readFileSync(path.join(source, `${area}-roads.json`), 'utf8');
    expect(sha(roadText)).toBe(row.sourceHash);
    expect(row.generatedFromRoads).toBe(true);
    expect(row.generationCacheReused).toBe(false);
    expect(row.cacheKey).toBe(sha(JSON.stringify({ codeHashes: protocol.codeHashes, paramsHash: protocol.paramsHash, roadHash: sha(roadText), sourceProtocolHash: protocol.sourceProtocolHash, shapeId: row.candidate.shapeId, bbox: row.bbox })));
    const box = row.bbox as BBox;
    const g = graphFromOverpass(JSON.parse(roadText), box, { detail: 'simple', excludeSteps: true });
    const [minX, minY] = project(g.origin, box.south, box.west);
    const [maxX, maxY] = project(g.origin, box.north, box.east);
    const index = new Map<string, number[]>();
    const key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
    for (let v = 0; v < g.n; v++) { const k = key(g.lat[v], g.lon[v]); index.set(k, [...(index.get(k) ?? []), v]); }
    const nodesFor = (c: RouteCandidate) => c.latlngs.map(([lat, lon]) => {
      const ids = index.get(key(lat, lon)); expect(ids?.length).toBe(1);
      const v = ids![0]; expect(g.lat[v]).toBeCloseTo(lat, 10); expect(g.lon[v]).toBeCloseTo(lon, 10); return v;
    });
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
    let audited = 0;
    const recomputedRaw: number[] = [];
    let finalComponents: { scale: number; meanDeviationMeters: number; normalizedDeviation: number; zigzagPerKm: number; zigzagLogPenalty: number; featureCoverage: number; spikes: number; lengthMeters: number; rawSharp: number; rdpSharp: number; rawAngleSumRadians: number } | null = null;
    for (const c of [row.cold.candidate, row.candidate, ...row.pool] as RouteCandidate[]) {
      const nodes = nodesFor(c); expect(nodes[0]).toBe(nodes.at(-1));
      expect(nodes.every((v, i) => g.x[v] >= minX && g.x[v] <= maxX && g.y[v] >= minY && g.y[v] <= maxY && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
      expect(placeShape(shape.points, c.placement).every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY)).toBe(true);
      const e = evaluatePath(g, shape, c.placement, nodes, 3000, 8000);
      expect(e.similarity).toBe(c.similarity); expect(e.lengthMeters).toBeGreaterThanOrEqual(3000); expect(e.lengthMeters).toBeLessThanOrEqual(8000); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
      const quality = e.meanDev / (.08 * c.placement.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
      recomputedRaw.push(100 * Math.exp(-quality));
      if (audited === 1) {
        const xy = nodes.map(v => [g.x[v], g.y[v]] as [number, number]);
        let rawAngleSumRadians = 0;
        for (let i = 1; i < xy.length - 1; i++) {
          const dx = xy[i][0] - xy[i - 1][0], dy = xy[i][1] - xy[i - 1][1], ex = xy[i + 1][0] - xy[i][0], ey = xy[i + 1][1] - xy[i][1];
          rawAngleSumRadians += Math.acos(Math.max(-1, Math.min(1, (dx * ex + dy * ey) / (Math.hypot(dx, dy) * Math.hypot(ex, ey) || 1))));
        }
        finalComponents = { scale: c.placement.scale, meanDeviationMeters: e.meanDev, normalizedDeviation: e.meanDev / (.08 * c.placement.scale), zigzagPerKm: e.zigzagPerKm, zigzagLogPenalty: Math.log1p(.03 * e.zigzagPerKm), featureCoverage: e.featureCoverage, spikes: e.spikes, lengthMeters: e.lengthMeters, rawSharp: turnStats(xy, 0).sharp, rdpSharp: turnStats(xy, 10).sharp, rawAngleSumRadians };
      }
      audited++;
    }
    expect(recomputedRaw[0]).toBeCloseTo(row.cold.raw, 8);
    expect(recomputedRaw[1]).toBeCloseTo(row.raw, 8);
    expect(row.raw).toBeGreaterThanOrEqual(row.cold.raw - 1e-8);
    const current = nodesFor(row.candidate), cold = nodesFor(row.cold.candidate);
    if (row.raw > row.cold.raw + 1e-7) {
      expect(current).toEqual(pairPhaseZero(g, shape, row.candidate.placement, current));
      if (pairEdgeKey(current) === pairEdgeKey(cold)) expect(row.candidate.placement).not.toEqual(row.cold.candidate.placement);
    }
    cases.push({ caseId: row.caseId, before: row.cold.candidate.similarity, after: row.candidate.similarity, beforeRaw: recomputedRaw[0], afterRaw: recomputedRaw[1], finalComponents, audited, exactUniqueMapping: true });
  }
  const summary = { count: cases.length, beforeAverage: cases.reduce((s, c) => s + c.before, 0) / cases.length, afterAverage: cases.reduce((s, c) => s + c.after, 0) / cases.length, beforeRawAverage: cases.reduce((s, c) => s + c.beforeRaw, 0) / cases.length, afterRawAverage: cases.reduce((s, c) => s + c.afterRaw, 0) / cases.length };
  if (full) {
    const generated = JSON.parse(readFileSync(path.join(dir, 'results.json'), 'utf8'));
    expect(generated.summary.caseCount).toBe(12); expect(generated.summary.denominator).toBe(12);
    expect(generated.summary.failures).toBe(0); expect(generated.summary.reusedGenerationCaches).toBe(0);
    expect(summary.beforeAverage).toBe(generated.summary.coldAverage); expect(summary.afterAverage).toBe(generated.summary.afterAverage);
    expect(summary.beforeRawAverage).toBeCloseTo(generated.summary.coldRawAverage, 8); expect(summary.afterRawAverage).toBeCloseTo(generated.summary.afterRawAverage, 8);
  }
  writeFileSync(path.join(dir, full ? 'independent-full-exact-audit.json' : 'independent-exact-audit.json'), JSON.stringify({ cases, summary, completeOriginalTwelve: full && cases.length === 12, noSearchOrRepair: true, auditorHash: sha(readFileSync('tests/eval/offline-cascade-audit.test.ts', 'utf8')) }, null, 2));
}, 120000);
