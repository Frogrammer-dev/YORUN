import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect,it } from 'vitest';
import { StepBudget } from '@/lib/route/budget';
import { evaluatePath,placeShape,type RouteCandidate } from '@/lib/route/fit';
import { hasEdge,project } from '@/lib/route/graph';
import { buildBlocks,growLoops,traceUnion,matchShape,shapeSamples,type NaturalLoop } from '@/lib/route/loops';
import { graphFromOverpass,type BBox } from '@/lib/route/osm';
import { pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID,type ShapeId } from '@/lib/route/shapes';
import { growLoopsObserved } from './natural-loop-observer';
it.skipIf(!process.env.NATURAL_FLOOR_DIAGNOSIS)('observes unchanged natural-loop growth before its original distance emission filters',()=>{
 const root=path.resolve('eval/recognition/route-improvement'),out=path.join(root,'natural-floor-diagnosis-20261013'),source=path.resolve('eval/recognition/llm-routes-20261010'),latest=path.join(root,'offline-cascade-20261013');mkdirSync(out,{recursive:true});
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),normalize=(s:string)=>s.replace(/\r\n/g,'\n');
 const loopsText=normalize(readFileSync('src/lib/route/loops.ts','utf8')),observerText=normalize(readFileSync('tests/eval/natural-loop-observer.ts','utf8'));
 const a=loopsText.indexOf('export function growLoops('),b=loopsText.indexOf('\n/**',a),native=loopsText.slice(a,b),copied=observerText.slice(observerText.indexOf('export function growLoopsObserved(')).replace('growLoopsObserved(','growLoops(').replace(', observer:(seed:number,step:number,len:number,faces:number[])=>void, traceObserver:(success:boolean)=>void','').split('\n').filter(line=>!line.endsWith('// OBSERVER')).join('\n');
 expect(copied.trim()).toBe(native.trim());
 const areaText=readFileSync(path.join(source,'round2-results.json'),'utf8'),area=(JSON.parse(areaText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas.find(a=>a.id==='gwangalli')!,roadText=readFileSync(path.join(source,'gwangalli-roads.json'),'utf8'),g=graphFromOverpass(JSON.parse(roadText),area.bbox,{detail:'simple',excludeSteps:true});
 const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY},m=buildBlocks(g,(maxX-minX)*(maxY-minY)/4);
 const params={minMeters:3000,maxMeters:8000,seed:83721,seeds:Math.min(2000,m.faces.length),budgetUnits:2000,fraction:1,lengthBins:[0,500,1000,1500,2000,2500,3000,4000,5000,6000,8000],observationSamplePerBin:32,baselineQuickTop:400,fullRotation:false,additionalGlobalSeedsGenerated:false};
 const codeFiles=['tests/eval/natural-floor-diagnosis-20261013.test.ts','tests/eval/natural-loop-observer.ts','src/lib/route/loops.ts','src/lib/route/loopSearch.ts','src/lib/route/fit.ts','src/lib/route/shapes.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/budget.ts','src/lib/route/pairSegmentRepair.ts','src/lib/art/rdp.ts'],codeHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(readFileSync(f,'utf8'))]));
 const inputs=Object.fromEntries(['square','heart','cat'].map(id=>{const text=readFileSync(path.join(latest,`gwangalli-${id}.json`),'utf8');writeFileSync(path.join(out,`frozen-gwangalli-${id}.json`),text);return[id,{sha256:hash(text),row:JSON.parse(text) as {candidate:RouteCandidate;raw:number}}];}));
 writeFileSync(path.join(out,'protocol-before-run.json'),JSON.stringify({params,codeHashes,roadSha256:hash(roadText),areaSha256:hash(areaText),nativeGeneratorBodyHash:hash(native),literalBodyIdentical:true,inputs:Object.fromEntries(Object.entries(inputs).map(([id,v])=>[id,v.sha256])),holdoutRead:false,originalNativeDistanceThresholdsUnchanged:true,counterfactualStrictlyDiagnostic:true,proposedHigherBudget:false},null,2));
 const bins=params.lengthBins.map((lower,i)=>({lower,upper:params.lengthBins[i+1]??null,count:0,samples:[] as Array<{rank:number;seed:number;step:number;len:number;faces:number[]}>}));
 let observedStates=0,traceAttempts=0,traceFailures=0;
 const rank=(seed:number,step:number)=>{let x=(seed*73856093)^((step+2)*19349663);x^=x>>>16;x=Math.imul(x,0x7feb352d);x^=x>>>15;return x>>>0;};
 const observed=growLoopsObserved(g,m,region,3000,8000,{seeds:params.seeds,budget:new StepBudget(2000),fraction:1,seed:83721},(seed,step,len,faces)=>{
  observedStates++;const bin=bins.find(b=>len>=b.lower&&(b.upper===null||len<b.upper))!;bin.count++;const r=rank(seed,step);
  if(bin.samples.length<32||r<bin.samples.at(-1)!.rank){bin.samples.push({rank:r,seed,step,len,faces:[...faces]});bin.samples.sort((a,b)=>a.rank-b.rank);if(bin.samples.length>32)bin.samples.pop();}
 },success=>{traceAttempts++;if(!success)traceFailures++;});
 const original=growLoops(g,m,region,3000,8000,{seeds:params.seeds,budget:new StepBudget(2000),fraction:1,seed:83721});
 expect(observed).toEqual(original);
 const sampleLoops:Array<{bin:number;sample:{rank:number;seed:number;step:number;len:number;faces:number[]};loop:NaturalLoop|null}>=[];
 for(let bin=0;bin<bins.length;bin++)for(const sample of bins[bin].samples){const flags=new Uint8Array(m.faces.length+1);for(const f of sample.faces)flags[f]=1;const nodes=traceUnion(g,m,flags,sample.faces);sampleLoops.push({bin,sample,loop:nodes?{faces:sample.faces,path:nodes,length:nodes.slice(1).reduce((s,v,i)=>s+Math.hypot(g.x[v]-g.x[nodes[i]],g.y[v]-g.y[nodes[i]]),0)}:null});}
 const results=[];
 for(const shapeId of ['square','heart','cat'] as ShapeId[]){
  const shape=SHAPE_BY_ID[shapeId],tmpl=shapeSamples(shape),shapeResults=[];let quickFitFail=0,fullFitFail=0,poseOutside=0;
  const inside=(v:number)=>g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY;
  const assess=(loop:NaturalLoop|null,origin:string,bin:number|null,seed:number|null,step:number|null)=>{
   if(!loop)return{origin,bin,seed,step,traceFailed:true};
   const nodes=loop.path,xy=nodes.map(v=>[g.x[v],g.y[v]] as [number,number]),quick=matchShape(xy,shape,tmpl,false),fit=matchShape(xy,shape,tmpl,true);
   if(!quick)quickFitFail++;if(!fit){fullFitFail++;return{origin,bin,seed,step,lengthMeters:loop.length,fitFailed:true};}
   const outlineInside=placeShape(shape.points,fit).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY);if(!outlineInside)poseOutside++;
   const actual=nodes.every((v,i)=>inside(v)&&(!i||hasEdge(g,nodes[i-1],v))),closed=nodes[0]===nodes.at(-1),simple=new Set(nodes.slice(0,-1)).size===nodes.length-1;
   const canonical=pairPhaseZero(g,shape,fit,nodes),e=evaluatePath(g,shape,fit,canonical,3000,8000),normDev=e.meanDev/(.08*fit.scale),zigLog=Math.log1p(.03*e.zigzagPerKm),q=normDev+zigLog-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
   let signedArea=0;for(let i=1;i<nodes.length;i++)signedArea+=g.x[nodes[i-1]]*g.y[nodes[i]]-g.x[nodes[i]]*g.y[nodes[i-1]];
   return{origin,bin,seed,step,lengthMeters:e.lengthMeters,fit,quickResid:quick?.resid??null,resid:fit.resid,outlineInside,actual,closed,simple,repeatRatio:e.repeatRatio,strict:actual&&closed&&outlineInside&&e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2,similarity:e.similarity,raw:100*Math.exp(-q),normDev,zigLog,featureCoverage:e.featureCoverage,spikes:e.spikes,templateMeters:shape.perimeter*fit.scale,detourRatio:e.lengthMeters/(shape.perimeter*fit.scale),compactness:4*Math.PI*Math.abs(signedArea/2)/(e.lengthMeters*e.lengthMeters),aspect:(Math.max(...xy.map(p=>p[0]))-Math.min(...xy.map(p=>p[0])))/(Math.max(...xy.map(p=>p[1]))-Math.min(...xy.map(p=>p[1])))};
  };
  for(const row of sampleLoops)shapeResults.push(assess(row.loop,'growth-observation',row.bin,row.sample.seed,row.sample.step));
  const quick=original.map((loop,index)=>({loop,index,fit:matchShape(loop.path.map(v=>[g.x[v],g.y[v]] as [number,number]),shape,tmpl,false)})).filter(q=>q.fit).sort((a,b)=>a.fit!.resid-b.fit!.resid),defaultRows=quick.slice(0,400).map(row=>assess(row.loop,'default-natural-quick-top400',null,null,row.index));
  const latestCandidate=inputs[shapeId].row.candidate,index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
  const latestNodes=latestCandidate.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1),latestEval=evaluatePath(g,shape,latestCandidate.placement,latestNodes,3000,8000);
  expect(latestEval.similarity).toBe(latestCandidate.similarity);
  results.push({shapeId,inputSha256:inputs[shapeId].sha256,latest:{similarity:latestEval.similarity,lengthMeters:latestEval.lengthMeters,placement:latestCandidate.placement,templateMeters:shape.perimeter*latestCandidate.placement.scale,detourRatio:latestEval.lengthMeters/(shape.perimeter*latestCandidate.placement.scale),normDev:latestEval.meanDev/(.08*latestCandidate.placement.scale),zigLog:Math.log1p(.03*latestEval.zigzagPerKm),raw:inputs[shapeId].row.raw},quickFitFail,fullFitFail,poseOutside,defaultNaturalQuickCount:quick.length,defaultRows,observations:shapeResults});
  writeFileSync(path.join(out,`${shapeId}-progress.json`),JSON.stringify({shapeId,complete:true,originalNaturalCount:original.length,samples:sampleLoops.length}));
 }
 writeFileSync(path.join(out,'results.json'),JSON.stringify({protocol:{params,codeHashes,nativeGeneratorBodyHash:hash(native),literalBodyIdentical:true,generatorReplayIdentical:true,inputBaseline:'latest original-region from-roads offline cascade complete results; not saved manually tuned best',additionalGlobalSeedsGenerated:false,diagnosticOnly:true,holdoutRead:false},growth:{blocks:m.faces.length,observedStates,bins:bins.map(({samples,...b})=>({...b,sampleCount:samples.length})),naturalCount:original.length,traceAttempts,traceFailures,sampledTraceFailures:sampleLoops.filter(r=>!r.loop).length},cases:results},null,2));
},300000);
