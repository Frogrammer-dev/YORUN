import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {expect,it} from 'vitest';
import {evaluatePath,placeShape,toCandidate,type RouteCandidate} from '@/lib/route/fit';
import {hasEdge,project} from '@/lib/route/graph';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {orderedContourPath} from '@/lib/route/orderedContourPath';
import {refinePathPlacement} from '@/lib/route/refinePlacement';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';

it.skipIf(!process.env.ORDERED_CONTOUR)('searches contour correspondence with stationary phase transitions',()=>{
 const sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),input=path.resolve('eval/recognition/route-improvement/combined-incumbent-v6/results.json'),out=path.resolve('eval/recognition/route-improvement/ordered-contour');mkdirSync(out,{recursive:true});
 const rows=JSON.parse(readFileSync(input,'utf8')) as Array<{caseId:string;candidate:RouteCandidate}>;
 const areas=(JSON.parse(readFileSync(path.join(sourceDir,'round2-results.json'),'utf8')) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
 const profiles=[{bins:32,guideWeight:3,radiusFraction:.10},{bins:32,guideWeight:6,radiusFraction:.16},{bins:64,guideWeight:3,radiusFraction:.16},{bins:64,guideWeight:6,radiusFraction:.10}];
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),codeHashes=Object.fromEntries(['src/lib/route/orderedContourPath.ts','src/lib/route/refinePlacement.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/shapes.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]));
 const results=[];const filter=process.env.ORDERED_CASES?.split(',');
 for(const row of rows){if(filter&&!filter.includes(row.caseId))continue;
  const area=areas.find(a=>row.caseId.startsWith(`${a.id}-`))!,source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),g=graphFromOverpass(JSON.parse(source),area.bbox,{detail:'simple',excludeSteps:true});
  const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
  const initial=row.candidate,shape=SHAPE_BY_ID[initial.shapeId as ShapeId],nodes=initial.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
  const valid=(p:number[])=>p.length>=4&&p[0]===p.at(-1)&&p.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,p[i-1],v)));
  expect(valid(nodes)).toBe(true);const before=evaluatePath(g,shape,initial.placement,nodes,3000,8000),objective=(e:typeof before,p:typeof initial.placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
  const first=placeShape(shape.points,initial.placement)[0],start=[...nodes].sort((a,b)=>Math.hypot(g.x[a]-first[0],g.y[a]-first[1])-Math.hypot(g.x[b]-first[0],g.y[b]-first[1]))[0];
  const cacheKey=hash(JSON.stringify({source:hash(source),initial,codeHashes,profiles,maxExpanded:400000})),file=path.join(out,`${row.caseId}.json`);let result;
  if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,'utf8'));
  else{let candidate=initial,best=objective(before,initial.placement);const trials=[];const began=Date.now();
   for(const profile of profiles)for(const reverse of [false,true]){
    const found=orderedContourPath(g,shape,initial.placement,region,start,{...profile,reverse,maxExpanded:400000});let similarity:number|null=null;
    if(found.path&&valid(found.path)){const e=evaluatePath(g,shape,initial.placement,found.path,3000,8000);
     if(e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2){const refit=refinePathPlacement(g,shape,initial.placement,found.path,region,3000,8000,160),p=refit?.placement??initial.placement,ev=refit?.evaluated??e;similarity=ev.similarity;const score=objective(ev,p);if(score<best){best=score;candidate=toCandidate(g,shape,p,ev);}}}
    trials.push({...profile,reverse,expanded:found.expanded,states:found.states,pathFound:!!found.path,similarity});
   }result={caseId:row.caseId,cacheKey,before:before.similarity,after:candidate.similarity,elapsedMs:Date.now()-began,trials,candidate};writeFileSync(file,JSON.stringify(result,null,2));
  }
  const finalNodes=result.candidate.latlngs.map(([lat,lon]:[number,number])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});expect(valid(finalNodes)).toBe(true);const final=evaluatePath(g,shape,result.candidate.placement,finalNodes,3000,8000);expect(final.similarity).toBe(result.after);expect(final.lengthMeters).toBeGreaterThanOrEqual(3000);expect(final.lengthMeters).toBeLessThanOrEqual(8000);expect(final.repeatRatio).toBeLessThanOrEqual(.2);expect(final.similarity).toBeGreaterThanOrEqual(before.similarity);
  expect(placeShape(shape.points,result.candidate.placement).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY)).toBe(true);results.push(result);
 }
 const summary={caseCount:results.length,beforeAverage:results.reduce((s,r)=>s+r.before,0)/results.length,afterAverage:results.reduce((s,r)=>s+r.after,0)/results.length};
 writeFileSync(path.join(out,filter?'filtered-results.json':'results.json'),JSON.stringify({protocol:{input,codeHashes,profiles,maxExpanded:400000,minMeters:3000,maxMeters:8000,repeatMax:.2,phaseTransitions:'same actual node, reconstruction deduplicates consecutive nodes',uniformRefit:true},summary,cases:results},null,2));
},1800000);
