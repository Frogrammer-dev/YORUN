import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { clippedRoadCorridors } from '@/lib/route/clippedRoadCorridors';
import { evaluatePath, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { corridorIntersection } from '@/lib/route/roadConnectorCycles';
import { roadConnectorCyclesDiagnostic } from '@/lib/route/roadConnectorCyclesDiagnostic';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.skipIf(!process.env.ROAD_CONNECTOR_REPRESENTATION_DIAGNOSIS)('distinguishes exact-path representation from multi-source connector shortening using seomyeon as oracle only', () => {
  const out = path.resolve('eval/recognition/route-improvement/road-connector-representation-20261013'); mkdirSync(out, { recursive: true });
  const hash = (s: string) => createHash('sha256').update(s).digest('hex'), sourceText = readFileSync('src/lib/route/roadConnectorCycles.ts', 'utf8'), diagnosticSource = readFileSync('src/lib/route/roadConnectorCyclesDiagnostic.ts', 'utf8');
  const normalize = (s: string) => s.replace(/\r\n/g, '\n').trimEnd();
  expect(normalize(diagnosticSource.replace('export function roadConnectorCyclesDiagnostic(', 'export function roadConnectorCycles(').replace('return { diagnosticLinks: [...links.values()], candidates: [...geometries]', 'return { candidates: [...geometries]'))).toBe(normalize(sourceText));
  const frozen = JSON.parse(readFileSync('eval/recognition/route-improvement/road-geometry-cycles-v6-20261013/seomyeon/results.json', 'utf8'));
  expect(hash(sourceText)).toBe(frozen.protocol.codeHashes['src/lib/route/roadConnectorCycles.ts']);
  const protocol = { purpose: 'read-only exact-path positive control diagnosis; no policy or seed change', sourceHash: hash(sourceText), diagnosticCloneHash: hash(diagnosticSource), harnessHash: hash(readFileSync('tests/eval/road-connector-representation-diagnosis.test.ts', 'utf8')), literalCloneIdentity: true, parameters: frozen.protocol.params, noOracleSeed: true, noHoldout: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const areas = JSON.parse(readFileSync('eval/recognition/llm-routes-20261010/round2-results.json', 'utf8')).protocol.areas as Array<{ id: string; bbox: BBox }>, area = areas.find(a => a.id === 'seomyeon')!;
  const roadText = readFileSync('eval/recognition/llm-routes-20261010/seomyeon-roads.json', 'utf8'), g = graphFromOverpass(JSON.parse(roadText), area.bbox, { detail: 'simple', excludeSteps: true });
  const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east), region = { minX, minY, maxX, maxY };
  const chains = clippedRoadCorridors(g, region).chains, generated = roadConnectorCyclesDiagnostic(g, chains, region); expect(generated.diagnostics).toEqual(frozen.cycleDiagnostics);
  const priorText = readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8'), row = JSON.parse(priorText).cases.find((c: { caseId: string }) => c.caseId === 'seomyeon-square') as { candidate: RouteCandidate };
  const nodes = row.candidate.latlngs.map(([lat, lon]) => { const [x, y] = project(g.origin, lat, lon); return g.nodeIndex.nearest(x, y, 1); }); expect(evaluatePath(g, SHAPE_BY_ID.square, row.candidate.placement, nodes, 3000, 8000).similarity).toBe(85);
  const edgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`, chainFor = new Map<string, number>();
  chains.forEach((c, id) => { for (let i = 1; i < c.nodes.length; i++) { const k = edgeKey(c.nodes[i - 1], c.nodes[i]); expect(chainFor.has(k)).toBe(false); chainFor.set(k, id); } });
  const groups: Array<{ chainId: number; heading: number | null; nodes: number[]; meters: number }> = [];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1], b = nodes[i], id = chainFor.get(edgeKey(a, b)) ?? -1, meters = Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);
    const last = groups.at(-1); if (last && last.chainId === id) { last.nodes.push(b); last.meters += meters; } else groups.push({ chainId: id, heading: id >= 0 ? chains[id].heading : null, nodes: [a, b], meters });
  }
  if (groups.length > 1 && groups[0].chainId === groups.at(-1)!.chainId) { const last = groups.pop()!; groups[0] = { ...groups[0], nodes: [...last.nodes, ...groups[0].nodes.slice(1)], meters: last.meters + groups[0].meters }; }
  const missing = groups.map((group, i) => {
    if (group.chainId >= 0) return null;
    const before = groups[(i + groups.length - 1) % groups.length], after = groups[(i + 1) % groups.length], ca = chains[before.chainId], cb = chains[after.chainId], center = corridorIntersection(g, ca, cb)!;
    const delta = Math.min(Math.abs(ca.heading - cb.heading), 180 - Math.abs(ca.heading - cb.heading)), link = generated.diagnosticLinks.find(l => (l.a === before.chainId && l.b === after.chainId) || (l.b === before.chainId && l.a === after.chainId));
    const route = !link ? null : link.a === before.chainId ? link.path : link.path.slice().reverse(), length = (ns: number[]) => ns.slice(1).reduce((s, v, j) => s + Math.hypot(g.x[v] - g.x[ns[j]], g.y[v] - g.y[ns[j]]), 0);
    const along = (chainId: number, a: number, b: number) => { const ns = chains[chainId].nodes, ai = ns.indexOf(a), bi = ns.indexOf(b); expect(ai).toBeGreaterThanOrEqual(0); expect(bi).toBeGreaterThanOrEqual(0); return length(ns.slice(Math.min(ai, bi), Math.max(ai, bi) + 1)); };
    const beforeIndex = route ? before.nodes.indexOf(route[0]) : -1, afterIndex = route ? after.nodes.indexOf(route.at(-1)!) : -1;
    let shortcutDiagnostic = null;
    if (route) {
      const chainPath = (id: number, a: number, b: number) => { const ns = chains[id].nodes, ai = ns.indexOf(a), bi = ns.indexOf(b); return ai < bi ? ns.slice(ai, bi + 1) : ns.slice(bi, ai + 1).reverse(); };
      const afterSide = afterIndex >= 0 ? after.nodes.slice(afterIndex) : [...chainPath(after.chainId, route.at(-1)!, after.nodes[0]), ...after.nodes.slice(1)];
      const beforeSide = beforeIndex >= 0 ? before.nodes.slice(0, beforeIndex + 1) : [...before.nodes, ...chainPath(before.chainId, before.nodes.at(-1)!, route[0]).slice(1)];
      const parts = [afterSide]; let j = (i + 2) % groups.length;
      while (j !== (i + groups.length - 1) % groups.length) { parts.push(groups[j].nodes); j = (j + 1) % groups.length; }
      parts.push(beforeSide, route);
      const replacement = [...parts[0], ...parts.slice(1).flatMap(ns => ns.slice(1))]; expect(replacement[0]).toBe(replacement.at(-1)); expect(replacement.every((v, k) => !k || hasEdge(g, replacement[k - 1], v))).toBe(true);
      const e = evaluatePath(g, SHAPE_BY_ID.square, row.candidate.placement, replacement, 3000, 8000);
      shortcutDiagnostic = { usesOriginalPathAsDiagnosticOnlyNotSearchSeed: true, beforeEndpointInsideOriginalUsedSide: beforeIndex >= 0, afterEndpointInsideOriginalUsedSide: afterIndex >= 0, originalNativeLength: evaluatePath(g, SHAPE_BY_ID.square, row.candidate.placement, nodes, 3000, 8000).lengthMeters, replacementNativeLength: e.lengthMeters, belowOriginal3kmMin: e.lengthMeters < 3000, exactActualPath: replacement, nativeRepeatRatio: e.repeatRatio, candidateAccepted: false };
    }
    return { group, beforeChainId: before.chainId, afterChainId: after.chainId, beforeHeading: ca.heading, afterHeading: cb.heading, headingDelta: delta, orthogonalWithin10: Math.abs(delta - 90) <= 10, idealIntersection: center, originalEndpointIds: [group.nodes[0], group.nodes.at(-1)!], originalNodeRadii: group.nodes.map(v => Math.hypot(g.x[v] - center[0], g.y[v] - center[1])), linkExists: !!route, selectedEndpointIds: route ? [route[0], route.at(-1)!] : null, actualSelectedLink: route, selectedLinkShared: link?.shared ?? null, selectedConnectorMeters: route ? length(route) : null, originalConnectorMeters: group.meters, connectorLengthReduction: route ? group.meters - length(route) : null, shiftAlongBeforeSideMeters: route ? along(before.chainId, group.nodes[0], route[0]) : null, shiftAlongAfterSideMeters: route ? along(after.chainId, group.nodes.at(-1)!, route.at(-1)!) : null, beforeSelectedNodeInsideOriginalUsedSide: beforeIndex >= 0, afterSelectedNodeInsideOriginalUsedSide: afterIndex >= 0, shortcutDiagnostic };
  }).filter(Boolean);
  const sideIndices = groups.map((r, i) => r.chainId >= 0 ? i : -1).filter(i => i >= 0), partitions = [];
  const angle = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b));
  for (let a = 0; a < sideIndices.length; a++) for (let b = a + 1; b < sideIndices.length; b++) for (let c = b + 1; c < sideIndices.length; c++) for (let d = c + 1; d < sideIndices.length; d++) {
    const indices = [sideIndices[a], sideIndices[b], sideIndices[c], sideIndices[d]], ids = indices.map(i => groups[i].chainId), headings = ids.map(i => chains[i].heading), gaps = indices.map((i, k) => { let sum = 0, j = (i + 1) % groups.length; while (j !== indices[(k + 1) % 4]) { sum += groups[j].meters; j = (j + 1) % groups.length; } return sum; });
    const orthogonal = headings.every((h, k) => Math.abs(angle(h, headings[(k + 1) % 4]) - 90) <= 10), parallel = angle(headings[0], headings[2]) <= 10 && angle(headings[1], headings[3]) <= 10;
    partitions.push({ chainIds: ids, groupIndices: indices, headings, minimumActualGapMeters: gaps, maxGapMeters: Math.max(...gaps), fourDistinctChains: new Set(ids).size === 4, meets120mGaps: gaps.every(v => v <= 120), orthogonal, parallel });
  }
  const eligibleByLengthAndHeading = partitions.filter(p => p.fourDistinctChains && p.meets120mGaps && p.orthogonal && p.parallel);
  const usage = new Map<number, number>(); groups.filter(r => r.chainId >= 0).forEach(r => usage.set(r.chainId, (usage.get(r.chainId) ?? 0) + 1));
  const result = { protocol, sourceRoadHash: hash(roadText), incumbentSourceHash: hash(priorText), candidateSimilarity: 85, groups, distinctChainCount: usage.size, repeatedChainIds: [...usage].filter(([, n]) => n > 1), missing, exactPathPartitionCheck: { sideRunCount: sideIndices.length, examinedCombinations: partitions.length, eligibleByLengthAndHeading: eligibleByLengthAndHeading.length, minimumMaxGapMeters: Math.min(...partitions.map(p => p.maxGapMeters)), fullMaximalSideRunsMinimizeConnectorLength: true, validRepresentationRequiresAllOtherConstraintsToo: true }, partitions };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify(result, null, 2));
}, 3600000);
