import type { Budget } from "./budget";
import { DistanceField, dominantGridAngle, placeShape, routePlacement, toCandidate, type Placement, type Region, type RouteCandidate } from "./fit";
import { hasEdge, PathFinder, type RoadGraph } from "./graph";
import { resample, type ShapeDef } from "./shapes";

export interface GlobalSearchOptions {
  minMeters?: number;
  maxMeters?: number;
  budget?: Budget;
  /** Absolute fraction of the shared budget available through this phase. */
  fraction?: number;
  /** Reuse only for this exact graph/region and the original cell=12, cap=200. */
  distanceField?: DistanceField;
}

/** Experimental search: diversify actual routing across size, angle and location.
 * The evaluation formula and drawing templates remain unchanged.
 */
export function globalSearchScaleInterleaved(g: RoadGraph, shape: ShapeDef, region: Region, attempts = 240, fullRotation = false, rankBySimilarity = false, options: GlobalSearchOptions = {}) {
  const minMeters=options.minMeters??3000,maxMeters=options.maxMeters??8000;
  const available=()=>!options.budget||options.budget.ok(options.fraction??1);
  const empty=()=>({candidate:null,evaluated:0,coarseSeeds:0,placementSeeds:[] as Placement[],pool:[] as RouteCandidate[]});
  const width = region.maxX-region.minX, height=region.maxY-region.minY;
  const low=minMeters/(1.5*shape.perimeter),high=Math.min(maxMeters/shape.perimeter,Math.min(width,height)*.97);
  if(!Number.isFinite(low)||!Number.isFinite(high)||minMeters<=0||maxMeters<minMeters||low<=0||high<low||width<=0||height<=0||!available())return empty();
  const field = options.distanceField??new DistanceField(g, region, 12);
  const finder = new PathFinder(g);
  const samples=resample(shape.points,64);
  const angle=dominantGridAngle(g);
  const rotations=[...new Set([...(fullRotation?Array.from({length:24},(_,i)=>i*15-180):[-45,-30,-15,0,15,30,45]),angle-8,angle,angle+8].map(x=>Math.round(x)))];
  const buckets=new Map<string,Array<{p:Placement;score:number}>>();
  const inside=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY);
  coarse: for(let si=0;si<8;si++) {
    const scale=low*Math.pow(high/low,si/7),step=Math.max(45,scale*.09);
    for(let ri=0;ri<rotations.length;ri++) for(let cx=region.minX+scale*.3;cx<=region.maxX-scale*.3;cx+=step) for(let cy=region.minY+scale*.3;cy<=region.maxY-scale*.3;cy+=step) {
      if(!available())break coarse;
      options.budget?.spend();
      const p={cx,cy,scale,rotDeg:rotations[ri]};if(!inside(p))continue;
      const distances=placeShape(samples,p).map(([x,y])=>field.get(x,y));
      const score=distances.reduce((a,b)=>a+b,0)/distances.length/scale+Math.max(...distances)/scale*.15;
      const key=`${Math.floor((cx-region.minX)/width*3)}-${Math.floor((cy-region.minY)/height*3)}-${Math.floor(si/2)}-${Math.floor(ri/3)}`;
      const bucket=buckets.get(key)??[];bucket.push({p,score});bucket.sort((a,b)=>a.score-b.score);if(bucket.length>3)bucket.pop();buckets.set(key,bucket);
    }
  }
  const seeds=scaleInterleavedSeeds([...buckets.values()].flat().sort((a,b)=>a.score-b.score));
  const pool:RouteCandidate[]=[];let evaluated=0;
  const qualities=new WeakMap<RouteCandidate,number>();
  const rank=(c:RouteCandidate)=>rankBySimilarity?qualities.get(c)!:c.cost;
  const check=(p:Placement)=>{
    if(!available()||!inside(p))return undefined;
    options.budget?.spend();
    evaluated++;const e=routePlacement(g,finder,shape,p,minMeters,maxMeters,true,"flex");if(!e)return undefined;
    if(e.path.length<4||e.path[0]!==e.path.at(-1))return undefined;
    if(!e.path.every((node,i)=>i===0||hasEdge(g,e.path[i-1],node)))throw new Error("Search produced a disconnected route");
    const c=toCandidate(g,shape,e.fit??p,e);
    if(c.lengthMeters<minMeters||c.lengthMeters>maxMeters||c.repeatRatio>.2)return undefined;
    if(!e.path.every(n=>g.x[n]>=region.minX-1&&g.x[n]<=region.maxX+1&&g.y[n]>=region.minY-1&&g.y[n]<=region.maxY+1))return undefined;
    qualities.set(c,e.meanDev/(.08*c.placement.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9));
    pool.push(c);return c;
  };
  for(const s of seeds.slice(0,attempts)){if(!available())break;check(s.p);}
  pool.sort((a,b)=>rank(a)-rank(b));
  const parents=pool.slice(0,6);
  local: for(const parent of parents) {
    let best=parent;
    for(const factor of [1,.5])for(const [dx,dy,ds,dr] of [[-.04,0,0,0],[.04,0,0,0],[0,-.04,0,0],[0,.04,0,0],[0,0,-.05,0],[0,0,.05,0],[0,0,0,-6],[0,0,0,6]]) {
      if(!available())break local;
      const p=best.placement,c=check({cx:p.cx+dx*p.scale*factor,cy:p.cy+dy*p.scale*factor,scale:p.scale*(1+ds*factor),rotDeg:p.rotDeg+dr*factor});
      if(c&&rank(c)<rank(best))best=c;
    }
  }
  pool.sort((a,b)=>rank(a)-rank(b));
  return {candidate:pool[0]??null,evaluated,coarseSeeds:seeds.length,placementSeeds:seeds.slice(0,48).map(s=>s.p),pool:pool.slice(0,8)};
}

/* SCALE_INTERLEAVED_GLOBAL_HELPER */
export const SCALE_INTERLEAVED_GLOBAL_PARAMS = { scaleTiers: 4, basis: 'distinct-original-scale-percentile-rank', order: 'tier-rank-round-robin', emptyTiersSkipped: true, exhaustedTiersSkipped: true, coarseScoreUnchanged: true, originalPosesOnly: true, templateAndQUnchanged: true } as const;

/** Reorders original coarse entries only; this creates no route, pose or score. */
export function scaleInterleavedSeeds<T extends { p: Placement; score: number }>(ranked: readonly T[]): T[] {
  const scales = [...new Set(ranked.map(entry => entry.p.scale))].sort((a, b) => a - b);
  const tiers = Array.from({ length: 4 }, () => [] as T[]);
  for (const entry of ranked) {
    const tier = Math.min(3, Math.floor(4 * scales.indexOf(entry.p.scale) / Math.max(1, scales.length)));
    tiers[tier].push(entry);
  }
  const result: T[] = [];
  for (let rank = 0; result.length < ranked.length; rank++) {
    for (const tier of tiers) if (rank < tier.length) result.push(tier[rank]);
  }
  return result;
}
