import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, routePlacement, toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { globalSearch } from '@/lib/route/globalSearch';
import { hasEdge, PathFinder, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { roadGeometrySeeds, ROAD_GEOMETRY_SEED_PARAMS } from '@/lib/route/roadGeometrySeeds';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.ROAD_GEOMETRY_SEEDS)('compares frozen road-support 48 proposals with existing automatic coarse 48', () => {
  const source = path.resolve('eval/recognition/llm-routes-20261010'), out = path.resolve('eval/recognition/route-improvement/road-geometry-seeds-20261013'); mkdirSync(out, { recursive: true });
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  const codeFiles = ['src/lib/route/roadGeometrySeeds.ts', 'tests/eval/road-geometry-seeds.test.ts', 'src/lib/route/globalSearch.ts', 'src/lib/route/fit.ts', 'src/lib/route/flex.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/art/rdp.ts'];
  const codeHashes = Object.fromEntries(codeFiles.map(f => [f, hash(readFileSync(f, 'utf8'))]));
  const areas = JSON.parse(readFileSync(path.join(source, 'round2-results.json'), 'utf8')).protocol.areas as Array<{ id: string; bbox: BBox }>;
  const area = areas.find(a => a.id === 'gwangalli')!, roadText = readFileSync(path.join(source, 'gwangalli-roads.json'), 'utf8');
  const g = graphFromOverpass(JSON.parse(roadText), area.bbox, { detail: 'simple', excludeSteps: true }), finder = new PathFinder(g);
  const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
  const inside = (x: number, y: number) => x >= minX && x <= maxX && y >= minY && y <= maxY;
  const protocol = { params: ROAD_GEOMETRY_SEED_PARAMS, codeHashes, sourceHash: hash(roadText), manualSeeds: false, storedOptimizedRoutesUsedForSeeds: false, incumbentReadOnlyFallback: true, originalScore: true, filteredGraphOnly: true, holdoutRead: false, equalRoutingBudget: 48, noExtraLocalRefit: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const incumbentRows = JSON.parse(readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8')).cases as Array<{ caseId: string; candidate: RouteCandidate }>;
  const results = [];
  for (const shapeId of ['square', 'heart', 'cat'] as ShapeId[]) {
    const shape = SHAPE_BY_ID[shapeId], caseId = `gwangalli-${shapeId}`, incumbent = incumbentRows.find(r => r.caseId === caseId)!.candidate;
    const assess = (nodes: number[], p: Placement) => {
      if (!nodes.every((v, i) => v >= 0 && inside(g.x[v], g.y[v]) && (!i || hasEdge(g, nodes[i - 1], v))) || nodes[0] !== nodes.at(-1) || !placeShape(shape.points, p).every(([x, y]) => inside(x, y))) return null;
      const e = evaluatePath(g, shape, p, nodes, 3000, 8000); if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) return null;
      const raw = 100 * Math.exp(-e.meanDev / (.08 * p.scale)) * (.55 + .45 * e.featureCoverage) * Math.pow(.9, e.spikes) / (1 + .03 * e.zigzagPerKm);
      return { raw, candidate: toCandidate(g, shape, p, e), geometryKey: pairEdgeKey(nodes), nodes };
    };
    const incNodes = incumbent.latlngs.map(([lat, lon]) => { const [x, y] = project(g.origin, lat, lon); return g.nodeIndex.nearest(x, y, 1); });
    const original = assess(incNodes, incumbent.placement)!, canonical = assess(pairPhaseZero(g, shape, incumbent.placement, incNodes), incumbent.placement)!;
    expect(original.candidate.similarity).toBe(incumbent.similarity);
    const threshold = Math.max(original.raw, canonical.raw);
    const proposalStart = Date.now(), road = roadGeometrySeeds(g, shape, region), roadProposalMs = Date.now() - proposalStart;
    expect(roadGeometrySeeds(g, shape, region)).toEqual(road);
    const controlStart = Date.now(), control = globalSearch(g, shape, region, 0, true, true), controlProposalMs = Date.now() - controlStart;
    const methods = [];
    for (const [label, seeds, proposalMs] of [['road-support', road.seeds.map(s => s.placement), roadProposalMs], ['global-coarse', control.placementSeeds, controlProposalMs]] as const) {
      const began = Date.now(), candidates = []; let failedRouting = 0, invalidFinal = 0;
      for (const p of seeds) {
        const e = routePlacement(g, finder, shape, p, 3000, 8000, true, 'flex'); if (!e) { failedRouting++; continue; }
        const fit = e.fit ?? p, c = assess(pairPhaseZero(g, shape, fit, e.path), fit); if (!c) { invalidFinal++; continue; }
        candidates.push(c);
      }
      candidates.sort((a, b) => b.raw - a.raw);
      const best = candidates[0] ?? null, accepted = best && best.raw > threshold + 1e-7 && (best.geometryKey !== original.geometryKey || JSON.stringify(best.candidate.placement) !== JSON.stringify(incumbent.placement)) ? best : original;
      methods.push({ label, proposals: seeds.length, proposalMs, routingMs: Date.now() - began, failedRouting, invalidFinal, validCandidates: candidates.length, bestNewRaw: best?.raw ?? null, bestNewSimilarity: best?.candidate.similarity ?? 0, acceptedRaw: accepted.raw, acceptedSimilarity: accepted.candidate.similarity, geometryChange: accepted.geometryKey !== original.geometryKey, placementOnly: accepted.geometryKey === original.geometryKey && accepted !== original, best, accepted, seeds });
    }
    const row = { caseId, incumbentRaw: original.raw, incumbentCanonicalRaw: canonical.raw, roadDiagnostics: road.diagnostics, methods };
    writeFileSync(path.join(out, `${caseId}.json`), JSON.stringify(row, null, 2)); results.push(row);
    console.log(JSON.stringify({ caseId, diagnostics: road.diagnostics, methods: methods.map(({ label, proposals, proposalMs, routingMs, validCandidates, bestNewRaw, acceptedRaw, acceptedSimilarity }) => ({ label, proposals, proposalMs, routingMs, validCandidates, bestNewRaw, acceptedRaw, acceptedSimilarity })) }));
  }
  expect(results).toHaveLength(3); writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, cases: results }, null, 2));
}, 3600000);
