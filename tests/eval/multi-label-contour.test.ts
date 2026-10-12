import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {evaluatePath,placeShape,toCandidate,type Placement,type RouteCandidate} from '@/lib/route/fit';
import {hasEdge,project} from '@/lib/route/graph';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {multiLabelContourPath} from '@/lib/route/multiLabelContourPath';
import {refinePathPlacement} from '@/lib/route/refinePlacement';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';

it.skipIf(!process.env.MULTI_LABEL_CONTOUR)('preserves length-bucket contour alternatives with immutable labels and unchanged final evaluation',()=>{
 const root=path.resolve('eval/recognition/route-improvement'),sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),input=path.join(root,'combined-exact-v9/results.json'),out=path.join(root,'multi-label-contour');mkdirSync(out,{recursive:true});
 const inputText=readFileSync(input,'utf8'),rows=JSON.parse(inputText) as Array<{caseId:string;candidate:RouteCandidate}>;
 const areas=(JSON.parse(readFileSync(path.join(sourceDir,'round2-results.json'),'utf8')) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
 const profiles=[{bins:32,radiusFraction:.16},{bins:64,radiusFraction:.16}];
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),codeHashes=Object.fromEntries(['tests/eval/multi-label-contour.test.ts','src/lib/route/multiLabelContourPath.ts','src/lib/route/refinePlacement.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/shapes.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]));
 const results=[];const filter=process.env.ORDERED_CASES?.split(',');
 for(const row of rows){if(filter&&!filter.includes(row.caseId))continue;
  const area=areas.find(a=>row.caseId.startsWith(`${a.id}-`))!,source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),g=graphFromOverpass(JSON.parse(source),area.bbox,{detail:'simple',excludeSteps:true});
  const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
  const initial=row.candidate,shape=SHAPE_BY_ID[initial.shapeId as ShapeId],nodes=initial.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
  const valid=(p:number[])=>p.length>=4&&p[0]===p.at(-1)&&p.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,p[i-1],v)));
  const validPose=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY);
  expect(valid(nodes)).toBe(true);const before=evaluatePath(g,shape,initial.placement,nodes,3000,8000),objective=(e:typeof before,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
  const extraFile=path.join(root,'ordered-multiseed',`${row.caseId}.json`),extraText=readFileSync(extraFile,'utf8');
  const selected=[initial];
  const cacheKey=hash(JSON.stringify({sources:{roads:hash(source),input:hash(inputText),extra:hash(extraText)},codeHashes,profiles,maxExpanded:200000,maxLabels:300000,maxGoals:24,bucketMeters:500})),file=path.join(out,`${row.caseId}.json`);let result;
  if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,'utf8'));
  else{const began=Date.now(),trials=[];let candidate=initial,best=objective(before,initial.placement);const retained=new Map<string,{candidate:RouteCandidate;nodes:number[];score:number}>();retained.set(nodes.join(','),{candidate:initial,nodes,score:best});
   for(let seedId=0;seedId<selected.length;seedId++){const p=selected[seedId].placement,first=placeShape(shape.points,p)[0],start=g.nodeIndex.nearest(first[0],first[1],p.scale*.16);
    for(const profile of profiles)for(const reverse of [false,true]){const found=multiLabelContourPath(g,shape,p,region,start,{...profile,expectedRoadMeters:before.lengthMeters,reverse,maxExpanded:200000,maxLabels:300000,maxGoals:24});let similarity:number|null=null,rawObjective:number|null=null,validGoals=0;
     for(const path of found.paths)if(valid(path)){const e=evaluatePath(g,shape,p,path,3000,8000);if(e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2){validGoals++;const c=toCandidate(g,shape,p,e),score=objective(e,p),key=path.join(',');similarity=Math.max(similarity??0,e.similarity);rawObjective=Math.min(rawObjective??Infinity,score);if(!retained.has(key)||retained.get(key)!.score>score)retained.set(key,{candidate:c,nodes:path,score});}}
     trials.push({seedId,...profile,reverse,expanded:found.expanded,labels:found.labels,goals:found.goals,uniqueGoals:found.paths.length,validGoals,capReached:found.capReached,similarity,rawObjective});
    }
   }
   let refitEvaluations=0;for(const parent of [...retained.values()].sort((a,b)=>a.score-b.score).slice(0,8)){const refit=refinePathPlacement(g,shape,parent.candidate.placement,parent.nodes,region,3000,8000,120);if(!refit)continue;refitEvaluations+=refit.evaluations;const score=objective(refit.evaluated,refit.placement);if(score<parent.score){parent.score=score;parent.candidate=toCandidate(g,shape,refit.placement,refit.evaluated);}}
   const pool=[...retained.values()].sort((a,b)=>a.score-b.score);if(pool[0].score<best){best=pool[0].score;candidate=pool[0].candidate;}
   result={caseId:row.caseId,cacheKey,before:before.similarity,after:candidate.similarity,rawBefore:objective(before,initial.placement),rawAfter:best,elapsedMs:Date.now()-began,selectedPoses:selected.map(q=>q.placement),trials,refitEvaluations,candidate,pool:pool.slice(0,16).map(q=>q.candidate)};writeFileSync(file,JSON.stringify(result,null,2));
  }
  for(const c of [result.candidate,...result.pool] as RouteCandidate[]){const finalNodes=c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});expect(valid(finalNodes)).toBe(true);const e=evaluatePath(g,shape,c.placement,finalNodes,3000,8000);expect(e.similarity).toBe(c.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);expect(validPose(c.placement)).toBe(true);}
  expect(result.after).toBeGreaterThanOrEqual(before.similarity);results.push(result);
 }
 const summary={caseCount:results.length,beforeAverage:results.reduce((s,r)=>s+r.before,0)/results.length,afterAverage:results.reduce((s,r)=>s+r.after,0)/results.length};
 writeFileSync(path.join(out,filter?'filtered-results.json':'results.json'),JSON.stringify({protocol:{input,codeHashes,profiles,maxPoses:1,maxExpanded:200000,maxLabels:300000,maxGoals:24,bucketMeters:500,minMeters:3000,maxMeters:8000,repeatMax:.2,refitTop:8,refitBudget:120,poolMax:16,normalizedCost:'local approximation only; incoming edge, phase and 500m length bucket retain one best label; immutable reconstruction; no exact optimality guarantee'},summary,cases:results},null,2));
},1800000);


