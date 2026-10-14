import { StepBudget } from './budget';
import { evaluatePath, findRoutes, placeShape, toCandidate, type Placement, type Region, type RouteCandidate } from './fit';
import { hasEdge, project, type RoadGraph } from './graph';
import { globalSearch } from './globalSearch';
import { searchBlockLoops, refineLoopFacesBeam } from './loopSearch';
import { largeSegmentRepair } from './largeSegmentRepair';
import { orderedContourPath } from './orderedContourPath';
import { pairEdgeKey, pairPhaseZero, pairSegmentRepair } from './pairSegmentRepair';
import { refinePathPlacement } from './refinePlacement';
import type { ShapeDef, ShapeId } from './shapes';

export const OFFLINE_CASCADE_PARAMS={detail:'simple',excludeSteps:true,minMeters:3000,maxMeters:8000,repeatMax:.2,baselineSteps:80,baselineResults:8,globalAttempts:240,globalFullRotation:true,rankBySimilarity:true,blockFullRotation:false,blockPreserveDefaultFits:false,naturalLoopSeeds:2000,quickNaturalTop:400,initialRefitTop:8,initialRefitBudget:160,orderedPoseMax:4,orderedBins:[32,64],orderedRadius:.16,orderedMaxExpanded:400000,finalRefitTop:8,finalRefitBudget:120,beamInputs:3,beamWidth:3,beamDepth:10,beamStates:1400,beamEvaluations:2500,beamBoundaryLimit:60,largeAttempts:144,largeMaxExpanded:18000,pairRouting:128,pairAlternatives:64,pairEvaluations:512,phaseRefitBudget:128,phaseRefitShiftMax:.2,phaseRefitScaleBounds:[.8,1.2],phaseRefitRotationMax:30};
export interface OfflineCascadeOptions { onProgress?:(stage:string)=>void; }

/** Offline, deterministic, road-input-only search. The entire unchanged cold
 * pipeline finishes before refinements; no manually supplied or stored routes.
 * Experimental follow-up work is additional budget, not live app performance.
 */
export function offlineCascadeSearch(g:RoadGraph,shape:ShapeDef,region:Region,options:OfflineCascadeOptions={}){
 const {minX,minY,maxX,maxY}=region,shapeId=shape.id as ShapeId;
 const began=Date.now(),timings:Record<string,number>={},diagnostics:Record<string,unknown>={};
 const progress=(stage:string)=>options.onProgress?.(stage);
 progress('baseline');
    const validNodes=(p:number[])=>p.length>=4&&p[0]===p.at(-1)&&p.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,p[i-1],v)));
    const validPose=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY);
    const nodesFor=(c:RouteCandidate)=>c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
    const objective=(e:ReturnType<typeof evaluatePath>,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
    type Entry={candidate:RouteCandidate;nodes:number[];quality:number;method:string};const pool=new Map<string,Entry>();
    const assess=(c:RouteCandidate,method:string):Entry|null=>{if(!validPose(c.placement))return null;const nodes=nodesFor(c);if(!validNodes(nodes))return null;const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)return null;const quality=objective(e,c.placement),entry={candidate:toCandidate(g,shape,c.placement,e),nodes,quality,method},id=nodes.join(',');if(!pool.has(id)||pool.get(id)!.quality>quality)pool.set(id,entry);return entry;};
    const sorted=()=>[...pool.values()].sort((a,b)=>a.quality-b.quality);
    const refit=(top:number,budget:number)=>{let evaluations=0;for(const entry of sorted().slice(0,top)){const refined=refinePathPlacement(g,shape,entry.candidate.placement,entry.nodes,region,3000,8000,budget);if(!refined)continue;evaluations+=refined.evaluations;assess(toCandidate(g,shape,refined.placement,refined.evaluated),`${entry.method}+uniform-refit`);}return evaluations;};
    let stageBegan=Date.now();const baselineSearch=findRoutes(g,{shapes:[shapeId],region,minMeters:3000,maxMeters:8000,budget:new StepBudget(80),resultsPerShape:8});let baseline:RouteCandidate|null=null;
    for(const c of baselineSearch.candidates){const entry=assess(c,'baseline');if(!baseline&&entry)baseline=entry.candidate;}timings.baseline=Date.now()-stageBegan;diagnostics.baselineEvaluated=baselineSearch.evaluated;
    progress('global');stageBegan=Date.now();const global=globalSearch(g,shape,region,240,true,true),globalEntries:Entry[]=[];for(const c of global.pool){const entry=assess(c,'global');if(entry)globalEntries.push(entry);}timings.global=Date.now()-stageBegan;diagnostics.globalEvaluated=global.evaluated;diagnostics.globalCoarseSeeds=global.coarseSeeds;
    progress('block-loops');stageBegan=Date.now();const seeds=globalEntries.sort((a,b)=>a.quality-b.quality).slice(0,3).map(e=>e.candidate.placement);if(baseline)seeds.push(baseline.placement);const loops=searchBlockLoops(g,shape,region,seeds,3000,8000);for(const c of loops.candidates)assess(c,'block-loops');timings.blockLoops=Date.now()-stageBegan;diagnostics.loopEvaluated=loops.evaluated;diagnostics.loopBlocks=loops.blocks;diagnostics.naturalLoops=loops.naturalCount;
    progress('initial-refit');stageBegan=Date.now();diagnostics.initialRefitEvaluations=refit(8,160);timings.initialRefit=Date.now()-stageBegan;
    progress('ordered-contour');stageBegan=Date.now();const poses:Entry[]=[];for(const entry of sorted()){const p=entry.candidate.placement;if(poses.some(q=>Math.hypot((p.cx-q.candidate.placement.cx)/p.scale,(p.cy-q.candidate.placement.cy)/p.scale,Math.log(p.scale/q.candidate.placement.scale),Math.abs(((p.rotDeg-q.candidate.placement.rotDeg+540)%360)-180)/180)<.025))continue;poses.push(entry);if(poses.length===4)break;}
    const orderedTrials=[];for(const entry of poses){const p=entry.candidate.placement,first=placeShape(shape.points,p)[0],start=g.nodeIndex.nearest(first[0],first[1],p.scale*.16);for(const bins of [32,64])for(const reverse of [false,true]){const ordered=orderedContourPath(g,shape,p,region,start,{bins,guideWeight:3,radiusFraction:.16,normalizedCost:true,expectedRoadMeters:entry.candidate.lengthMeters,reverse,maxExpanded:400000});let similarity:number|null=null;if(ordered.path&&validNodes(ordered.path)){const e=evaluatePath(g,shape,p,ordered.path,3000,8000);if(e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2)similarity=assess(toCandidate(g,shape,p,e),'ordered-contour')?.candidate.similarity??null;}orderedTrials.push({bins,reverse,expanded:ordered.expanded,pathFound:!!ordered.path,similarity});}}timings.orderedContour=Date.now()-stageBegan;diagnostics.orderedTrials=orderedTrials;
    progress('final-refit');stageBegan=Date.now();diagnostics.finalRefitEvaluations=refit(8,120);timings.finalRefit=Date.now()-stageBegan;
    const ranked=sorted(),best=ranked[0]??null;
 const cold={candidate:best?.candidate??null,raw:best?100*Math.exp(-best.quality):0,pool:ranked.slice(0,16).map(q=>q.candidate),baseline,baselineSimilarity:baseline?.similarity??0,timings:{...timings},diagnostics:{...diagnostics},elapsedMs:Date.now()-began};
 if(!best)return {candidate:null,raw:0,cold,stages:[],pool:[],elapsedMs:Date.now()-began};
 let current:Entry=best;
 const poseKey=(p:Placement)=>JSON.stringify([p.cx,p.cy,p.scale,p.rotDeg]);
 const knownPoses=new Set(ranked.map(q=>`${pairEdgeKey(q.nodes)}|${poseKey(q.candidate.placement)}`));
 const knownGeometries=new Set(ranked.map(q=>pairEdgeKey(q.nodes)));
 type Stage={name:string;before:number;after:number;rawBefore:number;canonicalInputRaw:number;rawAfter:number;elapsedMs:number;geometryChanges:number;placementOnlyChanges:number;existingGeometryReuse:number;samePoseEdgeReprints:number;validationEvaluations:number;diagnostics:Record<string,unknown>;};
 const stages:Stage[]=[],postPool=new Map<string,Entry>();
 let geometryChanges=0,placementOnlyChanges=0,existingGeometryReuse=0,samePoseEdgeReprints=0,validationEvaluations=0;
 const makeCanonical=(nodes:number[],p:Placement,method:string):Entry|null=>{
  if(!validNodes(nodes)||!validPose(p))return null;
  nodes=pairPhaseZero(g,shape,p,nodes);const e=evaluatePath(g,shape,p,nodes,3000,8000);validationEvaluations++;
  if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)return null;
  return {candidate:toCandidate(g,shape,p,e),nodes,quality:objective(e,p),method};
 };
 const consider=(item:Entry|null)=>{
  if(!item)return;
  const key=pairEdgeKey(item.nodes),signature=`${key}|${poseKey(item.candidate.placement)}`;
  // Reprinting a previously generated geometry at its same pose is not new quality.
  if(knownPoses.has(signature)){samePoseEdgeReprints++;return;}
  const existed=knownGeometries.has(key);knownPoses.add(signature);knownGeometries.add(key);
  if(!postPool.has(key)||postPool.get(key)!.quality>item.quality)postPool.set(key,item);
  const canonicalInput=makeCanonical(current.nodes,current.candidate.placement,'current-phase-zero');
  const threshold=Math.min(current.quality,canonicalInput?.quality??current.quality);
  if(item.quality>=threshold-1e-7)return;
  const changed=pairEdgeKey(current.nodes)!==key;
  if(changed){geometryChanges++;if(existed)existingGeometryReuse++;}else placementOnlyChanges++;
  current=item;
 };
 const runStage=(name:string,body:()=>Record<string,unknown>)=>{
  const before=current,counters={geometryChanges,placementOnlyChanges,existingGeometryReuse,samePoseEdgeReprints,validationEvaluations},started=Date.now();
  const canonicalBefore=makeCanonical(before.nodes,before.candidate.placement,'stage-input-phase-zero');
  progress(name);const data=body();
  stages.push({name,before:before.candidate.similarity,after:current.candidate.similarity,rawBefore:100*Math.exp(-before.quality),canonicalInputRaw:canonicalBefore?100*Math.exp(-canonicalBefore.quality):100*Math.exp(-before.quality),rawAfter:100*Math.exp(-current.quality),elapsedMs:Date.now()-started,geometryChanges:geometryChanges-counters.geometryChanges,placementOnlyChanges:placementOnlyChanges-counters.placementOnlyChanges,existingGeometryReuse:existingGeometryReuse-counters.existingGeometryReuse,samePoseEdgeReprints:samePoseEdgeReprints-counters.samePoseEdgeReprints,validationEvaluations:validationEvaluations-counters.validationEvaluations,diagnostics:data});
 };
 runStage('face-beam',()=>{
  const result=refineLoopFacesBeam(g,shape,region,ranked.slice(0,3).map(q=>q.candidate),{beamWidth:3,maxDepth:10,maxStates:1400,maxEvaluations:2500,boundaryLimit:60},3000,8000);
  for(const c of result.pool)consider(makeCanonical(nodesFor(c),c.placement,'face-beam'));
  return {evaluated:result.evaluated,states:result.states,completedDepth:result.completedDepth,seedStates:result.seedStates,outputCandidates:result.pool.length};
 });
 runStage('large-segment',()=>{
  const result=largeSegmentRepair(g,shape,current.candidate.placement,current.nodes,region,144,18000);
  if(result)consider(makeCanonical(result.evaluated.path,result.evaluated.fit??current.candidate.placement,'large-segment'));
  return {attempts:result?.attempts??0,evaluatedCandidates:result?.evaluatedCandidates??0,acceptedInternal:result?.acceptedRepairs??0,expanded:result?.expanded??0,internalSelection:'legacy raw-seam selection; returned path strictly canonicalized and rescored before adoption'};
 });
 runStage('pair-segment',()=>{
  const result=pairSegmentRepair(g,shape,current.candidate.placement,current.nodes,region,{maxRoutingAttempts:128,maxAlternatives:64,maxPairs:512,maxExpanded:18000});
  if(result)consider(makeCanonical(result.evaluated.path,result.evaluated.fit??current.candidate.placement,'pair-segment'));
  return {routingAttempts:result?.routingAttempts??0,alternatives:result?.alternativeCount??0,singleEvaluations:result?.singleEvaluations??0,pairEvaluations:result?.pairEvaluations??0,selectedPair:result?.selectedPair??null,kind:result?.kind??null};
 });
 runStage('phase-aware-uniform-refit',()=>{
  const input=current,initial=input.candidate.placement,nodes=input.nodes;
  let evaluations=1,guide=makeCanonical(nodes,initial,'phase-refit-initial');
  const check=(p:Placement)=>{
   if(evaluations>=128||p.scale<initial.scale*.8||p.scale>initial.scale*1.2||Math.abs(p.cx-initial.cx)>initial.scale*.2||Math.abs(p.cy-initial.cy)>initial.scale*.2||Math.abs(p.rotDeg-initial.rotDeg)>30||!validPose(p))return null;
   evaluations++;const item=makeCanonical(nodes,p,'phase-aware-uniform-refit');consider(item);return item;
  };
  for(const fraction of [.06,.03,.015,.0075,.00375])for(let round=0;round<3&&evaluations<128&&guide;round++){
   const origin=guide.candidate.placement;let improved=false;
   for(const [dx,dy,ds,dr] of [[1,0,0,0],[-1,0,0,0],[0,1,0,0],[0,-1,0,0],[0,0,1,0],[0,0,-1,0],[0,0,0,1],[0,0,0,-1]]){
    const p={cx:origin.cx+dx*fraction*initial.scale,cy:origin.cy+dy*fraction*initial.scale,scale:origin.scale*(1+ds*fraction),rotDeg:origin.rotDeg+dr*fraction*100},item=check(p);
    if(item&&item.quality<guide.quality-1e-7){guide=item;improved=true;}
   }
   if(!improved)break;
  }
  return {evaluations,maxEvaluations:128,poseBounds:{shift:.2,scale:[.8,1.2],rotation:30},geometryFixed:true,phaseZeroEveryPose:true};
 });
 progress('complete');
 return {candidate:current.candidate,raw:100*Math.exp(-current.quality),cold,stages,pool:[...postPool.values()].sort((a,b)=>a.quality-b.quality).slice(0,24).map(q=>q.candidate),geometryChanges,placementOnlyChanges,existingGeometryReuse,samePoseEdgeReprints,validationEvaluations,elapsedMs:Date.now()-began};
}
