import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {StepBudget} from '@/lib/route/budget';
import {evaluatePath,findRoutes,placeShape,toCandidate,type Placement,type RouteCandidate} from '@/lib/route/fit';
import {hasEdge,project} from '@/lib/route/graph';
import {globalSearch} from '@/lib/route/globalSearch';
import {searchBlockLoops} from '@/lib/route/loopSearch';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {orderedContourPath} from '@/lib/route/orderedContourPath';
import {refinePathPlacement} from '@/lib/route/refinePlacement';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';

it.skipIf(!process.env.CONTROLLED_AREA)('compares an identical automatic pipeline across frozen narrow and wider road areas',()=>{
 const root=path.resolve('eval/recognition/route-improvement'),wideDir=path.join(root,'wide-roads'),narrowDir=path.resolve('eval/recognition/llm-routes-20261010'),out=path.join(root,'controlled-area');mkdirSync(out,{recursive:true});
 const protocolText=readFileSync(path.join(wideDir,'protocol.json'),'utf8'),wideProtocol=JSON.parse(protocolText) as {areas:Array<{id:string;originalBBox:BBox;bbox:BBox;sha256:string}>;shapes:ShapeId[]};
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const codeFiles=['tests/eval/controlled-area-search.test.ts','src/lib/route/globalSearch.ts','src/lib/route/loopSearch.ts','src/lib/route/loops.ts','src/lib/route/orderedContourPath.ts','src/lib/route/refinePlacement.ts','src/lib/route/fit.ts','src/lib/route/flex.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/shapes.ts','src/lib/route/budget.ts','src/lib/art/rdp.ts'];
 const codeHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(readFileSync(f,'utf8'))]));
 const params={detail:'simple',excludeSteps:true,minMeters:3000,maxMeters:8000,repeatMax:.2,baselineSteps:80,baselineResults:8,globalAttempts:240,fullRotation:true,rankBySimilarity:true,loopGlobalSeeds:3,loopBaselineSeeds:1,naturalLoopSeeds:2000,quickLoops:400,initialRefitTop:8,initialRefitBudget:160,orderedPoseMax:4,orderedBins:[32,64],orderedRadius:.16,orderedNormalized:true,orderedMaxExpanded:400000,finalRefitTop:8,finalRefitBudget:120,poolMax:16};
 const results:Array<{label:string;caseId:string;baselineSimilarity:number;similarity:number;candidate:RouteCandidate|null;elapsedMs:number}>=[];const filter=process.env.CONTROLLED_CASES?.split(',');
 for(const label of ['narrow','wide'] as const)for(const area of wideProtocol.areas){
  const bbox=label==='narrow'?area.originalBBox:area.bbox,source=readFileSync(path.join(label==='narrow'?narrowDir:wideDir,`${area.id}-roads.json`),'utf8'),sourceHash=hash(source);if(label==='wide')expect(sourceHash).toBe(area.sha256);
  const g=graphFromOverpass(JSON.parse(source),bbox,{detail:'simple',excludeSteps:true}),[minX,minY]=project(g.origin,bbox.south,bbox.west),[maxX,maxY]=project(g.origin,bbox.north,bbox.east),region={minX,minY,maxX,maxY};
  for(const shapeId of wideProtocol.shapes){const caseId=`${area.id}-${shapeId}`,key=`${label}-${caseId}`;if(filter&&!filter.includes(key)&&!filter.includes(caseId))continue;
   const shape=SHAPE_BY_ID[shapeId],cacheKey=hash(JSON.stringify({sourceHash,protocolHash:hash(protocolText),codeHashes,params,shapeId,bbox})),file=path.join(out,`${key}.json`),progressFile=path.join(out,`${key}-progress.json`);
   let result;
   if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,'utf8'));
   else{
    const began=Date.now(),timings:Record<string,number>={},diagnostics:Record<string,unknown>={};
    const progress=(stage:string)=>writeFileSync(progressFile,JSON.stringify({label,caseId,cacheKey,stage,timings,diagnostics,elapsedMs:Date.now()-began},null,2));progress('baseline');
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
    const distances=(c:RouteCandidate|null)=>{if(!c)return null;const nodes=nodesFor(c);let cx=0,cy=0,length=0;for(let i=1;i<nodes.length;i++){const a=nodes[i-1],b=nodes[i],d=Math.hypot(g.x[b]-g.x[a],g.y[b]-g.y[a]);length+=d;cx+=(g.x[a]+g.x[b])/2*d;cy+=(g.y[a]+g.y[b])/2*d;}return{nearestRouteDistanceMeters:Math.min(...nodes.map(v=>Math.hypot(g.x[v],g.y[v]))),routeCenterDistanceMeters:Math.hypot(cx/length,cy/length),startDistanceMeters:Math.hypot(g.x[nodes[0]],g.y[nodes[0]])};};
    result={label,caseId,cacheKey,datasetSha256:sourceHash,dataTimestamp:g.dataTimestamp,bbox,origin:g.origin,graphNodes:g.n,graphEdges:g.edgeCount,baseline,baselineSimilarity:baseline?.similarity??0,candidate:best?.candidate??null,similarity:best?.candidate.similarity??0,rawObjective:best?.quality??null,method:best?.method??null,pool:ranked.slice(0,16).map(q=>q.candidate),baselineDistances:distances(baseline),candidateDistances:distances(best?.candidate??null),timings,diagnostics,elapsedMs:Date.now()-began};writeFileSync(file,JSON.stringify(result,null,2));progress('complete');
   }
   for(const c of [result.baseline,result.candidate,...result.pool].filter(Boolean) as RouteCandidate[]){const nodes=c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});expect(nodes[0]).toBe(nodes.at(-1));expect(nodes.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,nodes[i-1],v)))).toBe(true);expect(placeShape(shape.points,c.placement).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY)).toBe(true);const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);expect(e.similarity).toBe(c.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);}
   expect(result.similarity).toBeGreaterThanOrEqual(result.baselineSimilarity);results.push(result);
  }
 }
 const summary=Object.fromEntries(['narrow','wide'].map(label=>{const cases=results.filter(c=>c.label===label);return[label,{caseCount:cases.length,denominator:filter?cases.length:12,baselineAverage:cases.reduce((s,c)=>s+c.baselineSimilarity,0)/(filter?cases.length:12),pipelineAverage:cases.reduce((s,c)=>s+c.similarity,0)/(filter?cases.length:12),failures:cases.filter(c=>!c.candidate).length,totalElapsedMs:cases.reduce((s,c)=>s+c.elapsedMs,0)}];}));
 if(!filter)expect(results).toHaveLength(24);
 writeFileSync(path.join(out,filter?'filtered-results.json':'results.json'),JSON.stringify({protocol:{purpose:'User-approved supplemental wider-area controlled automatic comparison; original benchmark remains separate',wideProtocolHash:hash(protocolText),codeHashes,params,failuresCountAsZero:true,manualSeeds:false,savedBestRoutesUsed:false,distanceMeaning:'Straight-line estimates relative to graph origin; nearest is minimum actual route-node distance, route center is length-weighted edge-midpoint centroid, start is first route node; none are walking access distances'},summary,cases:results},null,2));
},7200000);
