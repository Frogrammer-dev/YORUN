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
  prefs?: { avoidMajor?: boolean; preferLit?: boolean; preferCarFree?: boolean };
  budget?: Budget;
  timeBudgetMs?: number;
  maxResults?: number;
  /** (실험 E4) 윤곽 따라가기 경로의 꺾임 비용 계수. 없으면 기존 0.03 */
  contourTurnCost?: number;
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


export type ImprovedEntry = { key: string; candidate: RouteCandidate; nodes: number[]; quality: number };

/** 후보를 실제 도로로 다시 검사하고 품질(낮을수록 좋음)을 매겨 모은다 */
function assessor(g: RoadGraph, o: QualityOptions) {
  const entries = new Map<string, ImprovedEntry>();
  const shapes = new Map(o.shapes.map(s => [s.id, s]));
  const inside = (x: number, y: number) => x >= o.region.minX && x <= o.region.maxX && y >= o.region.minY && y <= o.region.maxY;
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
      + (o.prefs?.preferLit && candidate.roadInfo.lit !== null ? .05*(1-candidate.roadInfo.lit) : 0)
      + (o.prefs?.preferCarFree ? .1*(1-candidate.roadInfo.carFree) : 0);
    const key = `${shape.id}:${nodes.join(',')}`;
    add({ key, candidate, nodes, quality });
  };
  const add = (e: ImprovedEntry) => {
    const old = entries.get(e.key);
    if (!old || e.quality < old.quality) entries.set(e.key, e);
  };
  const sorted = (shape: ShapeDef) => [...entries.values()].filter(e => e.candidate.shapeId === shape.id).sort((a,b) => a.quality-b.quality);
  return { entries, assess, add, sorted };
}

type Assessor = ReturnType<typeof assessor>;

/** 동네 추천은 이미 잘 맞는 상위 세 그림만 다듬는다 */
function refineTargets(o: QualityOptions, a: Assessor): ShapeDef[] {
  return o.mode === 'shape' ? o.shapes : [...o.shapes].sort((x,y) => (a.sorted(x)[0]?.quality ?? Infinity)-(a.sorted(y)[0]?.quality ?? Infinity)).slice(0,3);
}

/** 그림 하나를 주어진 예산 안에서 다듬는다. 다른 그림의 후보와 서로 영향이 없어 따로(병렬로) 돌릴 수 있다 */
function refineShape(g: RoadGraph, shape: ShapeDef, o: QualityOptions, local: Budget, a: Assessor): number {
  let evaluated = 0;
  const { assess, sorted } = a;
  const context=contextFor(g,o.region);
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
      const contour = orderedContourPath(g,shape,p,o.region,start,{bins,guideWeight:3,radiusFraction:.16,normalizedCost:true,expectedRoadMeters:entry.candidate.lengthMeters,reverse,maxExpanded:400000,turnCost:o.contourTurnCost,minMeters:o.minMeters,maxMeters:o.maxMeters,budget:budgetSlice(local,0,.95)});
      if (contour.path) { const e=evaluatePath(g,shape,p,contour.path,o.minMeters,o.maxMeters); evaluated++; assess(toCandidate(g,shape,p,e)); }
    }
  }
  refit(1,120);
  return evaluated;
}

/** 모은 후보에서 겹치지 않는 결과를 고른다 */
function finish(g: RoadGraph, initial: FindResult, o: QualityOptions, a: Assessor, evaluated: number, partial: boolean): FindResult {
  const inside = (x: number, y: number) => x >= o.region.minX && x <= o.region.maxX && y >= o.region.minY && y <= o.region.maxY;
  const ranked = [...a.entries.values()].sort((x,y) => x.quality-y.quality);
  const candidates: RouteCandidate[] = [];
  for (const {candidate} of ranked) {
    if (candidates.length >= (o.maxResults ?? 8)) break;
    if (o.mode === 'discover' && (candidate.similarity < 60 || candidates.filter(c => c.shapeId === candidate.shapeId).length >= 2)) continue;
    if (candidates.some(c => overlap(c,candidate) && (o.mode === 'discover' || c.shapeId === candidate.shapeId))) continue;
    candidates.push(candidate);
  }
  candidates.sort((x,y) => y.similarity-x.similarity);
  const validPool = (initial.pool ?? []).filter(c => {
    const nodes=c.latlngs.map(([lat,lon])=>g.nodeIndex.nearest(...project(g.origin,lat,lon),.5));
    if(nodes.length<4 || nodes[0]!==nodes.at(-1) || !nodes.every((v,i)=>v>=0 && inside(g.x[v],g.y[v]) && (!i || hasEdge(g,nodes[i-1],v))))return false;
    const length=nodes.slice(1).reduce((sum,v,i)=>sum+Math.hypot(g.x[v]-g.x[nodes[i]],g.y[v]-g.y[nodes[i]]),0);
    return length>=o.minMeters && length<=o.maxMeters;
  });
  o.onProgress?.(1,'');
  return {candidates, evaluated, partial:initial.partial || partial, pool:o.mode === 'discover' ? [...validPool,...ranked.map(e => e.candidate)] : initial.pool};
}

/** Real-road validation is shared by saved incumbents and newly generated paths. */
export function improveRoutes(g: RoadGraph, initial: FindResult, o: QualityOptions): FindResult {
  const budget = o.budget ?? new TimeBudget(o.timeBudgetMs ?? 30_000);
  if (!(o.minMeters > 0) || o.maxMeters < o.minMeters) return initial;
  const a = assessor(g,o);
  let evaluated = initial.evaluated;
  initial.candidates.forEach(a.assess);
  const targets = refineTargets(o,a);
  for (const [si,shape] of targets.entries()) {
    if (!budget.ok()) break;
    const local = budgetSlice(budget,si/targets.length,(si+1)/targets.length);
    o.onProgress?.(si/targets.length,`${shape.name}에 더 가까운 길`);
    evaluated += refineShape(g,shape,o,local,a);
  }
  return finish(g,initial,o,a,evaluated,!budget.ok());
}

// ───────── 병렬 다듬기 (동네 추천): 그림마다 다른 Worker에서 refineShape를 돌리고 합친다 ─────────

/** 다듬을 그림 목록 (순차 improveRoutes와 같은 순서) */
export function improveTargetIds(g: RoadGraph, initial: FindResult, o: QualityOptions): string[] {
  if (!(o.minMeters > 0) || o.maxMeters < o.minMeters) return [];
  const a = assessor(g,o);
  initial.candidates.forEach(a.assess);
  return refineTargets(o,a).map(s => s.id);
}

/** 그림 하나만 다듬어 그 그림의 후보를 돌려준다 (Worker 하나의 몫) */
export function improveOneShape(g: RoadGraph, initial: FindResult, o: QualityOptions, shapeId: string): { entries: ImprovedEntry[]; evaluated: number; partial: boolean } {
  const budget = o.budget ?? new TimeBudget(o.timeBudgetMs ?? 30_000);
  const shape = o.shapes.find(s => s.id === shapeId);
  if (!shape || !(o.minMeters > 0) || o.maxMeters < o.minMeters) return { entries: [], evaluated: 0, partial: false };
  const a = assessor(g,o);
  initial.candidates.forEach(a.assess);
  const evaluated = refineShape(g,shape,o,budget,a);
  return { entries: a.sorted(shape), evaluated, partial: !budget.ok() };
}

/** 그림별로 다듬은 후보를 합쳐 순차 improveRoutes와 같은 규칙으로 고른다 */
export function mergeImproved(g: RoadGraph, initial: FindResult, o: QualityOptions, parts: Array<{ entries: ImprovedEntry[]; evaluated: number; partial: boolean }>): FindResult {
  if (!(o.minMeters > 0) || o.maxMeters < o.minMeters) return initial;
  const a = assessor(g,o);
  initial.candidates.forEach(a.assess);
  for (const part of parts) part.entries.forEach(a.add);
  return finish(g,initial,o,a,initial.evaluated + parts.reduce((s,p) => s + p.evaluated, 0), parts.some(p => p.partial));
}
