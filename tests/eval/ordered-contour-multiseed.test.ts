import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {evaluatePath,placeShape,toCandidate,type Placement,type RouteCandidate} from '@/lib/route/fit';
import {hasEdge,project} from '@/lib/route/graph';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {orderedContourPath} from '@/lib/route/orderedContourPath';
import {refinePathPlacement} from '@/lib/route/refinePlacement';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';

it.skipIf(!process.env.ORDERED_MULTISEED)('couples diverse automatic placements with ordered contour road paths',()=>{
 const withCoarse=!!process.env.ORDERED_COARSE;
 const root=path.resolve('eval/recognition/route-improvement'),sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),input=path.join(root,'combined-incumbent-v6/results.json'),out=path.join(root,withCoarse?'ordered-multiseed-coarse':'ordered-multiseed');mkdirSync(out,{recursive:true});
 const rows=JSON.parse(readFileSync(input,'utf8')) as Array<{caseId:string;candidate:RouteCandidate}>,baselineFile=path.join(root,'frozen-baseline.json'),baselineText=readFileSync(baselineFile,'utf8'),baseline=JSON.parse(baselineText) as {cases:Array<{caseId:string;baseline:RouteCandidate}>};
 const areas=(JSON.parse(readFileSync(path.join(sourceDir,'round2-results.json'),'utf8')) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
 const profiles=[{bins:32,guideWeight:3,radiusFraction:.10},{bins:32,guideWeight:6,radiusFraction:.16},{bins:64,guideWeight:3,radiusFraction:.16},{bins:64,guideWeight:6,radiusFraction:.10}];
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),codeHashes=Object.fromEntries(['tests/eval/ordered-contour-multiseed.test.ts','src/lib/route/orderedContourPath.ts','src/lib/route/refinePlacement.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/shapes.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]));
 const results=[];const filter=process.env.ORDERED_CASES?.split(',');
 for(const row of rows){if(filter&&!filter.includes(row.caseId))continue;
  const area=areas.find(a=>row.caseId.startsWith(`${a.id}-`))!,source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),g=graphFromOverpass(JSON.parse(source),area.bbox,{detail:'simple',excludeSteps:true});
  const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
  const initial=row.candidate,shape=SHAPE_BY_ID[initial.shapeId as ShapeId],nodes=initial.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
  const valid=(p:number[])=>p.length>=4&&p[0]===p.at(-1)&&p.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,p[i-1],v)));
  const validPose=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY);
  expect(valid(nodes)).toBe(true);const before=evaluatePath(g,shape,initial.placement,nodes,3000,8000),objective=(e:typeof before,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
  const sources:Array<{label:string;candidate:RouteCandidate}>=[{label:'incumbent',candidate:initial},{label:'baseline',candidate:baseline.cases.find(c=>c.caseId===row.caseId)!.baseline}],sourceHashes:Record<string,string>={roads:hash(source),baseline:hash(baselineText),incumbent:hash(JSON.stringify(initial))};
  for(const folder of ['global-similarity','global-dense-similarity','global-rotation360','loops-beam-refit']){const file=path.join(root,folder,`${row.caseId}.json`);if(!existsSync(file))continue;const text=readFileSync(file,'utf8'),data=JSON.parse(text);sourceHashes[folder]=hash(text);for(const c of [data.candidate,...(data.pool??[]).slice(0,folder==='loops-beam-refit'?24:8)])if(c?.placement)sources.push({label:folder,candidate:c});}
  const priorFile=path.join(root,'ordered-multiseed',`${row.caseId}.json`),prior=withCoarse&&existsSync(priorFile)?JSON.parse(readFileSync(priorFile,'utf8')):null;
  if(prior){sourceHashes.prior=hash(readFileSync(priorFile,'utf8'));sources.push({label:'prior-multiseed',candidate:prior.candidate});}
  const poseDistance=(a:Placement,b:Placement)=>{const scale=(a.scale+b.scale)/2,angle=Math.abs(((a.rotDeg-b.rotDeg+540)%360)-180)/90;return Math.hypot((a.cx-b.cx)/scale,(a.cy-b.cy)/scale,Math.log(a.scale/b.scale),angle*.4);};
  const unique:typeof sources=[];for(const seed of sources){if(!validPose(seed.candidate.placement)||unique.some(q=>poseDistance(q.candidate.placement,seed.candidate.placement)<.025))continue;unique.push(seed);}
  const selected=[unique[0]];while(selected.length<(withCoarse?5:8)&&selected.length<unique.length){let next:typeof unique[number]|null=null,best=-Infinity;for(const seed of unique){if(selected.includes(seed))continue;const diversity=Math.min(...selected.map(q=>poseDistance(q.candidate.placement,seed.candidate.placement))),value=diversity+.02*seed.candidate.similarity/100;if(value>best){next=seed;best=value;}}if(!next)break;selected.push(next);}
  if(withCoarse){const file=path.join(root,'global-coarse',`${row.caseId}.json`),text=readFileSync(file,'utf8'),data=JSON.parse(text) as {placementSeeds:Placement[]};sourceHashes.coarse=hash(text);
   const coarse=data.placementSeeds.slice(0,16).filter(p=>validPose(p)&&!selected.some(q=>poseDistance(q.candidate.placement,p)<.025));
   for(let k=0;k<3&&coarse.length;k++){let index=0;if(k)index=coarse.map((p,i)=>({i,value:Math.min(...selected.map(q=>poseDistance(q.candidate.placement,p)))+.1/(i+1)})).sort((a,b)=>b.value-a.value)[0].i;
    const p=coarse.splice(index,1)[0];selected.push({label:'global-coarse',candidate:{...initial,placement:p,similarity:0}});
   }
  }
  const cacheKey=hash(JSON.stringify({sourceHashes,codeHashes,profiles,selected:selected.map(q=>q.candidate.placement),maxExpanded:400000})),file=path.join(out,`${row.caseId}.json`);let result;
  if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,'utf8'));
  else{const began=Date.now(),trials=[];let candidate=initial,best=objective(before,initial.placement);const retained=new Map<string,{candidate:RouteCandidate;nodes:number[];score:number}>();retained.set(nodes.join(','),{candidate:initial,nodes,score:best});
   if(prior){for(const c of prior.pool as RouteCandidate[]){const p=c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});if(!valid(p)||!validPose(c.placement))continue;const e=evaluatePath(g,shape,c.placement,p,3000,8000);if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)continue;retained.set(p.join(','),{candidate:toCandidate(g,shape,c.placement,e),nodes:p,score:objective(e,c.placement)});}}
   for(let seedId=0;seedId<selected.length;seedId++){const seed=selected[seedId],p=seed.candidate.placement,first=placeShape(shape.points,p)[0],start=g.nodeIndex.nearest(first[0],first[1],p.scale*.16);
    for(const profile of profiles)for(const reverse of [false,true]){const found=orderedContourPath(g,shape,p,region,start,{...profile,reverse,maxExpanded:400000});let similarity:number|null=null;
     if(found.path&&valid(found.path)){const e=evaluatePath(g,shape,p,found.path,3000,8000);if(e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2){const c=toCandidate(g,shape,p,e),score=objective(e,p),key=found.path.join(',');similarity=e.similarity;if(!retained.has(key)||retained.get(key)!.score>score)retained.set(key,{candidate:c,nodes:found.path,score});}}
     trials.push({seedId,source:seed.label,...profile,reverse,expanded:found.expanded,pathFound:!!found.path,similarity});
    }
   }
   let refitEvaluations=0;for(const parent of [...retained.values()].sort((a,b)=>a.score-b.score).slice(0,8)){const refit=refinePathPlacement(g,shape,parent.candidate.placement,parent.nodes,region,3000,8000,120);if(!refit)continue;refitEvaluations+=refit.evaluations;const score=objective(refit.evaluated,refit.placement);if(score<parent.score){parent.score=score;parent.candidate=toCandidate(g,shape,refit.placement,refit.evaluated);}}
   const pool=[...retained.values()].sort((a,b)=>a.score-b.score);if(pool[0].score<best){best=pool[0].score;candidate=pool[0].candidate;}
   result={caseId:row.caseId,cacheKey,sourceHashes,before:before.similarity,after:candidate.similarity,elapsedMs:Date.now()-began,selectedPoses:selected.map(q=>({source:q.label,placement:q.candidate.placement,sourceSimilarity:q.candidate.similarity})),trials,refitEvaluations,candidate,pool:pool.slice(0,16).map(q=>q.candidate)};writeFileSync(file,JSON.stringify(result,null,2));
  }
  for(const c of [result.candidate,...result.pool] as RouteCandidate[]){const finalNodes=c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});expect(valid(finalNodes)).toBe(true);const e=evaluatePath(g,shape,c.placement,finalNodes,3000,8000);expect(e.similarity).toBe(c.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);expect(validPose(c.placement)).toBe(true);}
  expect(result.after).toBeGreaterThanOrEqual(before.similarity);results.push(result);
 }
 const summary={caseCount:results.length,beforeAverage:results.reduce((s,r)=>s+r.before,0)/results.length,afterAverage:results.reduce((s,r)=>s+r.after,0)/results.length};
 writeFileSync(path.join(out,filter?'filtered-results.json':'results.json'),JSON.stringify({protocol:{input,codeHashes,profiles,maxPoses:8,coarsePoses:withCoarse?3:0,maxExpanded:400000,minMeters:3000,maxMeters:8000,repeatMax:.2,refitTop:8,refitBudget:120,poolMax:16,poseSelection:'near-duplicate exclusion and farthest-point position/rotation/scale diversity with incumbent protected'},summary,cases:results},null,2));
},1800000);
