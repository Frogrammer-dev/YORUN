import { evaluatePath, placeShape, type Evaluated, type Placement, type Region } from './fit';
import { hasEdge, type RoadGraph } from './graph';
import { clippedRoadCorridors } from './clippedRoadCorridors';
import { pairEdgeKey, pairPhaseZero } from './pairSegmentRepair';
import type { ShapeDef } from './shapes';

export const CORRIDOR_CONTINUATION_PARAMS = { originalGapMeters: 120, replacementMeters: 120, geometryCap: 128, selection: 'sorted edge multiset before quality' } as const;
const quality = (e: Evaluated, p: Placement) => e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);

/** Repair local corridor transitions through existing shared junctions only. */
export function corridorContinuationRepair(g: RoadGraph, shape: ShapeDef, p: Placement, input: number[], region: Region) {
  const inside = (v: number) => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY;
  const valid = (ns: number[]) => ns.length >= 4 && ns[0] === ns.at(-1) && ns.every((v, i) => inside(v) && (!i || hasEdge(g, ns[i - 1], v)));
  if (!valid(input) || !placeShape(shape.points, p).every(([x,y]) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY)) return null;
  const allowed = (e: Evaluated) => e.lengthMeters >= 3000 && e.lengthMeters <= 8000 && e.repeatRatio <= .2;
  const original = evaluatePath(g, shape, p, input, 3000, 8000);
  if (!allowed(original)) return null;
  const canonical = pairPhaseZero(g, shape, p, input), canonicalEval = evaluatePath(g, shape, p, canonical, 3000, 8000);
  const threshold = Math.min(quality(original,p), quality(canonicalEval,p)), inputKey = pairEdgeKey(input);
  const chains = clippedRoadCorridors(g, region).chains;
  const edge = (a: number,b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const labels = new Map<string,number>();
  chains.forEach((c, id) => { for(let i=1;i<c.nodes.length;i++) labels.set(edge(c.nodes[i-1],c.nodes[i]),id); });
  const loop = canonical.slice(0,-1), n = loop.length;
  const proposals = new Map<string,{path:number[];originalGap:number;replacementLength:number}>();
  let transitions = 0, sharedJunctions = 0;
  for (let left=0;left<n;left++) {
    const a = labels.get(edge(loop[(left+n-1)%n],loop[left])); if(a === undefined) continue;
    let gap=0;
    for(let offset=0;offset<n-1;offset++) {
      const right=(left+offset)%n, next=(right+1)%n, b=labels.get(edge(loop[right],loop[next]));
      if(b === a) break;
      if(b !== undefined) {
        transitions++;
        const first=chains[a].nodes, second=chains[b].nodes, secondSet=new Set(second);
        for(const junction of first.filter(v=>secondSet.has(v))) {
          sharedJunctions++;
          const slice=(ns:number[],u:number,v:number) => { const i=ns.indexOf(u),j=ns.indexOf(v); return i<=j?ns.slice(i,j+1):ns.slice(j,i+1).reverse(); };
          const replacement=[...slice(first,loop[left],junction),...slice(second,junction,loop[right]).slice(1)];
          let length=0; for(let i=1;i<replacement.length;i++) length+=Math.hypot(g.x[replacement[i]]-g.x[replacement[i-1]],g.y[replacement[i]]-g.y[replacement[i-1]]);
          if(length>CORRIDOR_CONTINUATION_PARAMS.replacementMeters || replacement.length<2) continue;
          const rest=Array.from({length:n-offset},(_,i)=>loop[(right+i)%n]);
          const path=pairPhaseZero(g,shape,p,[...replacement,...rest.slice(1),replacement[0]]);
          if(!valid(path)) continue;
          const key=pairEdgeKey(path); if(key===inputKey) continue;
          proposals.set(key,{path,originalGap:gap,replacementLength:length});
        }
        break;
      }
      gap+=Math.hypot(g.x[loop[next]]-g.x[loop[right]],g.y[loop[next]]-g.y[loop[right]]);
      if(gap>CORRIDOR_CONTINUATION_PARAMS.originalGapMeters) break;
    }
  }
  const selected=[...proposals].sort((a,b)=>a[0].localeCompare(b[0])).slice(0,CORRIDOR_CONTINUATION_PARAMS.geometryCap);
  let best=original,bestQ=quality(original,p),validProposals=0;
  const evaluatedProposals=selected.map(([key,proposal])=> {
    const evaluated=evaluatePath(g,shape,p,proposal.path,3000,8000),q=quality(evaluated,p),strict=allowed(evaluated);
    if(strict) { validProposals++; if(q<threshold-1e-7&&q<bestQ-1e-7) {best=evaluated;bestQ=q;} }
    return {key,...proposal,evaluated:{...evaluated,fit:p},strict,raw:100*Math.exp(-q)};
  });
  return { evaluated:{...best,fit:p}, proposals:evaluatedProposals, strongestInputRaw:100*Math.exp(-threshold), afterRaw:100*Math.exp(-bestQ), diagnostics:{transitions,sharedJunctions,uniqueBeforeCap:proposals.size,selected:selected.length,validProposals}, params:CORRIDOR_CONTINUATION_PARAMS };
}
