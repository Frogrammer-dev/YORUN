import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { rdpIndices } from '@/lib/art/rdp';
import { evaluatePath, placeShape, turnStats, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, pointSegDist, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { polylineLength, resample, SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

type XY = [number, number];
function nearest(p: XY, line: XY[]) {
  let distance = Infinity, segment = -1;
  for (let i = 1; i < line.length; i++) {
    const d = pointSegDist(...p, ...line[i - 1], ...line[i]);
    if (d < distance) { distance = d; segment = i - 1; }
  }
  return { distance, segment };
}
function samples(line: XY[]) { return resample(line, Math.max(8, Math.round(polylineLength(line) / 12))); }

it.skipIf(!process.env.BEND_DIAGNOSIS)('audits fixed incumbent bends and bidirectional sample errors without new route search', () => {
  const root = path.resolve('eval/recognition/route-improvement'), source = path.resolve('eval/recognition/llm-routes-20261010');
  const inputText = readFileSync(path.join(root, 'combined-strict-v11/results.json'), 'utf8');
  const rows = JSON.parse(inputText) as Array<{ caseId: string; candidate: RouteCandidate }>;
  const areas = (JSON.parse(readFileSync(path.join(source, 'round2-results.json'), 'utf8')) as { protocol: { areas: Array<{ id: string; bbox: BBox }> } }).protocol.areas;
  const folder = path.join(root, 'bend-diagnosis-20261012'); mkdirSync(folder, { recursive: true });
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const results = rows.map(row => {
    const area = areas.find(a => row.caseId.startsWith(`${a.id}-`))!;
    const text = readFileSync(path.join(source, `${area.id}-roads.json`), 'utf8');
    const g = graphFromOverpass(JSON.parse(text), area.bbox, { detail: 'simple', excludeSteps: true });
    const c = row.candidate, shape = SHAPE_BY_ID[c.shapeId as ShapeId];
    const nodes = c.latlngs.map(([lat, lon]) => g.nodeIndex.nearest(...project(g.origin, lat, lon), .5));
    expect(nodes.every((v, i) => v >= 0 && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
    expect(nodes[0]).toBe(nodes.at(-1));
    const route: XY[] = nodes.map(v => [g.x[v], g.y[v]]), outline = placeShape(shape.points, c.placement), features = placeShape(shape.features, c.placement);
    const e = evaluatePath(g, shape, c.placement, nodes, 3000, 8000);
    expect(e.similarity).toBe(c.similarity); expect(e.repeatRatio).toBeLessThanOrEqual(.2);
    const cumulative = [0]; for (let i = 1; i < route.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]));
    const keep = rdpIndices(route, 10), turns = [];
    for (let k = 1; k < keep.length - 1; k++) {
      const a = route[keep[k - 1]], b = route[keep[k]], d = route[keep[k + 1]];
      let angle = (Math.atan2(d[1] - b[1], d[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180 / Math.PI;
      while (angle > 180) angle -= 360; while (angle < -180) angle += 360;
      if (Math.abs(angle) < 45) continue;
      const featureDistances = features.map(p => Math.hypot(b[0] - p[0], b[1] - p[1]));
      turns.push({ pathIndex: keep[k], node: nodes[keep[k]], meters: cumulative[keep[k]], angle, xy: b, latlng: c.latlngs[keep[k]], matchedContour: nearest(b, outline), nearestFeature: featureDistances.indexOf(Math.min(...featureDistances)), featureDistanceMeters: Math.min(...featureDistances), withinFeatureTolerance: Math.min(...featureDistances) <= .08 * c.placement.scale, precedingPathIndex: keep[k - 1], followingPathIndex: keep[k + 1] });
    }
    expect(turns.length).toBe(turnStats(route).sharp);
    const rs = samples(route).map((xy, i, all) => ({ xy, meters: i * e.lengthMeters / (all.length - 1), ...nearest(xy, outline) }));
    const ss = samples(outline).map(xy => ({ xy, ...nearest(xy, route) }));
    const d1 = rs.reduce((s, x) => s + x.distance, 0) / rs.length, d2 = ss.reduce((s, x) => s + x.distance, 0) / ss.length;
    expect((d1 + d2) / 2).toBeCloseTo(e.meanDev, 8);
    const windows = [];
    for (let start = 0; start + 600 <= e.lengthMeters; start += 200) {
      const end = Math.min(start + 1000, e.lengthMeters), selected = rs.filter(s => s.meters >= start && s.meters <= end);
      const outlineSelected = ss.filter(s => cumulative[s.segment] >= start && cumulative[s.segment] <= end);
      const localTurns = turns.filter(t => t.meters >= start && t.meters <= end);
      windows.push({ start, end, meanRoadToContour: selected.reduce((sum, s) => sum + s.distance, 0) / Math.max(1, selected.length), meanContourToRoad: outlineSelected.reduce((sum, s) => sum + s.distance, 0) / Math.max(1, outlineSelected.length), contourSamples: outlineSelected.length, sharpTurns: localTurns.length, unmatchedFeatureTurns: localTurns.filter(t => !t.withinFeatureTolerance).length });
    }
    const ranked = windows.sort((a, b) => (b.meanRoadToContour + b.meanContourToRoad) - (a.meanRoadToContour + a.meanContourToRoad));
    const first = ranked[0], second = ranked.find(w => w.end < first.start || w.start > first.end);
    const shapeTurns = turnStats(outline, c.placement.scale * .01), factor = 1 / (1 + .03 * e.zigzagPerKm);
    const result = { caseId: row.caseId, dataSha256: hash(text), placement: c.placement, similarity: e.similarity, lengthMeters: e.lengthMeters, meanDev: e.meanDev, roadToContourMean: d1, contourToRoadMean: d2, featureCoverage: e.featureCoverage, spikes: e.spikes, routeTurns: turnStats(route), shapeTurns, excessSharpTurns: Math.max(0, turns.length - shapeTurns.sharp), zigzagFactor: factor, hypotheticalNoZigzagScore: 100 * Math.exp(-e.meanDev / (.08 * c.placement.scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes), warning: 'No-zigzag counterfactual is diagnostic only, not an attainable route or accepted score. Excess sharp turns are a global count, not individually assigned penalties. Nearest contour matches are not monotone correspondences.', turns, features: features.map(xy => ({ xy, ...nearest(xy, route), hit: nearest(xy, route).distance <= .08 * c.placement.scale })), roadSamples: rs, contourSamples: ss, highestErrorDisjointWindows: [first, second].filter(Boolean), windows: ranked };
    writeFileSync(path.join(folder, `${row.caseId}.json`), JSON.stringify(result, null, 2));
    return { ...result, turns: undefined, features: undefined, roadSamples: undefined, contourSamples: undefined, windows: undefined };
  });
  expect(results).toHaveLength(12);
  writeFileSync(path.join(folder, 'results.json'), JSON.stringify({ inputSha256: hash(inputText), codeHashes: Object.fromEntries(['src/lib/route/fit.ts', 'src/lib/art/rdp.ts', 'src/lib/route/shapes.ts', 'tests/eval/bend-diagnosis-20261012.test.ts'].map(f => [f, hash(readFileSync(f, 'utf8'))])), searchPerformed: false, originalCasesOnly: true, results }, null, 2));
}, 120000);
