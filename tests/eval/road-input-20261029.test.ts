import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {hasEdge,project} from '@/lib/route/graph';
import {buildBlocks,growLoops} from '@/lib/route/loops';
import {StepBudget} from '@/lib/route/budget';
it.skipIf(!process.env.ROAD_INPUT)('extracts natural road loops without target shapes',()=>{
 const seeds=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8')).cases as {area:string;bbox:BBox;roadHash:string}[];
 const areas=seeds.filter((r,i)=>seeds.findIndex(s=>s.area===r.area)===i),results=[],counts=[];
 for(const a of areas){
  const bytes=readFileSync(`eval/recognition/route-improvement/holdout/${a.area}-roads.json`);expect(createHash('sha256').update(bytes).digest('hex')).toBe(a.roadHash);
  const g=graphFromOverpass(JSON.parse(bytes.toString()),a.bbox,{detail:'simple',excludeSteps:true});const [minX,minY]=project(g.origin,a.bbox.south,a.bbox.west),[maxX,maxY]=project(g.origin,a.bbox.north,a.bbox.east),region={minX,minY,maxX,maxY};
  const m=buildBlocks(g,(maxX-minX)*(maxY-minY)/4),loops=growLoops(g,m,region,3000,8000,{seeds:Math.min(2000,m.faces.length),budget:new StepBudget(2000),fraction:1,seed:83721});let accepted=0;
  const seen=new Set<string>();
  for(const loop of loops){
   const p=loop.path;if(p[0]!==p.at(-1)||!p.every(v=>g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY))continue;
   let native=0,pm=0,repeated=0,pr=0;const edges=new Set<string>();
   for(let i=1;i<p.length;i++){const x=p[i-1],y=p[i];expect(hasEdge(g,x,y)).toBe(true);let len=0;for(let e=g.adjStart[x];e<g.adjStart[x+1];e++)if(g.adjTo[e]===y){len=g.adjLen[e];break;}const d=Math.hypot(g.x[x]-g.x[y],g.y[x]-g.y[y]),key=x<y?`${x}:${y}`:`${y}:${x}`;native+=len;pm+=d;if(edges.has(key)){repeated+=len;pr+=d;}edges.add(key);}
   if(native<3000||native>8000||pm<3000||pm>8000||repeated/native>.2||pr/pm>.2)continue;
   const hash=[...edges].sort().join('|');if(seen.has(hash))continue;seen.add(hash);
   results.push({id:`${a.area}-${accepted+1}`,area:a.area,meters:native,repeatRatio:repeated/native,path:p,xy:p.map(v=>[g.x[v],g.y[v]]),latlon:p.map(v=>[g.lat[v],g.lon[v]])});if(++accepted===6)break;
  }
  counts.push({area:a.area,blocks:m.faces.length,naturalLoops:loops.length,exported:accepted});
 }
 mkdirSync('eval/recognition/road-input-20261029',{recursive:true});writeFileSync('eval/recognition/road-input-20261029/roads.json',JSON.stringify({counts,results,targetShapesUsed:false}));console.log(JSON.stringify(counts));
},120000);
