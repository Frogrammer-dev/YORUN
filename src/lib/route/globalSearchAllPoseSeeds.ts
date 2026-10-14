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
export function globalSearchAllPoseSeeds(g: RoadGraph, shape: ShapeDef, region: Region, attempts = 240, fullRotation = false, rankBySimilarity = false, options: GlobalSearchOptions = {}) {
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
  const seeds=[...buckets.values()].flat().sort((a,b)=>a.score-b.score);
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
  return {candidate:pool[0]??null,evaluated,coarseSeeds:seeds.length,placementSeeds:seeds.map(s=>s.p),pool:pool.slice(0,8)};
}

/* ALL_POSE_SCALE_DIVERSITY_HELPER */
export const ALL_POSE_SELECTION_PARAMS = { scaleTiers: 4, tierBasis: 'distinct-original-scale-percentile-rank', firstPass: 'coarse-best-one-per-tier', fill: 'space-then-symmetry-angle-then-original-rank', originalPosesOnly: true, outlineToleranceMeters: .000001, qualityLabelsUsed: false } as const;

export interface PoseScaleDiversityEntry { pose: Placement; rank: number; scaleTier: number; spaceKey: string; angleKey: number; outlineOrbit: string; }

/** Rotational symmetry around the polygon centroid; no new placement is created. */
function originalPolygonRotationPeriod(shape: ShapeDef) {
  const ps = shape.points.slice(0, -1), n = ps.length;
  if (!n) return 360;
  const cx = ps.reduce((s, p) => s + p[0], 0) / n, cy = ps.reduce((s, p) => s + p[1], 0) / n;
  for (let offset = 1; offset < n; offset++) {
    const radians = 2 * Math.PI * offset / n, c = Math.cos(radians), s = Math.sin(radians);
    if (ps.every(([x, y], i) => { const q = ps[(i + offset) % n]; return Math.hypot((x - cx) * c - (y - cy) * s - (q[0] - cx), (x - cx) * s + (y - cy) * c - (q[1] - cy)) < 1e-8; })) return 360 * offset / n;
  }
  return 360;
}

/** Same physical polygon under a cyclic seam; keep phase variants in the catalog. */
function outlineOrbit(shape: ShapeDef, pose: Placement) {
  const points = placeShape(shape.points, pose).slice(0, -1).map(([x, y]) => Math.round(x * 1e6) + ',' + Math.round(y * 1e6));
  if (!points.length) return '';
  return points.map((_, i) => [...points.slice(i), ...points.slice(0, i)].join(';')).sort()[0];
}

/** Metadata retains every catalog item and its original coarse rank exactly. */
export function poseScaleDiversityMetadata(seeds: readonly Placement[], region: Region, shape: ShapeDef) {
  const scaleValues = [...new Set(seeds.map(p => p.scale))].sort((a, b) => a - b), symmetryDegrees = originalPolygonRotationPeriod(shape);
  const entries: PoseScaleDiversityEntry[] = seeds.map((pose, rank) => {
    const x = Math.min(1, Math.max(0, Math.floor(2 * (pose.cx - region.minX) / Math.max(1e-9, region.maxX - region.minX))));
    const y = Math.min(1, Math.max(0, Math.floor(2 * (pose.cy - region.minY) / Math.max(1e-9, region.maxY - region.minY))));
    const normalizedAngle = ((pose.rotDeg % symmetryDegrees) + symmetryDegrees) % symmetryDegrees;
    return { pose, rank, scaleTier: Math.min(3, Math.floor(4 * scaleValues.indexOf(pose.scale) / Math.max(1, scaleValues.length))), spaceKey: x + ':' + y, angleKey: Math.min(3, Math.floor(4 * normalizedAngle / symmetryDegrees)), outlineOrbit: outlineOrbit(shape, pose) };
  });
  return { scaleValues, symmetryDegrees, entries };
}

/** Four scale tiers first, then spatial/angle coverage, always original poses. */
export function selectPoseScaleDiversity(seeds: readonly Placement[], region: Region, shape: ShapeDef, limit = 8): Placement[] {
  const { entries } = poseScaleDiversityMetadata(seeds, region, shape), selected: PoseScaleDiversityEntry[] = [], identities = new Set<string>(), orbits = new Set<string>(), spaces = new Set<string>(), angles = new Set<number>();
  const take = (entry: PoseScaleDiversityEntry) => {
    const p = entry.pose, identity = [p.cx, p.cy, p.scale, p.rotDeg].join(':');
    if (selected.length >= limit || identities.has(identity)) return;
    selected.push(entry); identities.add(identity); orbits.add(entry.outlineOrbit); spaces.add(entry.spaceKey); angles.add(entry.angleKey);
  };
  const tierBests = [0, 1, 2, 3].map(tier => entries.find(entry => entry.scaleTier === tier)).filter((entry): entry is PoseScaleDiversityEntry => !!entry).sort((a, b) => a.rank - b.rank);
  tierBests.forEach(take);
  for (const entry of entries) if (!spaces.has(entry.spaceKey) && !orbits.has(entry.outlineOrbit)) take(entry);
  for (const entry of entries) if (!angles.has(entry.angleKey) && !orbits.has(entry.outlineOrbit)) take(entry);
  for (const entry of entries) if (!orbits.has(entry.outlineOrbit)) take(entry);
  // A symmetric orbit can still provide distinct original phase-zero/start ports.
  for (const entry of entries) take(entry);
  return selected.map(entry => entry.pose);
}
