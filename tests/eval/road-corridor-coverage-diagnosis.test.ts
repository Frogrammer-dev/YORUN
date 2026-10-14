import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { maximalRoadCorridors, MAXIMAL_CORRIDOR_PARAMS, type CorridorTrace } from '@/lib/route/roadCorridorDecomposition';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.skipIf(!process.env.ROAD_CORRIDOR_DIAGNOSIS)('diagnoses representation coverage using existing automatic routes strictly as positive controls', () => {
  const out = path.resolve('eval/recognition/route-improvement/road-corridor-coverage-20261013'); mkdirSync(out, { recursive: true });
  const hash = (s: string) => createHash('sha256').update(s).digest('hex'), codeFiles = ['src/lib/route/roadCorridorDecomposition.ts', 'tests/eval/road-corridor-coverage-diagnosis.test.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/fit.ts', 'src/lib/route/shapes.ts'];
  const protocol = { params: MAXIMAL_CORRIDOR_PARAMS, codeHashes: Object.fromEntries(codeFiles.map(f => [f, hash(readFileSync(f, 'utf8'))])), searchRun: false, routesAsSeeds: false, noHoldoutRead: true, source: 'existing automatic square routes as representation positive controls only', optionalTraceObserverDoesNotChangeDecomposition: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const areas = JSON.parse(readFileSync('eval/recognition/llm-routes-20261010/round2-results.json', 'utf8')).protocol.areas as Array<{ id: string; bbox: BBox }>;
  const priorText = readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8'), prior = JSON.parse(priorText).cases as Array<{ caseId: string; candidate: RouteCandidate }>, cases = [];
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  for (const area of areas) {
    const roadText = readFileSync(`eval/recognition/llm-routes-20261010/${area.id}-roads.json`, 'utf8'), g = graphFromOverpass(JSON.parse(roadText), area.bbox, { detail: 'simple', excludeSteps: true });
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
    const traces: CorridorTrace[] = [], result = maximalRoadCorridors(g, region, t => traces.push(t)); expect(result).toEqual(maximalRoadCorridors(g, region));
    const frozen = JSON.parse(readFileSync(`eval/recognition/route-improvement/road-geometry-cycles-v4-20261013/${area.id}/results.json`, 'utf8')); expect(result.diagnostics).toEqual(frozen.decompositionDiagnostics);
    const candidate = prior.find(c => c.caseId === `${area.id}-square`)!.candidate, nodes = candidate.latlngs.map(([lat, lon]) => { const [x, y] = project(g.origin, lat, lon); return g.nodeIndex.nearest(x, y, 1); });
    expect(nodes.every((v, i) => v >= 0 && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true); expect(evaluatePath(g, SHAPE_BY_ID.square, candidate.placement, nodes, 3000, 8000).similarity).toBe(candidate.similarity);
    const edgeToTrace = new Map<string, number>(); traces.forEach((t, id) => { for (let i = 1; i < t.nodes.length; i++) { const k = key(t.nodes[i - 1], t.nodes[i]); expect(edgeToTrace.has(k)).toBe(false); edgeToTrace.set(k, id); } });
    const groups: Array<{ traceId: number; reason: CorridorTrace['reason']; nodes: number[]; meters: number; fullChainMeters: number }> = [];
    const byReason: Record<string, { edges: number; meters: number }> = {};
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i], id = edgeToTrace.get(key(a, b)); expect(id).not.toBeUndefined(); const trace = traces[id!];
      let meters = 0; for (let ei = g.adjStart[a]; ei < g.adjStart[a + 1]; ei++) if (g.adjTo[ei] === b) { meters = g.adjLen[ei]; break; }
      const r = byReason[trace.reason] ??= { edges: 0, meters: 0 }; r.edges++; r.meters += meters;
      const last = groups.at(-1); if (last && last.traceId === id) { last.nodes.push(b); last.meters += meters; } else groups.push({ traceId: id!, reason: trace.reason, nodes: [a, b], meters, fullChainMeters: trace.length });
    }
    if (groups.length > 1 && groups[0].traceId === groups.at(-1)!.traceId) { const last = groups.pop()!; groups[0] = { ...groups[0], nodes: [...last.nodes, ...groups[0].nodes.slice(1)], meters: last.meters + groups[0].meters }; }
    const missingRuns: Array<{ nodes: number[]; meters: number; reasons: string[] }> = [];
    let run: typeof missingRuns[number] | null = null;
    // Rotate to a selected group so cyclic unselected runs are combined without a seam artifact.
    const start = groups.findIndex(t => t.reason === 'selected'), ordered = start < 0 ? groups : [...groups.slice(start), ...groups.slice(0, start)];
    for (const group of ordered) {
      if (group.reason === 'selected') { if (run) missingRuns.push(run); run = null; }
      else if (!run) run = { nodes: group.nodes.slice(), meters: group.meters, reasons: [group.reason] };
      else { run.nodes.push(...group.nodes.slice(1)); run.meters += group.meters; run.reasons.push(group.reason); }
    }
    if (run) missingRuns.push(run);
    const row = { areaId: area.id, incumbentSimilarity: candidate.similarity, sourceHash: hash(roadText), incumbentSourceHash: hash(priorText), decompositionDiagnostics: result.diagnostics, byReason, groups, missingRuns, missingRunsWithin60m: missingRuns.filter(r => r.meters <= 60).length, maxMissingRunMeters: Math.max(0, ...missingRuns.map(r => r.meters)), onlyDiagnosticNoProposalCoordinates: true };
    cases.push(row); writeFileSync(path.join(out, `${area.id}.json`), JSON.stringify(row, null, 2));
  }
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, cases }, null, 2));
}, 3600000);
