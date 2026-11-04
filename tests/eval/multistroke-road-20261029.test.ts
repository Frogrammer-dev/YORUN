import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {PathFinder,hasEdge,project,pointSegDist} from '@/lib/route/graph';
import {placeShape} from '@/lib/route/fit';
type XY=[number,number];
type Stroke={id:string;class:string;mode:string;stroke:number;target:XY[];predicted:XY[]};
type Candidate={xy:XY[];path:number[];placed:XY[][];connectors:XY[][];meters:number;projectedMeters:number;repeatRatio:number;connectorMeters:number;collapsedStrokes:number;objective:number;reasons:string[]};
it.skipIf(!process.env.MULTISTROKE_ROAD)('maps frozen multi-stroke predictions onto connected real roads',()=>{
 const inputs=JSON.parse(readFileSync('eval/recognition/multistroke-20261029/results.json','utf8')).outputs as Stroke[];
 const seeds=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8')).cases as {area:string;bbox:BBox;roadHash:string}[];
 const areas=seeds.filter((r,i)=>seeds.findIndex(s=>s.area===r.area)===i);expect(areas).toHaveLength(3);
 const results=[];
 for(const area of areas){
  const bytes=readFileSync(`eval/recognition/route-improvement/holdout/${area.area}-roads.json`);expect(createHash('sha256').update(bytes).digest('hex')).toBe(area.roadHash);
  const g=graphFromOverpass(JSON.parse(bytes.toString()),area.bbox,{detail:'simple',excludeSteps:true}),finder=new PathFinder(g);
  const [xmin,ymin]=project(g.origin,area.bbox.south,area.bbox.west),[xmax,ymax]=project(g.origin,area.bbox.north,area.bbox.east);
  const xy=(v:number):XY=>[g.x[v],g.y[v]],inside=(v:number)=>g.x[v]>=xmin&&g.x[v]<=xmax&&g.y[v]>=ymin&&g.y[v]<=ymax;
  const nodes=Array.from({length:g.n},(_,i)=>i).filter(inside);
  const nearest=([x,y]:XY)=>nodes.reduce((a,b)=>Math.hypot(g.x[a]-x,g.y[a]-y)<Math.hypot(g.x[b]-x,g.y[b]-y)?a:b,nodes[0]);
  const length=(a:number,b:number)=>{for(let e=g.adjStart[a];e<g.adjStart[a+1];e++)if(g.adjTo[e]===b)return g.adjLen[e];return NaN;};
  for(const name of ['apple','fish','bird']){
   const first=inputs.find(r=>r.class===name&&r.mode==='sparse')!;const strokes=inputs.filter(r=>r.id===first.id&&r.mode==='sparse').sort((a,b)=>a.stroke-b.stroke);
   let best:Candidate|null=null,diagnostic:Candidate|null=null,validCandidates=0,calls=0;const failures:Record<string,number>={};
   for(const dx of [-.1,0,.1])for(const dy of [-.1,0,.1])for(const rotDeg of [0,120,240]){
    const scale=Math.min(xmax-xmin,ymax-ymin)*.55,p={cx:(xmin+xmax)/2+dx*(xmax-xmin),cy:(ymin+ymax)/2+dy*(ymax-ymin),scale,rotDeg};
    const placed=strokes.map(s=>placeShape(s.predicted,p)),parts:number[][]=[],connectors:number[][]=[];let broken=false,collapsedStrokes=0;
    for(const stroke of placed){
     const pins=stroke.map(nearest);const path=[pins[0]];
     for(let j=1;j<pins.length;j++){
      if(pins[j]===pins[j-1])continue;calls++;const [ax,ay]=stroke[j-1],[bx,by]=stroke[j];const segment=finder.route(pins[j-1],pins[j],{ax,ay,bx,by,tol:Math.max(15,scale*.06),weight:1.5},12000);
      if(!segment){broken=true;break;}path.push(...segment.slice(1));
     }
     if(new Set(path).size===1)collapsedStrokes++;parts.push(path);
    }
    if(broken){failures.stroke_connection=(failures.stroke_connection??0)+1;continue;}
    let connectorMeters=0;const path=[...parts[0]];
    for(let s=0;s<parts.length;s++){
     const next=parts[(s+1)%parts.length],a=parts[s].at(-1)!,b=next[0];let link:number[]|null=[a];
     if(a!==b){calls++;link=finder.route(a,b,undefined,12000);}
     if(!link){broken=true;break;}connectors.push(link);
     for(let j=1;j<link.length;j++)connectorMeters+=length(link[j-1],link[j]);
     path.push(...link.slice(1));if(s<parts.length-1)path.push(...next.slice(1));
    }
    if(broken){failures.connector_connection=(failures.connector_connection??0)+1;continue;}
    let meters=0,repeated=0,pm=0,pr=0;const seen=new Set<string>();
    expect(path[0]).toBe(path.at(-1));
    for(let j=1;j<path.length;j++){const a=path[j-1],b=path[j];expect(hasEdge(g,a,b)).toBe(true);const len=length(a,b),pl=Math.hypot(g.x[a]-g.x[b],g.y[a]-g.y[b]),key=a<b?`${a}:${b}`:`${b}:${a}`;meters+=len;pm+=pl;if(seen.has(key)){repeated+=len;pr+=pl;}seen.add(key);}
    const reasons=[];if(!path.every(inside))reasons.push('outside');if(meters<3000||meters>8000||pm<3000||pm>8000)reasons.push('distance');if(repeated/Math.max(meters,1)>.2||pr/Math.max(pm,1)>.2)reasons.push('repeat');
    reasons.forEach(r=>{failures[r]=(failures[r]??0)+1;});
    const line=path.map(xy),targetSegments=placed.flatMap(s=>s.slice(1).map((b,i)=>[s[i],b] as [XY,XY])),roadSegments=line.slice(1).map((b,i)=>[line[i],b] as [XY,XY]);
    const distance=(points:XY[],segments:[XY,XY][])=>points.reduce((sum,v)=>sum+segments.reduce((d,[a,b])=>Math.min(d,pointSegDist(...v,...a,...b)),Infinity),0)/points.length;
    const objective=(distance(line,targetSegments)+distance(placed.flat(),roadSegments))/2/scale;
    const candidate:Candidate={xy:line,path,placed,connectors:connectors.map(p=>p.map(xy)),meters,projectedMeters:pm,repeatRatio:repeated/Math.max(meters,1),connectorMeters,collapsedStrokes,objective,reasons};
    if(!diagnostic||objective<diagnostic.objective)diagnostic=candidate;
    if(!reasons.length){validCandidates++;if(!best||objective<best.objective)best=candidate;}
   }
   results.push({area:area.area,class:name,id:first.id,source:strokes.map(s=>s.predicted),target:strokes.map(s=>s.target),attempts:27,calls,validCandidates,failures,valid:!!best,output:best??diagnostic});
  }
 }
 expect(results).toHaveLength(9);const summary={requests:9,validOutputs:results.filter(r=>r.valid).length,attempts:243,humanRecognitionMeasured:false,appIntegrated:false};
 const out='eval/recognition/multistroke-road-20261029';mkdirSync(out,{recursive:true});writeFileSync(`${out}/results.json`,JSON.stringify({summary,results}));mkdirSync('reports/multistroke-road-20261029',{recursive:true});writeFileSync('reports/multistroke-road-20261029/summary.json',JSON.stringify({summary,cases:results.map(({source,target,output,...r})=>({...r,meters:output?.meters,repeatRatio:output?.repeatRatio,connectorMeters:output?.connectorMeters,collapsedStrokes:output?.collapsedStrokes,reasons:output?.reasons}))},null,2));console.log(JSON.stringify(summary));
},180000);
