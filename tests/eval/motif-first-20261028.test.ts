import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {PathFinder,pointSegDist,hasEdge,project} from '@/lib/route/graph';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';
import {placeShape,type Placement} from '@/lib/route/fit';

const out='eval/recognition/motif-first-20261028';
const motifs:Partial<Record<ShapeId,number>>={bird:6,apple:0,turtle:1,car:2};
type Seed={id:string;area:string;shapeId:ShapeId;bbox:BBox;roadHash:string;baseline:{path:number[];placement:Placement}};
it.skipIf(!process.env.MOTIF_FIRST)('preserves actual motif paths while completing a closed road route',()=>{
 mkdirSync(out,{recursive:true});
 const cases:Seed[]=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8')).cases;
 expect(cases).toHaveLength(6);const results=[];
 for(const c of cases){
  const bytes=readFileSync(`eval/recognition/route-improvement/holdout/${c.area}-roads.json`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.roadHash);
  const g=graphFromOverpass(JSON.parse(bytes.toString()),c.bbox,{detail:'simple',excludeSteps:true}),finder=new PathFinder(g);
  const p=c.baseline.placement,outline=placeShape(SHAPE_BY_ID[c.shapeId].points,p).slice(0,-1),n=outline.length,k=motifs[c.shapeId]!;
  const [minX,minY]=project(g.origin,c.bbox.south,c.bbox.west),[maxX,maxY]=project(g.origin,c.bbox.north,c.bbox.east);
  const inside=(v:number)=>g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY;
  const near=outline.map(([x,y])=>Array.from({length:g.n},(_,v)=>v).filter(v=>inside(v)&&Math.hypot(g.x[v]-x,g.y[v]-y)<=p.scale*.12).sort((a,b)=>Math.hypot(g.x[a]-x,g.y[a]-y)-Math.hypot(g.x[b]-x,g.y[b]-y)).slice(0,3));
  let calls=0,attempts=0,validCandidates=0;const failures:Record<string,number>={};
  const fail=(why:string)=>{failures[why]=(failures[why]??0)+1;};
  const route=(a:number,b:number,i:number)=>{calls++;const [ax,ay]=outline[i],[bx,by]=outline[(i+1)%n];return finder.route(a,b,{ax,ay,bx,by,tol:Math.max(15,p.scale*.06),weight:1.5},12000);};
  let best:null|{path:number[];motif:number[];objective:number;meters:number;repeatRatio:number;projectedMeters:number;projectedRepeatRatio:number}=null;
  if(near.some(a=>!a.length))fail('missing_anchor');
  else for(const a of near[k])for(const b of near[k+1])for(const d of near[k+2]){
   attempts++;if(new Set([a,b,d]).size<3){fail('collapsed_motif');continue;}
   const left=route(a,b,k),right=route(b,d,k+1);
   if(!left||!right){fail('motif_connection');continue;}
   const motif=[...left,...right.slice(1)];
   if(new Set(motif).size!==motif.length){fail('motif_retrace');continue;}
   const pins=near.map(a=>a[0]);pins[k]=a;pins[k+1]=b;pins[k+2]=d;
   const parts:(number[]|null)[]=Array.from({length:n},(_,i)=>i===k?left:i===k+1?right:route(pins[i],pins[(i+1)%n],i));
   if(parts.some(p=>!p)){fail('completion');continue;}
   const path=parts.flatMap((part,i)=>i?part!.slice(1):part!);
   let meters=0,repeated=0,projectedMeters=0,projectedRepeat=0;const seen=new Set<string>();let legal=path[0]===path.at(-1)&&path.every(inside);
   for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i];legal&&=hasEdge(g,a,b);let length=0;
    for(let e=g.adjStart[a];e<g.adjStart[a+1];e++)if(g.adjTo[e]===b){length=g.adjLen[e];break;}
    const pd=Math.hypot(g.x[a]-g.x[b],g.y[a]-g.y[b]);projectedMeters+=pd;meters+=length;
    const key=a<b?`${a}:${b}`:`${b}:${a}`;if(seen.has(key)){repeated+=length;projectedRepeat+=pd;}seen.add(key);
   }
   legal&&=meters>=3000&&meters<=8000&&repeated/meters<=.2&&projectedMeters>=3000&&projectedMeters<=8000&&projectedRepeat/projectedMeters<=.2;
   if(!legal){fail('road_validity');continue;}validCandidates++;
   const dev=motif.reduce((sum,v)=>sum+Math.min(pointSegDist(g.x[v],g.y[v],...outline[k],...outline[k+1]),pointSegDist(g.x[v],g.y[v],...outline[k+1],...outline[k+2])),0)/motif.length;
   const anchor=[a,b,d].reduce((s,v,j)=>s+Math.hypot(g.x[v]-outline[k+j][0],g.y[v]-outline[k+j][1]),0)/3;
   const objective=(dev+anchor)/p.scale;
   if(!best||objective<best.objective)best={path,motif,objective,meters,repeatRatio:repeated/meters,projectedMeters,projectedRepeatRatio:projectedRepeat/projectedMeters};
  }
  if(best){
   const offset=best.path.findIndex((v,i)=>v===best!.motif[0]&&best!.motif.every((w,j)=>best!.path[i+j]===w));
   expect(offset).toBeGreaterThanOrEqual(0);
   expect(best.path.every((v,i)=>inside(v)&&(!i||hasEdge(g,best!.path[i-1],v)))).toBe(true);
  }
  const xy=(path:number[])=>path.map(v=>[g.x[v],g.y[v]]);
  results.push({id:c.id,shapeId:c.shapeId,outline,reference:SHAPE_BY_ID[c.shapeId].points,attempts,calls,validCandidates,failures,baseline:xy(c.baseline.path),output:best?{...best,xy:xy(best.path),motifXY:xy(best.motif)}:null});
 }
 const summary={requests:6,validOutputs:results.filter(r=>r.output).length,totalAttempts:results.reduce((s,r)=>s+r.attempts,0),astarCalls:results.reduce((s,r)=>s+r.calls,0),humanRecognitionMeasured:false,equalBudgetComparison:false,appIntegrated:false};
 writeFileSync(`${out}/results.json`,JSON.stringify({summary,results}));
 mkdirSync('reports/motif-first-20261028',{recursive:true});writeFileSync('reports/motif-first-20261028/summary.json',JSON.stringify({summary,cases:results.map(({id,attempts,calls,validCandidates,failures,output})=>({id,attempts,calls,validCandidates,failures,valid:!!output,meters:output?.meters}))},null,2));
 console.log(JSON.stringify(summary));
},180000);
