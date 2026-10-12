import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { StepBudget } from '@/lib/route/budget';
import { searchBlockLoops, refineLoopFaces } from '@/lib/route/loopSearch';
import { discoverRoutes } from '@/lib/route/discover';
import { project } from '@/lib/route/graph';
import { graphFromOverpass } from '@/lib/route/osm';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import type { RouteCandidate } from '@/lib/route/fit';
const areas=[{id:'gwangalli',bbox:{south:35.143,west:129.1,north:35.166,east:129.128}},{id:'seomyeon',bbox:{south:35.145,west:129.048,north:35.17,east:129.076}},{id:'gangnam',bbox:{south:37.49,west:127.02,north:37.515,east:127.051}}];
it.skipIf(!process.env.LOOP_EVAL)('fixed real road block loop search',()=>{
 const rows=[];const output='eval/recognition/route-improvement/loops';mkdirSync(output,{recursive:true});
 for(const area of areas){
 const g=graphFromOverpass(JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${area.id}-roads.json`,'utf8')),area.bbox,{excludeSteps:true,detail:'simple'});
 const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
 for(const id of ['square','heart','star','cat'] as ShapeId[]){
 const caseId=`${area.id}-${id}`,base:RouteCandidate=JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${caseId}-baseline.json`,'utf8')).candidate;
 const saved=process.env.LOOP_FACE_REFINE ? JSON.parse(readFileSync(`${output}/refined-results.json`,'utf8')).rows.find((row:{caseId:string})=>row.caseId===caseId).candidate:undefined;
 const face=saved?refineLoopFaces(g,SHAPE_BY_ID[id],region,saved):undefined;
 const r=face ? {candidates:[face.candidate],evaluated:face.evaluated} : process.env.LOOP_REFINED ? searchBlockLoops(g,SHAPE_BY_ID[id],region,[base.placement]) : discoverRoutes(g,{shapes:[SHAPE_BY_ID[id]],region,minMeters:3000,maxMeters:8000,mode:'shape',maxResults:40,budget:new StepBudget(4000)});
 const valid=r.candidates.filter(c=>{
 if(c.lengthMeters<3000||c.lengthMeters>8000||c.repeatRatio>.2)return false;
 const vertices=c.latlngs.map(([lat,lon])=>{let best=-1,bd=Infinity;for(let v=0;v<g.n;v++){const d=Math.abs(g.lat[v]-lat)+Math.abs(g.lon[v]-lon);if(d<bd){bd=d;best=v;}}return bd<1.1e-7?best:-1;});
 return vertices.every((v,i)=>v>=0&&g.x[v]>=minX-1&&g.x[v]<=maxX+1&&g.y[v]>=minY-1&&g.y[v]<=maxY+1&&(!i||g.adjTo.slice(g.adjStart[vertices[i-1]],g.adjStart[vertices[i-1]+1]).includes(v)))&&vertices[0]===vertices.at(-1);
 });
 valid.sort((a,b)=>b.similarity-a.similarity);const best=valid[0]&&valid[0].similarity>base.similarity?valid[0]:base;
 rows.push({caseId,baseline:base.similarity,best:best.similarity,candidate:best,loopBest:valid[0]?.similarity??0,evaluated:r.evaluated,validCount:valid.length});
 console.log(JSON.stringify({caseId,baseline:base.similarity,best:best.similarity,loops:valid.length,evaluated:r.evaluated}));
 writeFileSync(`${output}/${process.env.LOOP_FACE_REFINE?'face-refined':process.env.LOOP_REFINED?'refined':'discover'}-results.json`,JSON.stringify({protocol:{areas:areas.map(a=>a.id),shapes:["square","heart","star","cat"],minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,closed:true,actualEdgesOnly:true,regionFixed:true,score:"original evaluatePath",ranking:"maximum similarity among valid candidates; baseline retained",naturalSeed:83721,naturalSeeds:2000,quickNaturalTop:400,unionSeedCount:13,unionThresholds:[.3,.5,.7],unionPlacementVariants:729},mean:rows.reduce((s,r)=>s+r.best,0)/rows.length,rows},null,2));
 }
 }
},1800000);
