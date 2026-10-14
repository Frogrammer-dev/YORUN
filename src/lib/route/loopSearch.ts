import { StepBudget, type Budget } from './budget';
import { evaluatePath, placeShape, toCandidate, type Placement, type Region, type RouteCandidate } from './fit';
import type { RoadGraph } from './graph';
import { buildBlocks, growLoops, matchShape, shapeSamples, unionForPlacement, type BlockMap, type NaturalLoop } from './loops';
import type { ShapeDef } from './shapes';
export interface BlockLoopSearchOptions {
 fullRotation?: boolean;
 /** Opt-in union of default/full fits and quick pools; performs extra work. */
 preserveDefaultFits?: boolean;
 budget?: Budget;
 /** Absolute upper fraction of the shared budget, defaults to 1. */
 fraction?: number;
 /** Natural loops stop earlier; defaults to 35% of fraction with a shared budget. */
 naturalFraction?: number;
 /** Must be built from this exact graph with this region's area/4 face limit. */
 blockMap?: BlockMap;
}
export function searchBlockLoops(g:RoadGraph,shape:ShapeDef,region:Region,seeds:Placement[], minMeters=3000,maxMeters=8000,options:BlockLoopSearchOptions={}){
 const available=()=>!options.budget||options.budget.ok(options.fraction??1);
 if(!Number.isFinite(minMeters)||!Number.isFinite(maxMeters)||minMeters<=0||maxMeters<minMeters||region.maxX<=region.minX||region.maxY<=region.minY||!available())return {candidates:[] as RouteCandidate[],evaluated:0,blocks:options.blockMap?.faces.length??0,naturalCount:0};
 const m=options.blockMap??buildBlocks(g,(region.maxX-region.minX)*(region.maxY-region.minY)/4),tmpl=shapeSamples(shape),seen=new Set<string>();
 const all:RouteCandidate[]=[];let evaluated=0,quickMatchingCalls=0,assessMatchingCalls=0;
 const dual=!!options.fullRotation&&!!options.preserveDefaultFits;
 const fitModes=dual?[false,true]:[options.fullRotation];
 const seenPaths=new Map<string,Set<string>>();let additionalSeenFacePaths=0;
 const assess=(loop:NaturalLoop|null,allowAdditionalPath=false)=>{
  if(!available()||!loop||loop.length<minMeters||loop.length>maxMeters)return;
  const key=loop.faces.slice().sort((a,b)=>a-b).join(','),alreadySeen=seen.has(key);
  if(alreadySeen&&(!dual||!allowAdditionalPath))return;
  const pathKey=dual?loop.path.join(','):'';
  if(alreadySeen&&seenPaths.get(key)?.has(pathKey))return;
  if(alreadySeen)additionalSeenFacePaths++;
  if(!dual)seen.add(key);
  const p=loop.path;if(p.length<4||p[0]!==p.at(-1)||!p.every((v,i)=>g.x[v]>=region.minX-1&&g.x[v]<=region.maxX+1&&g.y[v]>=region.minY-1&&g.y[v]<=region.maxY+1&&(!i||g.adjTo.slice(g.adjStart[p[i-1]],g.adjStart[p[i-1]+1]).includes(v))))return;
  const xy=p.map(v=>[g.x[v],g.y[v]] as [number,number]);
  for(const fullRotation of fitModes){
   if(!available())return;
   options.budget?.spend();assessMatchingCalls++;
   const fit=matchShape(xy,shape,tmpl,true,undefined,{fullRotation});if(!fit)continue;
   if(!placeShape(shape.points,fit).every(([x,y])=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY))continue;
   if(!available())return;
   options.budget?.spend();
   const e=evaluatePath(g,shape,fit,p,minMeters,maxMeters);evaluated++;
   if(e.lengthMeters<minMeters||e.lengthMeters>maxMeters||e.repeatRatio>.2)continue;
   all.push(toCandidate(g,shape,fit,e));
  }
  // In dual mode both fits are assessed before marking this face set complete.
  if(dual){seen.add(key);const paths=seenPaths.get(key)??new Set<string>();paths.add(pathKey);seenPaths.set(key,paths);}
 };
 const natural=growLoops(g,m,region,minMeters,maxMeters,{seeds:Math.min(2000,m.faces.length),budget:options.budget??new StepBudget(2000),fraction:options.budget?(options.naturalFraction??(options.fraction??1)*.35):1,seed:83721});
 const makeQuick=(fullRotation:boolean|undefined)=>natural.map(loop=>{if(!available())return {loop,fit:null};options.budget?.spend();quickMatchingCalls++;return {loop,fit:matchShape(loop.path.map(v=>[g.x[v],g.y[v]] as [number,number]),shape,tmpl,false,undefined,{fullRotation})};}).filter(q=>q.fit).sort((a,b)=>a.fit!.resid-b.fit!.resid);
 const quick=makeQuick(dual?false:options.fullRotation),quickFull=dual?makeQuick(true):[];
 // Finish the exact original default order before any new full-only faces can consume seen keys.
 for(const q of quick.slice(0,400)){if(!available())break;assess(q.loop);}
 const basePlacements=[...seeds,...quick.slice(0,12).map(q=>q.fit!)],extraPlacements=dual?quickFull.slice(0,12).map(q=>q.fit!):[];
 const placements=[...basePlacements,...extraPlacements];
 const unionPlacements=(items:Placement[],allowAdditionalPath=false)=>{
  placementSearch: for(const p of items)for(const dx of [-.04,0,.04])for(const dy of [-.04,0,.04])for(const ds of [.94,1,1.06])for(const dr of [-5,0,5])for(const threshold of [.3,.5,.7]){
   if(!available())break placementSearch;
   options.budget?.spend();
   assess(unionForPlacement(g,m,shape,{cx:p.cx+dx*p.scale,cy:p.cy+dy*p.scale,scale:p.scale*ds,rotDeg:p.rotDeg+dr},region,threshold),allowAdditionalPath);
  }
 };
 unionPlacements(basePlacements);
 if(dual){
  for(const q of quickFull.slice(0,400)){if(!available())break;assess(q.loop,true);}
  unionPlacements(extraPlacements,true);
 }
 all.sort((a,b)=>b.similarity-a.similarity||a.cost-b.cost);
 const result={candidates:all,evaluated,blocks:m.faces.length,naturalCount:natural.length};
 return dual?{...result,dualFitDiagnostics:{quickMatchingCalls,assessMatchingCalls,additionalSeenFacePaths,defaultStageCompletedFirst:true,defaultQuickTop:Math.min(400,quick.length),fullQuickTop:Math.min(400,quickFull.length),placementSeedCount:placements.length,defaultPlacementSeeds:Math.min(12,quick.length),fullPlacementSeeds:Math.min(12,quickFull.length),extraWork:true}}:result;
}
import { traceUnion } from './loops';
/** Improve a saved road loop by flipping one neighboring block, keeping the original scoring rule. */
export function refineLoopFaces(g:RoadGraph,shape:ShapeDef,region:Region,input:RouteCandidate,minMeters=3000,maxMeters=8000){
 const m=buildBlocks(g,(region.maxX-region.minX)*(region.maxY-region.minY)/4),tmpl=shapeSamples(shape);
 const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
 const vertices=input.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
 if(vertices.some(v=>v<0))return {candidate:input,evaluated:0};
 const inside=(x:number,y:number)=>{let yes=false;for(let i=0,j=vertices.length-1;i<vertices.length;j=i++){const a=vertices[i],b=vertices[j];if((g.y[a]>y)!==(g.y[b]>y)&&x<(g.x[b]-g.x[a])*(y-g.y[a])/(g.y[b]-g.y[a])+g.x[a])yes=!yes;}return yes;};
 let set=new Set(m.faces.map((f,i)=>f.samples.some(([x,y])=>inside(x,y))?i:-1).filter(i=>i>=0)),best=input,evaluated=0;
 const initial=new Uint8Array(m.faces.length+1);for(const f of set)initial[f]=1;
 const initialPath=traceUnion(g,m,initial,[...set]);if(!initialPath)return{candidate:input,evaluated};
 for(let iteration=0;iteration<4;iteration++){
  const boundary=new Set<number>();for(const f of set)for(const h of m.faces[f].hes){const other=m.heFace[h^1];if(other<0||!set.has(other)){boundary.add(f);if(other>=0)boundary.add(other);}}
  let nextSet:Set<number>|null=null,next=best;
  const ids=[...boundary].sort((a,b)=>m.faces[a].area-m.faces[b].area).slice(0,180);
  for(const f of ids){
   const proposed=new Set(set);if(proposed.has(f))proposed.delete(f);else proposed.add(f);
   const flags=new Uint8Array(m.faces.length+1);for(const id of proposed)flags[id]=1;
   const path=traceUnion(g,m,flags,[...proposed]);if(!path||path.length<4||path[0]!==path.at(-1))continue;
   if(!path.every((v,i)=>g.x[v]>=region.minX-1&&g.x[v]<=region.maxX+1&&g.y[v]>=region.minY-1&&g.y[v]<=region.maxY+1&&(!i||g.adjTo.slice(g.adjStart[path[i-1]],g.adjStart[path[i-1]+1]).includes(v))))continue;
   const fits=[best.placement];const fit=matchShape(path.map(v=>[g.x[v],g.y[v]] as [number,number]),shape,tmpl,true);if(fit)fits.push(fit);
   for(const p of fits){if(!placeShape(shape.points,p).every(([x,y])=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY))continue;const e=evaluatePath(g,shape,p,path,minMeters,maxMeters);evaluated++;if(e.lengthMeters<minMeters||e.lengthMeters>maxMeters||e.repeatRatio>.2)continue;
    if(e.similarity>next.similarity||(e.similarity===next.similarity&&e.cost<next.cost)){next=toCandidate(g,shape,p,e);nextSet=proposed;}}
  }
  if(!nextSet)break;best=next;set=nextSet;
 }
 return {candidate:best,evaluated};
}

export interface FaceBeamOptions {
 beamWidth?:number;
 maxDepth?:number;
 maxStates?:number;
 maxEvaluations?:number;
 boundaryLimit?:number;
}

/** Bounded multi-start beam search over actual neighboring road blocks.
 * Intermediate states may score worse, but the returned result never loses the best valid seed.
 */
export function refineLoopFacesBeam(g:RoadGraph,shape:ShapeDef,region:Region,inputs:RouteCandidate[],options:FaceBeamOptions={},minMeters=3000,maxMeters=8000){
 const {beamWidth=4,maxDepth=6,maxStates=700,maxEvaluations=1200,boundaryLimit=100}=options;
 const m=buildBlocks(g,(region.maxX-region.minX)*(region.maxY-region.minY)/4),tmpl=shapeSamples(shape);
 const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
 const within=(x:number,y:number)=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY;
 const validPath=(p:number[])=>p.length>=4&&p[0]===p.at(-1)&&p.every((v,i)=>v>=0&&within(g.x[v],g.y[v])&&(!i||g.adjTo.slice(g.adjStart[p[i-1]],g.adjStart[p[i-1]+1]).includes(v)));
 const validPlacement=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>within(x,y));
 type State={faces:Set<number>;candidate:RouteCandidate;score:number};
 const objective=(e:ReturnType<typeof evaluatePath>,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
 let best:RouteCandidate|null=null,bestScore=Infinity,evaluated=0,states=0,completedDepth=0;
 const seen=new Set<string>();
 const retained=new Map<string,{candidate:RouteCandidate;score:number}>();
 const remember=(candidate:RouteCandidate,score:number,nodes:number[])=>{
  const key=nodes.slice(1).map((v,i)=>nodes[i]<v?`${nodes[i]}-${v}`:`${v}-${nodes[i]}`).sort().join(',');
  if(!retained.has(key)||retained.get(key)!.score>score)retained.set(key,{candidate,score});
  if(retained.size>24){const last=[...retained.entries()].sort((a,b)=>a[1].score-b[1].score).at(-1)!;retained.delete(last[0]);}
 };
 const assess=(faces:Set<number>,placements:Placement[]):State|null=>{
  const key=[...faces].sort((a,b)=>a-b).join(',');if(seen.has(key)||states>=maxStates)return null;seen.add(key);states++;
  const flags=new Uint8Array(m.faces.length+1);for(const f of faces)flags[f]=1;
  const nodes=traceUnion(g,m,flags,[...faces]);if(!nodes||!validPath(nodes))return null;
  const fit=matchShape(nodes.map(v=>[g.x[v],g.y[v]] as [number,number]),shape,tmpl,true);
  if(fit)placements=[...placements,fit];
  let candidate:RouteCandidate|null=null,score=Infinity;
  for(const p of placements){
   if(evaluated>=maxEvaluations)break;if(!validPlacement(p))continue;
   const e=evaluatePath(g,shape,p,nodes,minMeters,maxMeters);evaluated++;
   if(e.lengthMeters<minMeters||e.lengthMeters>maxMeters||e.repeatRatio>.2)continue;
   const value=objective(e,p);if(value<score){score=value;candidate=toCandidate(g,shape,p,e);}
  }
  if(!candidate)return null;remember(candidate,score,nodes);if(score<bestScore){best=candidate;bestScore=score;}
  return {faces,candidate,score};
 };
 const initial:State[]=[];
 for(const input of inputs){
  const nodes=input.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
  if(!validPath(nodes)||!validPlacement(input.placement))continue;
  const e=evaluatePath(g,shape,input.placement,nodes,minMeters,maxMeters);evaluated++;
  if(e.lengthMeters<minMeters||e.lengthMeters>maxMeters||e.repeatRatio>.2)continue;
  const score=objective(e,input.placement),candidate=toCandidate(g,shape,input.placement,e);remember(candidate,score,nodes);if(score<bestScore){best=candidate;bestScore=score;}
  const contains=(x:number,y:number)=>{let yes=false;for(let i=0,j=nodes.length-1;i<nodes.length;j=i++){const a=nodes[i],b=nodes[j];if((g.y[a]>y)!==(g.y[b]>y)&&x<(g.x[b]-g.x[a])*(y-g.y[a])/(g.y[b]-g.y[a])+g.x[a])yes=!yes;}return yes;};
  const faces=new Set(m.faces.map((f,i)=>f.samples.some(([x,y])=>contains(x,y))?i:-1).filter(i=>i>=0));
  const state=assess(faces,[input.placement]);if(state)initial.push(state);
 }
 let beam=initial.sort((a,b)=>a.score-b.score).slice(0,beamWidth);
 for(let depth=0;depth<maxDepth&&beam.length&&states<maxStates&&evaluated<maxEvaluations;depth++){
  const next:State[]=[];
  // Interleave neighbors across parents so one parent's boundary cannot consume the entire budget.
  const boundaries=beam.map(parent=>{
   const ids=new Set<number>();for(const f of parent.faces)for(const h of m.faces[f].hes){const other=m.heFace[h^1];if(other<0||!parent.faces.has(other)){ids.add(f);if(other>=0)ids.add(other);}}
   const byArea=[...ids].sort((a,b)=>m.faces[a].area-m.faces[b].area);
   const selected=byArea.slice(0,Math.ceil(boundaryLimit*.6));
   const rest=byArea.slice(selected.length);for(let i=0;i<boundaryLimit-selected.length&&rest.length;i++)selected.push(rest[Math.floor(i*rest.length/Math.max(1,boundaryLimit-Math.ceil(boundaryLimit*.6)))]);
   return [...new Set(selected)];
  });
  for(let i=0;i<boundaryLimit&&states<maxStates&&evaluated<maxEvaluations;i++)for(let parentId=0;parentId<beam.length;parentId++){
   const f=boundaries[parentId][i];if(f===undefined)continue;const parent=beam[parentId],faces=new Set(parent.faces);
   if(faces.has(f))faces.delete(f);else faces.add(f);
   const state=assess(faces,[parent.candidate.placement]);if(state)next.push(state);
  }
  beam=next.sort((a,b)=>a.score-b.score).slice(0,beamWidth);completedDepth=depth+1;
 }
 return {candidate:best,pool:[...retained.values()].sort((a,b)=>a.score-b.score).map(p=>p.candidate),evaluated,states,completedDepth,seedStates:initial.length};
}
