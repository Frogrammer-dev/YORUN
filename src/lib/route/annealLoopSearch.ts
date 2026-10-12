import { evaluatePath, placeShape, toCandidate, type Evaluated, type Placement, type Region, type RouteCandidate } from "./fit";
import { hasEdge, type RoadGraph } from "./graph";
import { buildBlocks, traceUnion } from "./loops";
import { refinePathPlacement } from "./refinePlacement";
import type { ShapeDef } from "./shapes";

export interface AnnealLoopOptions {seed?:number;proposalBudget?:number;maxSeeds?:number;temperatureStart?:number;temperatureEnd?:number;refitTopCount?:number;refitEvaluationsPerPath?:number;}

/** Fixed-pose, deterministic annealing of connected road-face boundaries. */
export function annealLoopSearch(g:RoadGraph,shape:ShapeDef,region:Region,inputs:RouteCandidate[],options:AnnealLoopOptions={},minMeters=3000,maxMeters=8000){
  const {seed=0xA11E2026,proposalBudget=2000,maxSeeds=3,temperatureStart=.03,temperatureEnd=.003,refitTopCount=8,refitEvaluationsPerPath=120}=options;
  let randomState=seed>>>0||1;
  const random=()=>{randomState^=randomState<<13;randomState^=randomState>>>17;randomState^=randomState<<5;return(randomState>>>0)/4294967296;};
  const m=buildBlocks(g,(region.maxX-region.minX)*(region.maxY-region.minY)/4);
  const inside=(x:number,y:number)=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY;
  const eligible=m.faces.map(f=>inside(f.minX,f.minY)&&inside(f.maxX,f.maxY));
  const neighbors=m.faces.map(f=>[...new Set(f.hes.map(h=>m.heFace[h^1]).filter(n=>n>=0&&eligible[n]))]);
  const validPath=(nodes:number[])=>nodes.length>=4&&nodes[0]===nodes.at(-1)&&nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(i===0||hasEdge(g,nodes[i-1],v)));
  const validPose=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>inside(x,y));
  const keyOf=(nodes:number[])=>nodes.slice(1).map((v,i)=>nodes[i]<v?`${nodes[i]}-${v}`:`${v}-${nodes[i]}`).sort().join(',');
  // Geometry-based phase zero, never chosen by searching for a higher evaluation score.
  const phaseZero=(nodes:number[],p:Placement)=>{
    let loop=nodes.slice(0,-1);const template=placeShape(shape.points,p);
    let routeArea=0,templateArea=0;
    for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];routeArea+=g.x[a]*g.y[b]-g.x[b]*g.y[a];}
    for(let i=1;i<template.length;i++)templateArea+=template[i-1][0]*template[i][1]-template[i][0]*template[i-1][1];
    if(routeArea*templateArea<0)loop=loop.reverse();
    const [x,y]=template[0];let first=0,bestDistance=Infinity;
    for(let i=0;i<loop.length;i++){const distance=(g.x[loop[i]]-x)**2+(g.y[loop[i]]-y)**2;if(distance<bestDistance-1e-9||Math.abs(distance-bestDistance)<=1e-9&&loop[i]<loop[first]){first=i;bestDistance=distance;}}
    const rotated=[...loop.slice(first),...loop.slice(0,first)];return [...rotated,rotated[0]];
  };
  const objective=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
  const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
  type Scored={candidate:RouteCandidate;score:number;nodes:number[];evaluated:Evaluated};
  const pool=new Map<string,Scored>(),inputKeys=new Set<string>();let inputEvaluations=0,proposalEvaluations=0,reconstructionEvaluations=0,refitEvaluations=0,proposals=0,accepted=0,acceptedWorse=0,invalidProposals=0,cachedProposals=0,reconstructionMismatches=0,sameEdgeDiagnosticCount=0;
  const record=(item:Scored,isIncumbent=false)=>{const key=keyOf(item.nodes);if(inputKeys.has(key)&&!isIncumbent){sameEdgeDiagnosticCount++;return;}if(!pool.has(key)||pool.get(key)!.score>item.score)pool.set(key,item);if(pool.size>24){const worst=[...pool.entries()].sort((a,b)=>a[1].score-b[1].score).at(-1)!;pool.delete(worst[0]);}};
  const assess=(nodes:number[],p:Placement,normalize=true):Scored|null=>{if(!validPath(nodes)||!validPose(p))return null;if(normalize)nodes=phaseZero(nodes,p);const e=evaluatePath(g,shape,p,nodes,minMeters,maxMeters);if(e.lengthMeters<minMeters||e.lengthMeters>maxMeters||e.repeatRatio>.2)return null;return {candidate:toCandidate(g,shape,p,e),score:objective(e,p),nodes,evaluated:e};};
  const parents:Scored[]=[];
  const inputPhaseScores:Array<{original:number;phaseZero:number;originalRaw:number;phaseZeroRaw:number}>=[];
  let canonicalInputBestScore=Infinity;
  for(const input of inputs){const nodes=input.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);inputEvaluations++;const item=assess(nodes,input.placement,false);if(item){parents.push(item);inputKeys.add(keyOf(nodes));const normalized=assess(nodes,input.placement);inputEvaluations++;if(normalized){canonicalInputBestScore=Math.min(canonicalInputBestScore,normalized.score);inputPhaseScores.push({original:item.candidate.similarity,phaseZero:normalized.candidate.similarity,originalRaw:100*Math.exp(-item.score),phaseZeroRaw:100*Math.exp(-normalized.score)});}}}
  parents.sort((a,b)=>a.score-b.score);
  if(parents[0])record(parents[0],true);
  type State={faces:Set<number>;current:Scored;pose:Placement;cache:Map<string,Scored|null>};
  const starts:State[]=[],usedStarts=new Set<string>(),reconstruction:Array<{inputScore:number;reconstructedScore:number|null;inputRaw:number;reconstructedRaw:number|null;exact:boolean;valid:boolean;inputEdges:number;reconstructedEdges:number}>=[];
  for(const parent of parents){
    if(starts.length>=maxSeeds)break;const inputKey=keyOf(parent.nodes);if(usedStarts.has(inputKey))continue;usedStarts.add(inputKey);
    const contains=(x:number,y:number)=>{let yes=false;for(let i=0,j=parent.nodes.length-1;i<parent.nodes.length;j=i++){const a=parent.nodes[i],b=parent.nodes[j];if((g.y[a]>y)!==(g.y[b]>y)&&x<(g.x[b]-g.x[a])*(y-g.y[a])/(g.y[b]-g.y[a])+g.x[a])yes=!yes;}return yes;};
    const faces=new Set(m.faces.map((f,i)=>eligible[i]&&f.samples.some(([x,y])=>contains(x,y))?i:-1).filter(i=>i>=0));
    const flags=new Uint8Array(m.faces.length+1);for(const f of faces)flags[f]=1;
    const nodes=traceUnion(g,m,flags,[...faces]);const exact=!!nodes&&keyOf(nodes)===inputKey;
    if(!exact)reconstructionMismatches++;
    const item=nodes?assess(nodes,parent.candidate.placement):null;if(nodes)reconstructionEvaluations++;
    reconstruction.push({inputScore:parent.candidate.similarity,reconstructedScore:item?.candidate.similarity??null,inputRaw:100*Math.exp(-parent.score),reconstructedRaw:item?100*Math.exp(-item.score):null,exact,valid:!!item,inputEdges:parent.nodes.length-1,reconstructedEdges:(nodes?.length??1)-1});
    // A mismatched reconstruction is not silently substituted for the input road geometry.
    if(!item||!exact)continue;
    const faceKey=[...faces].sort((a,b)=>a-b).join(',');starts.push({faces,current:item,pose:parent.candidate.placement,cache:new Map([[faceKey,item]])});
  }
  const seedScores=starts.map(s=>s.current.candidate.similarity);
  for(let step=0;step<proposalBudget&&starts.length;step++){
    proposals++;const state=starts[step%starts.length],boundary=new Set<number>();
    for(const f of state.faces)for(const next of neighbors[f])if(!state.faces.has(next)){boundary.add(f);boundary.add(next);}
    const ids=[...boundary];if(!ids.length){invalidProposals++;continue;}
    const first=ids[Math.floor(random()*ids.length)],kind=Math.floor(random()*3),nextFaces=new Set(state.faces);
    const flip=(f:number)=>{if(nextFaces.has(f))nextFaces.delete(f);else nextFaces.add(f);};flip(first);
    if(kind){const other=neighbors[first].filter(f=>kind===1?state.faces.has(f)===state.faces.has(first):state.faces.has(f)!==state.faces.has(first));if(!other.length){invalidProposals++;continue;}flip(other[Math.floor(random()*other.length)]);}
    const key=[...nextFaces].sort((a,b)=>a-b).join(',');let proposal:Scored|null;
    if(state.cache.has(key)){proposal=state.cache.get(key)!;cachedProposals++;}
    else{
      const flags=new Uint8Array(m.faces.length+1);for(const f of nextFaces)flags[f]=1;
      const nodes=traceUnion(g,m,flags,[...nextFaces]);
      proposal=nodes?assess(nodes,state.pose):null;if(nodes)proposalEvaluations++;
      state.cache.set(key,proposal);
    }
    if(!proposal){invalidProposals++;continue;}record(proposal);
    const temperature=temperatureStart*Math.pow(temperatureEnd/temperatureStart,step/Math.max(1,proposalBudget-1)),delta=proposal.score-state.current.score;
    if(delta<=0||random()<Math.exp(-delta/temperature)){if(delta>1e-9)acceptedWorse++;accepted++;state.faces=nextFaces;state.current=proposal;}
  }
  const finalists=[...pool.values()].sort((a,b)=>a.score-b.score).slice(0,refitTopCount);
  for(const parent of finalists){if(inputKeys.has(keyOf(parent.nodes)))continue;const r=refinePathPlacement(g,shape,parent.candidate.placement,parent.nodes,region,minMeters,maxMeters,refitEvaluationsPerPath);if(!r)continue;refitEvaluations+=r.evaluations;const normalized=assess(parent.nodes,r.placement);if(normalized)record(normalized);}
  const final=[...pool.values()].sort((a,b)=>a.score-b.score);
  const canonicalImprovement=final.find(item=>!inputKeys.has(keyOf(item.nodes))&&item.score<canonicalInputBestScore);
  const incumbent=parents[0];const chosen=canonicalImprovement&&(!incumbent||canonicalImprovement.score<incumbent.score)?canonicalImprovement:incumbent;
  return {candidate:chosen?.candidate??null,pool:final.map(p=>p.candidate),proposals,inputEvaluations,proposalEvaluations,reconstructionEvaluations,refitEvaluations,accepted,acceptedWorse,invalidProposals,cachedProposals,reconstructionMismatches,reconstruction,seeds:starts.length,seedScores,seedFinalScores:starts.map(s=>s.current.candidate.similarity),blocks:m.faces.length,inputPhaseScores,canonicalInputBestRaw:100*Math.exp(-canonicalInputBestScore),sameEdgeDiagnosticCount,geometryImprovement:!!canonicalImprovement&&chosen===canonicalImprovement};
}
