import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { corridorContinuationRepair, CORRIDOR_CONTINUATION_PARAMS } from '@/lib/route/corridorContinuationRepair';
import { refinePathPlacement } from '@/lib/route/refinePlacement';
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.CORRIDOR_CASCADE)('tests diverse face populations after the completed automatic cascade on all original twelve cases', () => {
  const root = path.resolve('eval/recognition/route-improvement');
  const out = path.join(root, 'corridor-cascade-20261013'); mkdirSync(out, { recursive: true });
  const inputText = readFileSync(path.join(root, 'offline-cascade-20261013/results.json'), 'utf8');
  const input = JSON.parse(inputText) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; pool: RouteCandidate[]; raw: number; sourceHash: string }> };
  expect(input.cases).toHaveLength(12);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const params = CORRIDOR_CONTINUATION_PARAMS;
  const codeHashes = Object.fromEntries(['tests/eval/corridor-cascade-20261013.test.ts', 'src/lib/route/corridorContinuationRepair.ts', 'src/lib/route/globalSearch.ts', 'src/lib/route/flex.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/loops.ts', 'src/lib/route/shapes.ts', 'src/lib/route/refinePlacement.ts', 'src/lib/route/pairSegmentRepair.ts', 'src/lib/art/rdp.ts'].map(f => [f, sha(readFileSync(f, 'utf8'))]));
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
    writeFileSync(path.join(out, `${row.caseId}-progress.json`), JSON.stringify({ caseId: row.caseId, stage: 'corridor-after-cascade' }));
    const began=Date.now(),result=corridorContinuationRepair(g,shape,row.candidate.placement,nodesFor(row.candidate),region);
    expect(result).not.toBeNull();
    const searched=result!,candidate=toCandidate(g,shape,row.candidate.placement,searched.evaluated),raw=rawFor(candidate);
    expect(raw).toBeGreaterThanOrEqual(row.raw-1e-8);
    if(raw>row.raw+1e-7) {expect(pairEdgeKey(nodesFor(candidate))).not.toBe(pairEdgeKey(nodesFor(row.candidate))); expect(raw).toBeGreaterThan(searched.strongestInputRaw);}
    const score=(e:ReturnType<typeof evaluatePath>,scale:number)=>100*Math.exp(-e.meanDev/(.08*scale)-Math.log1p(.03*e.zigzagPerKm)+Math.log(.55+.45*e.featureCoverage)+e.spikes*Math.log(.9));
    const fair=(nodes:number[])=> {
      const canonical=pairPhaseZero(g,shape,row.candidate.placement,nodes);
      const fits=[nodes,canonical].map(ns=>refinePathPlacement(g,shape,row.candidate.placement,ns,region,3000,8000,128)).filter(f=>f!==null);
      return fits.flatMap(f=> {const ns=pairPhaseZero(g,shape,f.placement,f.evaluated.path),e=evaluatePath(g,shape,f.placement,ns,3000,8000); return [{candidate:toCandidate(g,shape,f.placement,e),raw:score(e,f.placement.scale)}];}).sort((a,b)=>b.raw-a.raw)[0];
    };
    const originalFit=fair(nodesFor(row.candidate));
    const direct=refinePathPlacement(g,shape,row.candidate.placement,nodesFor(row.candidate),region,3000,8000,128)!;
    const directRaw=score(direct.evaluated,direct.placement.scale);
    const beforeFit=directRaw>originalFit.raw?{candidate:toCandidate(g,shape,direct.placement,direct.evaluated),raw:directRaw}:originalFit;
    let afterFit=beforeFit;
    for(const proposal of searched.proposals.filter(p=>p.strict)) {const fit=fair(proposal.path);rawFor(fit.candidate);if(fit.raw>afterFit.raw+1e-7)afterFit=fit;}
    rawFor(beforeFit.candidate);rawFor(afterFit.candidate);
    if(afterFit.raw>beforeFit.raw+1e-7)expect(pairEdgeKey(nodesFor(afterFit.candidate))).not.toBe(pairEdgeKey(nodesFor(row.candidate)));
    const output={caseId:row.caseId,before:row.candidate.similarity,after:candidate.similarity,beforeRaw:row.raw,afterRaw:raw,candidate,diagnostics:searched.diagnostics,proposalDetails:searched.proposals.map(p=>({originalGap:p.originalGap,replacementLength:p.replacementLength,strict:p.strict,raw:p.raw})),beforeFairRefit:beforeFit,afterFairRefit:afterFit,elapsedMs:Date.now()-began};
    cases.push(output); writeFileSync(path.join(out, `${row.caseId}.json`), JSON.stringify(output, null, 2));
  }
  const summary = { count: cases.length, beforeAverage: cases.reduce((s, c) => s + c.before, 0) / 12, afterAverage: cases.reduce((s, c) => s + c.after, 0) / 12, beforeRawAverage: cases.reduce((s, c) => s + c.beforeRaw, 0) / 12, afterRawAverage: cases.reduce((s, c) => s + c.afterRaw, 0) / 12, improvements: cases.filter(c => c.afterRaw > c.beforeRaw + 1e-7).length, elapsedMs: cases.reduce((s, c) => s + c.elapsedMs, 0) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
