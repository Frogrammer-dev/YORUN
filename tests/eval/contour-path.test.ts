import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { buildContourPath, CONTOUR, refitPlacement } from '@/lib/route/contourPath';
import { cleanClosedLoop, cutThinSpikes, evaluatePath, toCandidate, type RouteCandidate } from '@/lib/route/fit';
import { PathFinder, project } from '@/lib/route/graph';
import { graphFromOverpass } from '@/lib/route/osm';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
const areas=[{id:'gwangalli',bbox:{south:35.143,west:129.1,north:35.166,east:129.128}},{id:'seomyeon',bbox:{south:35.145,west:129.048,north:35.17,east:129.076}},{id:'gangnam',bbox:{south:37.49,west:127.02,north:37.515,east:127.051}}];
it.skipIf(!process.env.CONTOUR_EVAL)('direction-aware road contour fixed 12 cases',()=>{
 const rows=[];const output='eval/recognition/route-improvement/path';mkdirSync(output,{recursive:true});
 for(const area of areas){
  const g=graphFromOverpass(JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${area.id}-roads.json`,'utf8')),area.bbox,{excludeSteps:true,detail:'simple'}), finder=new PathFinder(g);
  const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
  for(const id of ['square','heart','star','cat'] as ShapeId[]){
   const caseId=`${area.id}-${id}`, base:RouteCandidate=JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${caseId}-baseline.json`,'utf8')).candidate;
   let best=base;const attempts=[];
   for(const radius of [.04,.08,.12,.18,.25])for(const turnCost of [30,80])for(const guideWeight of [.6,2]){
    Object.assign(CONTOUR,{radius,turnCost,guideWeight});
    const r=buildContourPath(g,SHAPE_BY_ID[id],base.placement);if(!r){attempts.push({radius,turnCost,guideWeight,score:0});continue;}
    const path=cutThinSpikes(g,finder,cleanClosedLoop(r.path)),fit=refitPlacement(r.pairs);
    const e=evaluatePath(g,SHAPE_BY_ID[id],fit,path,3000,8000);
    const connected=path.every((v,i)=>!i||g.adjTo.slice(g.adjStart[path[i-1]],g.adjStart[path[i-1]+1]).includes(v));
    const inside=path.every(v=>g.x[v]>=minX-1&&g.x[v]<=maxX+1&&g.y[v]>=minY-1&&g.y[v]<=maxY+1);
    const valid=connected&&inside&&path.length>=4&&path[0]===path.at(-1)&&e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2;
    attempts.push({radius,turnCost,guideWeight,score:valid?e.similarity:0,length:e.lengthMeters,repeat:e.repeatRatio,connected,inside});
    if(valid&&e.similarity>best.similarity)best=toCandidate(g,SHAPE_BY_ID[id],fit,e);
   }
   const row={caseId,baseline:base.similarity,best:best.similarity,candidate:best,attempts};rows.push(row);console.log(JSON.stringify({caseId,baseline:base.similarity,best:best.similarity}));
   writeFileSync(`${output}/results.json`,JSON.stringify({mean:rows.reduce((s,r)=>s+r.best,0)/rows.length,rows},null,2));
  }
 }
 Object.assign(CONTOUR,{radius:.1,turnCost:80,guideWeight:.6});
},600000);

