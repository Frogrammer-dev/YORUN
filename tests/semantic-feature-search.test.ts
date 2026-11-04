import { describe, expect, it } from 'vitest';
import { buildGraph, hasEdge, makeOrigin, unproject } from '../src/lib/route/graph';
import { SHAPE_BY_ID } from '../src/lib/route/shapes';
import { correspondence, featureBinWeights, weightedContourError, semanticFeatureSearch } from '../src/lib/route/semanticFeatureSearch';
function fixture() {
  const origin = makeOrigin(37, 127);
  const points: Array<[number, number]> = [[-500, -500], [500, -500], [500, 500], [-500, 500], [500, 800], [-500, 800]];
  const nativeEdges: Array<{ a: number; b: number; factor: number }> = [];
  const pieces = new Map<string, number[]>();
  for (const [a, b] of [[0, 1], [1, 2], [2, 3], [3, 0], [2, 4], [4, 5], [5, 3]]) {
    const count = Math.round(Math.hypot(points[b][0] - points[a][0], points[b][1] - points[a][1]) / 100);
    const nodes = [a];
    for (let i = 1; i < count; i++) {
      nodes.push(points.length);
      points.push([points[a][0] + (points[b][0] - points[a][0]) * i / count, points[a][1] + (points[b][1] - points[a][1]) * i / count]);
    }
    nodes.push(b); pieces.set(`${a}:${b}`, nodes);
    for (let i = 1; i < nodes.length; i++) nativeEdges.push({ a: nodes[i - 1], b: nodes[i], factor: 1 });
  }
  const expand = (nodes: number[]) => nodes.slice(1).flatMap((b, i) => pieces.get(`${nodes[i]}:${b}`)!.slice(0, -1)).concat(nodes.at(-1)!);
  const ll = points.map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]), nativeEdges, null);
  const remap = points.map(([x, y]) => g.nodeIndex.nearest(x, y, 1));
  const placement = { cx: 0, cy: 0, scale: 1000, rotDeg: 0 };
  const region = { minX: -1000, maxX: 1000, minY: -1000, maxY: 1000 };
  return { g, placement, region, input: expand([0, 1, 2, 4, 5, 3, 0]).map(i => remap[i]), perfect: expand([0, 1, 2, 3, 0]).map(i => remap[i]), square: SHAPE_BY_ID.square };
}


describe('fixed arc-weight ablation',()=>{
 it('weights immutable arc-length bins and penalizes feature damage more than body damage',()=>{
  const weights=featureBinWeights(SHAPE_BY_ID.bird);
  expect(weights).toHaveLength(48);expect(weights).toContain(4);expect(weights).toContain(1);
  const f=weights.indexOf(4), b=weights.indexOf(1), fe=Array(48).fill(0),be=Array(48).fill(0);fe[f]=1;be[b]=1;
  expect(weightedContourError(fe,weights)).toBeGreaterThan(weightedContourError(be,weights));
  expect(weightedContourError(fe,Array(48).fill(1))).toBe(weightedContourError(be,Array(48).fill(1)));
 });
 it('uses exactly identical outputs for both arms when no feature arcs exist',()=>{
  const {g,square,placement,input,region}=fixture();
  const a=semanticFeatureSearch(g,square,placement,input,region,{mode:'uniform',maxProposals:96,maxExpanded:1000})!;
  const b=semanticFeatureSearch(g,square,placement,input,region,{mode:'feature',maxProposals:96,maxExpanded:1000})!;
  expect(a).toEqual(b);expect(a.diagnostics.relationObjective).toBeLessThanOrEqual(a.initialDiagnostics.relationObjective);
  expect(a.evaluated.path.every((v,i,p)=>!i||hasEdge(g,p[i-1],v))).toBe(true);
  expect(a.history.every((h,i,hs)=>!i||h.relationObjective<hs[i-1].relationObjective)).toBe(true);
 });
 it('preserves seed at zero and rejects invalid native lengths and open paths',()=>{
  const {g,square,placement,input,region}=fixture();
  expect(semanticFeatureSearch(g,square,placement,input,region,{mode:'feature',maxProposals:0})!.evaluated.path).toEqual(input);
  expect(semanticFeatureSearch(g,square,placement,input.slice(0,-1),region,{mode:'feature'})).toBeNull();
  expect(semanticFeatureSearch({...g,adjLen:Float32Array.from(g.adjLen,d=>d*2)},square,placement,input,region,{mode:'feature',maxProposals:0})).toBeNull();
 });
 it('keeps correspondence independent of weights and provides full index permutation',()=>{
  const {g,placement,input}=fixture();const m=correspondence(g,SHAPE_BY_ID.bird,placement,input);
  expect(new Set(m.indices).size).toBe(48);expect(m.errors).toHaveLength(48);
  const weights=featureBinWeights(SHAPE_BY_ID.bird);expect(weights.every(w=>w===1||w===4)).toBe(true);
 });
});


