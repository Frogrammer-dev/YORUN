import { TimeBudget, type Budget } from './budget';
import { overlap } from './discover';
import { DistanceField, evaluatePath, placeShape, toCandidate, type FindResult, type Region, type RouteCandidate } from './fit';
import { hasEdge, project, type RoadGraph } from './graph';
import { globalSearch } from './globalSearch';
import { searchBlockLoops } from './loopSearch';
import { orderedContourPath } from './orderedContourPath';
import { refinePathPlacement } from './refinePlacement';
import type { ShapeDef } from './shapes';
import { buildBlocks, type BlockMap } from './loops';

const contexts = new WeakMap<RoadGraph, Map<string, { field?: DistanceField; blocks?: BlockMap }>>();
function contextFor(g: RoadGraph, region: Region) {
  const key=JSON.stringify([region.minX,region.minY,region.maxX,region.maxY]);
  const map=contexts.get(g) ?? new Map<string,{field?:DistanceField;blocks?:BlockMap}>();
  const context=map.get(key) ?? {};
  map.set(key,context);
  if(map.size>2)map.delete(map.keys().next().value!);
  contexts.set(g,map);
  return context;
}

export interface QualityOptions {
  shapes: ShapeDef[];
  region: Region;
  minMeters: number;
  maxMeters: number;
  mode: 'discover' | 'shape';
  prefs?: { avoidMajor?: boolean; preferLit?: boolean };
  budget?: Budget;
  timeBudgetMs?: number;
  maxResults?: number;
  onProgress?: (fraction: number, label: string) => void;
}

/** Share a fixed budget between stages without resetting its clock. */
export function budgetSlice(parent: Budget, start: number, end: number): Budget {
  return {
    ok: (fraction = 1) => parent.ok(start + (end - start) * fraction),
    spend: (units) => parent.spend(units),
    remaining: () => Math.max(0, Math.min(1, (parent.remaining() - (1 - end)) / (end - start))),
  };
}

/** Real-road validation is shared by saved incumbents and newly generated paths. */
export function improveRoutes(g: RoadGraph, initial: FindResult, o: QualityOptions): FindResult {
  const budget = o.budget ?? new TimeBudget(o.timeBudgetMs ?? 30_000);
  if (!(o.minMeters > 0) || o.maxMeters < o.minMeters) return initial;
  const entries = new Map<string, { candidate: RouteCandidate; nodes: number[]; quality: number }>();
  const shapes = new Map(o.shapes.map(s => [s.id, s]));
  const inside = (x: number, y: number) => x >= o.region.minX && x <= o.region.maxX && y >= o.region.minY && y <= o.region.maxY;
  let evaluated = initial.evaluated;
  const assess = (c: RouteCandidate) => {
    const shape = shapes.get(c.shapeId);
    if (!shape || !placeShape(shape.points, c.placement).every(([x,y]) => inside(x,y))) return;
    const nodes = c.latlngs.map(([lat,lon]) => g.nodeIndex.nearest(...project(g.origin,lat,lon), .5));
    if (nodes.length < 4 || nodes[0] !== nodes.at(-1) || !nodes.every((v,i) => v >= 0 && inside(g.x[v],g.y[v]) && (!i || hasEdge(g,nodes[i-1],v)))) return;
    const e = evaluatePath(g,shape,c.placement,nodes,o.minMeters,o.maxMeters);
    if (e.lengthMeters < o.minMeters || e.lengthMeters > o.maxMeters || e.repeatRatio > .2) return;
    const candidate = toCandidate(g,shape,c.placement,e);
    // Several road paths can share one drawing placement; selection IDs must distinguish them.
    let fingerprint=2166136261;
    for(const ch of JSON.stringify(candidate.latlngs))fingerprint=Math.imul(fingerprint ^ ch.charCodeAt(0),16777619);
    candidate.id += `-q${(fingerprint>>>0).toString(36)}`;
    const quality = e.meanDev/(.08*c.placement.scale) + Math.log1p(.03*e.zigzagPerKm) - Math.log(.55+.45*e.featureCoverage) - e.spikes*Math.log(.9)
      + (o.prefs?.avoidMajor ? .15*candidate.roadInfo.major : 0)
      + (o.prefs?.preferLit && candidate.roadInfo.lit !== null ? .05*(1-candidate.roadInfo.lit) : 0);
    const key = `${shape.id}:${nodes.join(',')}`, old = entries.get(key);
    if (!old || quality < old.quality) entries.set(key,{candidate,nodes,quality});
  };
  initial.candidates.forEach(assess);
  const sorted = (shape: ShapeDef) => [...entries.values()].filter(e => e.candidate.shapeId === shape.id).sort((a,b) => a.quality-b.quality);
  // In discovery mode refine the best three recognized template families first.
  const targets = o.mode === 'shape' ? o.shapes : [...o.shapes].sort((a,b) => (sorted(a)[0]?.quality ?? Infinity)-(sorted(b)[0]?.quality ?? Infinity)).slice(0,3);
  for (const [si,shape] of targets.entries()) {
    if (!budget.ok()) break;
    const local = budgetSlice(budget,si/targets.length,(si+1)/targets.length);
    const context=contextFor(g,o.region);
    o.onProgress?.(si/targets.length,`${shape.name}에 더 가까운 길`);
    if(local.ok(.25))context.field ??= new DistanceField(g,o.region,12);
    const global = globalSearch(g,shape,o.region,240,true,true,{minMeters:o.minMeters,maxMeters:o.maxMeters,budget:local,fraction:.25,distanceField:context.field});
    evaluated += global.evaluated;
    global.pool.forEach(assess);
    if (local.ok(.7)) {
      const seeds = global.pool.slice(0,3).map(c => c.placement);
      const incumbent = sorted(shape)[0];
      if (incumbent) seeds.push(incumbent.candidate.placement);
      context.blocks ??= buildBlocks(g,(o.region.maxX-o.region.minX)*(o.region.maxY-o.region.minY)/4);
      const loops = searchBlockLoops(g,shape,o.region,seeds,o.minMeters,o.maxMeters,{budget:local,fraction:.7,naturalFraction:.38,blockMap:context.blocks});
      evaluated += loops.evaluated;
      loops.candidates.forEach(assess);
    }
    const refit = (end: number, max: number) => {
      for (const entry of sorted(shape).slice(0,8)) {
        if (!local.ok(end)) break;
        const fit = refinePathPlacement(g,shape,entry.candidate.placement,entry.nodes,o.region,o.minMeters,o.maxMeters,max,budgetSlice(local,0,end));
        if (fit) { evaluated += fit.evaluations; assess(toCandidate(g,shape,fit.placement,fit.evaluated)); }
      }
    };
    refit(.82,160);
    for (const entry of sorted(shape).slice(0,4)) {
      for (const bins of [32,64]) for (const reverse of [false,true]) {
        if (!local.ok(.95)) break;
        if ((bins+1)*(g.adjTo.length+1)>4_000_000) continue;
        const p = entry.candidate.placement, first = placeShape(shape.points,p)[0], start = g.nodeIndex.nearest(first[0],first[1],p.scale*.16);
        const contour = orderedContourPath(g,shape,p,o.region,start,{bins,guideWeight:3,radiusFraction:.16,normalizedCost:true,expectedRoadMeters:entry.candidate.lengthMeters,reverse,maxExpanded:400000,minMeters:o.minMeters,maxMeters:o.maxMeters,budget:budgetSlice(local,0,.95)});
        if (contour.path) { const e=evaluatePath(g,shape,p,contour.path,o.minMeters,o.maxMeters); evaluated++; assess(toCandidate(g,shape,p,e)); }
      }
    }
    refit(1,120);
  }
  const ranked = [...entries.values()].sort((a,b) => a.quality-b.quality);
  const candidates: RouteCandidate[] = [];
  for (const {candidate} of ranked) {
    if (candidates.length >= (o.maxResults ?? 8)) break;
    if (o.mode === 'discover' && (candidate.similarity < 60 || candidates.filter(c => c.shapeId === candidate.shapeId).length >= 2)) continue;
    if (candidates.some(c => overlap(c,candidate) && (o.mode === 'discover' || c.shapeId === candidate.shapeId))) continue;
    candidates.push(candidate);
  }
  candidates.sort((a,b) => b.similarity-a.similarity);
  const validPool = (initial.pool ?? []).filter(c => {
    const nodes=c.latlngs.map(([lat,lon])=>g.nodeIndex.nearest(...project(g.origin,lat,lon),.5));
    if(nodes.length<4 || nodes[0]!==nodes.at(-1) || !nodes.every((v,i)=>v>=0 && inside(g.x[v],g.y[v]) && (!i || hasEdge(g,nodes[i-1],v))))return false;
    const length=nodes.slice(1).reduce((sum,v,i)=>sum+Math.hypot(g.x[v]-g.x[nodes[i]],g.y[v]-g.y[nodes[i]]),0);
    return length>=o.minMeters && length<=o.maxMeters;
  });
  o.onProgress?.(1,'');
  return {candidates, evaluated, partial:initial.partial || !budget.ok(), pool:o.mode === 'discover' ? [...validPool,...ranked.map(e => e.candidate)] : initial.pool};
}
