import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { project, hasEdge } from '@/lib/route/graph';
import { placeShape, type Placement } from '@/lib/route/fit';
import { SHAPE_BY_ID, resample, polylineLength, sharpVertices, type ShapeDef } from '@/lib/route/shapes';
import { orderedContourPath } from '@/lib/route/orderedContourPath';

const root='eval/recognition/point-contour-20261028';
type Seed={id:string;area:string;bbox:BBox;roadHash:string;shapeId:'apple'|'bird';baseline:{placement:Placement;path:number[]}};
type Proposal={id:string;predicted:[number,number][];retrieved:[number,number][]};
it.skipIf(!process.env.POINT_CONTOUR_ROAD)('exports real-road partial points or runs equal-budget generated contour diagnostics',()=>{
 const parent=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8'));
 const cases:Seed[]=parent.cases.filter((c:Seed)=>['apple','bird'].includes(c.shapeId));
 expect(cases).toHaveLength(3);
 const proposals:Proposal[]=process.env.POINT_CONTOUR_ROAD==='evaluate'?JSON.parse(readFileSync(`${root}/road-proposals.json`,'utf8')):[];
 const inputs=[], results=[];
 for(const c of cases){
  const bytes=readFileSync(`eval/recognition/route-improvement/holdout/${c.area}-roads.json`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.roadHash);
  const g=graphFromOverpass(JSON.parse(bytes.toString()),c.bbox,{detail:'simple',excludeSteps:true});
  const p=c.baseline.placement, angle=p.rotDeg*Math.PI/180, cos=Math.cos(angle),sin=Math.sin(angle);
  const normalized:[number,number][]=c.baseline.path.map(v=>{const x=(g.x[v]-p.cx)/p.scale,y=(g.y[v]-p.cy)/p.scale;return [x*cos+y*sin,-x*sin+y*cos];});
  const line=resample(normalized,64).slice(0,64), input=line.filter((_,i)=>i%4===0);
  inputs.push({id:c.id,class:c.shapeId,input,placement:p,source:'existing baseline path; not automatic point discovery'});
  if(!proposals.length)continue;
  const proposal=proposals.find(v=>v.id===c.id)!;
  const [minX,minY]=project(g.origin,c.bbox.south,c.bbox.west),[maxX,maxY]=project(g.origin,c.bbox.north,c.bbox.east),region={minX,minY,maxX,maxY};
  for(const mode of ['fixed','model','retrieval'] as const){
   let shape:ShapeDef=SHAPE_BY_ID[c.shapeId];
   if(mode!=='fixed'){
    const raw=mode==='model'?proposal.predicted:proposal.retrieved;
    expect(raw.length).toBe(64);expect(raw.flat().every(Number.isFinite)).toBe(true);
    const points:[number,number][]=[...raw,raw[0]];
    shape={id:'custom',name:mode,emoji:'',points,corners:false,kind:'object',perimeter:polylineLength(points),features:sharpVertices(points)};
   }
   const outline=placeShape(shape.points,p),first=outline[0];let start=0;
   for(let v=1;v<g.n;v++)if(Math.hypot(g.x[v]-first[0],g.y[v]-first[1])<Math.hypot(g.x[start]-first[0],g.y[start]-first[1]))start=v;
   const before=performance.now();
   const found=orderedContourPath(g,shape,p,region,start,{bins:32,guideWeight:1.5,radiusFraction:.2,maxExpanded:100000,minMeters:3000,maxMeters:8000});
   const path=found.path;let length=0,repeat=0,projectedMeters=0,projectedRepeat=0;const edges=new Set<string>();let valid=false;
   if(path){
    expect(path[0]).toBe(path.at(-1));
    for(let i=1;i<path.length;i++){
     const a=path[i-1],b=path[i];expect(hasEdge(g,a,b)).toBe(true);
     expect(g.x[b]>=minX&&g.x[b]<=maxX&&g.y[b]>=minY&&g.y[b]<=maxY).toBe(true);
     let distance=0;for(let e=g.adjStart[a];e<g.adjStart[a+1];e++)if(g.adjTo[e]===b){distance=g.adjLen[e];break;}
     const planar=Math.hypot(g.x[b]-g.x[a],g.y[b]-g.y[a]);projectedMeters+=planar;
     const key=a<b?`${a}:${b}`:`${b}:${a}`;length+=distance;if(edges.has(key)){repeat+=distance;projectedRepeat+=planar;}edges.add(key);
    }
    valid=length>=3000&&length<=8000&&repeat/length<=.2&&projectedMeters>=3000&&projectedMeters<=8000&&projectedRepeat/projectedMeters<=.2;
   }
   results.push({id:c.id,mode,valid,path:path??null,xy:path?.map(v=>[g.x[v],g.y[v]])??null,latlngs:path?.map(v=>[g.lat[v],g.lon[v]])??null,outline,meters:length,projectedMeters,projectedRepeatRatio:projectedMeters?projectedRepeat/projectedMeters:null,repeatRatio:length?repeat/length:null,expanded:found.expanded,elapsedMs:performance.now()-before});
  }
 }
 writeFileSync(`${root}/road-inputs.json`,JSON.stringify(inputs));
 if(proposals.length){
  expect(results).toHaveLength(9);
  const result={diagnosticOnly:true,automaticPointDiscovery:false,humanRecognitionMeasured:false,budgetPerArm:100000,results};
  writeFileSync(`${root}/road-results.json`,JSON.stringify(result));
  writeFileSync('reports/point-contour-20261028/road-summary.json',JSON.stringify({...result,results:results.map(({path,latlngs,outline,xy,...rest})=>({...rest,pathNodes:path?.length??0}))},null,2));
 }
 expect(existsSync(`${root}/road-inputs.json`)).toBe(true);
},180000);
