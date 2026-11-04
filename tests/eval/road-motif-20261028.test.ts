import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {PathFinder,pointSegDist,hasEdge,project} from '@/lib/route/graph';
import {SHAPE_BY_ID,type ShapeId} from '@/lib/route/shapes';
import {placeShape,type Placement} from '@/lib/route/fit';
type XY=[number,number];
type Candidate={p:Placement;motif?:number[];a?:number;b?:number;d?:number;error:number};
type Output={xy:XY[];motifXY:XY[];outline:XY[];objective:number;meters:number;repeatRatio:number;path:number[]};
type Result={id:string;shapeId:ShapeId;method:string;reference:XY[];candidates:number;pool:number;calls:number;validCandidates:number;failures:Record<string,number>;preprocessingMs:number;searchMs:number;output:Output|null};
const motifs:Partial<Record<ShapeId,number>>={bird:6,apple:0,turtle:1,car:2};
function align(src:XY[],dst:XY[]):Placement{
 const mean=(p:XY[])=>p.reduce((s,v)=>[s[0]+v[0]/p.length,s[1]+v[1]/p.length] as XY,[0,0] as XY);
 const s=mean(src),t=mean(dst);let dot=0,cross=0,den=0;
 src.forEach(([x,y],i)=>{x-=s[0];y-=s[1];const u=dst[i][0]-t[0],v=dst[i][1]-t[1];dot+=x*u+y*v;cross+=x*v-y*u;den+=x*x+y*y;});
 const a=dot/den,b=cross/den;
 return {cx:t[0]-a*s[0]+b*s[1],cy:t[1]-b*s[0]-a*s[1],scale:Math.hypot(a,b),rotDeg:Math.atan2(b,a)*180/Math.PI};
}
it('fits rotation and scale without reflecting feature points',()=>{
 const src:XY[]=[[0,0],[1,0],[1,2]],p={cx:100,cy:-50,scale:230,rotDeg:37};
 const actual=align(src,placeShape(src,p));expect(actual.cx).toBeCloseTo(p.cx);expect(actual.cy).toBeCloseTo(p.cy);expect(actual.scale).toBeCloseTo(p.scale);expect(actual.rotDeg).toBeCloseTo(p.rotDeg);
});
it.skipIf(!process.env.ROAD_MOTIF)('compares road-derived placements with a 27-placement control',()=>{
 const cases=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8')).cases as {id:string;area:string;shapeId:ShapeId;bbox:BBox;roadHash:string;baseline:{placement:Placement}}[];
 expect(cases).toHaveLength(6);const results:Result[]=[];
 for(const c of cases){
  const started=performance.now(),bytes=readFileSync(`eval/recognition/route-improvement/holdout/${c.area}-roads.json`);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(c.roadHash);
  const g=graphFromOverpass(JSON.parse(bytes.toString()),c.bbox,{detail:'simple',excludeSteps:true}),finder=new PathFinder(g),shape=SHAPE_BY_ID[c.shapeId],k=motifs[c.shapeId]!,base=c.baseline.placement;
  const [minX,minY]=project(g.origin,c.bbox.south,c.bbox.west),[maxX,maxY]=project(g.origin,c.bbox.north,c.bbox.east);
  const within=([x,y]:XY)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY,xy=(v:number):XY=>[g.x[v],g.y[v]];
  const adj=(v:number)=>Array.from(g.adjTo.slice(g.adjStart[v],g.adjStart[v+1]));
  const pool:Candidate[]=[];
  for(let b=0;b<g.n;b++){
   if(!within(xy(b)))continue;
   const arms=adj(b).map(first=>{const path=[b,first];let len=Math.hypot(g.x[b]-g.x[first],g.y[b]-g.y[first]);
    while(len<400){const next=adj(path.at(-1)!).filter(v=>v!==path.at(-2));if(next.length!==1||path.includes(next[0]))break;const v=next[0],last=path.at(-1)!,d=Math.hypot(g.x[v]-g.x[last],g.y[v]-g.y[last]);if(len+d>400)break;path.push(v);len+=d;}
    return {path,len};}).filter(a=>a.len>=20&&a.len<=400&&a.path.every(v=>within(xy(v))));
   for(let i=0;i<arms.length;i++)for(let j=0;j<arms.length;j++)if(i!==j){
    const left=arms[i].path,right=arms[j].path,motif=[...left].reverse().concat(right.slice(1));if(new Set(motif).size!==motif.length)continue;
    const a=left.at(-1)!,d=right.at(-1)!,dst=[xy(a),xy(b),xy(d)],p=align(shape.points.slice(k,k+3),dst);
    if(p.scale<base.scale*.65||p.scale>base.scale*1.5)continue;
    const outline=placeShape(shape.points,p);if(!outline.every(within))continue;
    const error=dst.reduce((s,v,i)=>s+Math.hypot(v[0]-outline[k+i][0],v[1]-outline[k+i][1]),0)/3/p.scale;
    pool.push({p,motif,a,b,d,error});
   }
  }
  pool.sort((a,b)=>a.error-b.error);const selected:Candidate[]=[];
  for(const q of pool){if(selected.some(s=>Math.hypot(g.x[s.b!]-g.x[q.b!],g.y[s.b!]-g.y[q.b!])<100&&Math.abs(((s.p.rotDeg-q.p.rotDeg+540)%360)-180)<20))continue;selected.push(q);if(selected.length===27)break;}
  const control:Candidate[]=[];for(const x of [-.1,0,.1])for(const y of [-.1,0,.1])for(const r of [-20,0,20])control.push({p:{...base,cx:base.cx+x*base.scale,cy:base.cy+y*base.scale,rotDeg:base.rotDeg+r},error:0});
  const preprocessingMs=performance.now()-started;
  const poseOnly=selected.map(({p,error})=>({p,error} as Candidate));
  for(const [method,candidates] of [['control',control],['roadMotif',selected],['roadPoseOnly',poseOnly]] as const){
   const began=performance.now();let calls=0,validCandidates=0;const failures:Record<string,number>={};const fail=(why:string)=>{failures[why]=(failures[why]??0)+1;};
   let best:null|{xy:XY[];motifXY:XY[];outline:XY[];objective:number;meters:number;repeatRatio:number;path:number[]}=null;
   for(const q of candidates){
    const outline=placeShape(shape.points,q.p),n=outline.length-1;
    const pins=outline.slice(0,-1).map(([x,y])=>{let best=-1,dist=Infinity;for(let v=0;v<g.n;v++)if(within(xy(v))){const d=Math.hypot(g.x[v]-x,g.y[v]-y);if(d<dist){dist=d;best=v;}}return best;});
    if(pins.some(v=>v<0)){fail('missing_anchor');continue;}
    if(q.motif){pins[k]=q.a!;pins[k+1]=q.b!;pins[k+2]=q.d!;}
    const parts:(number[]|null)[]=[];
    for(let i=0;i<n;i++){
     if(q.motif&&(i===k||i===k+1)){const mid=q.motif.indexOf(q.b!);parts.push(i===k?q.motif.slice(0,mid+1):q.motif.slice(mid));continue;}
     calls++;const [ax,ay]=outline[i],[bx,by]=outline[i+1];parts.push(finder.route(pins[i],pins[(i+1)%n],{ax,ay,bx,by,tol:Math.max(15,q.p.scale*.06),weight:1.5},12000));
    }
    if(parts.some(p=>!p)){fail('connection');continue;}const path=parts.flatMap((p,i)=>i?p!.slice(1):p!);
    let meters=0,repeat=0,pm=0,pr=0,legal=path[0]===path.at(-1);const seen=new Set<string>();
    for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i];legal&&=hasEdge(g,a,b);let len=0;for(let e=g.adjStart[a];e<g.adjStart[a+1];e++)if(g.adjTo[e]===b){len=g.adjLen[e];break;}const pd=Math.hypot(g.x[a]-g.x[b],g.y[a]-g.y[b]),key=a<b?`${a}:${b}`:`${b}:${a}`;meters+=len;pm+=pd;if(seen.has(key)){repeat+=len;pr+=pd;}seen.add(key);}
    const reasons=[];if(!legal)reasons.push('illegal_edge_or_open');if(!path.every(v=>within(xy(v))))reasons.push('outside');if(meters<3000||meters>8000||pm<3000||pm>8000)reasons.push('distance');if(repeat/meters>.2||pr/pm>.2)reasons.push('repeat');if(reasons.length){reasons.forEach(fail);continue;}
    validCandidates++;const line=path.map(xy);
    const distance=(points:XY[],segments:XY[])=>points.reduce((s,p)=>s+Math.min(...segments.slice(1).map((v,i)=>pointSegDist(...p,...segments[i],...v))),0)/points.length;
    const objective=(distance(line,outline)+distance(outline,line))/2/q.p.scale;
    if(q.motif)expect(path.some((_,i)=>q.motif!.every((v,j)=>path[i+j]===v))).toBe(true);
    if(!best||objective<best.objective)best={xy:line,motifXY:q.motif?.map(xy)??[],outline,objective,meters,repeatRatio:repeat/meters,path};
   }
   results.push({id:c.id,shapeId:c.shapeId,method,reference:shape.points,candidates:candidates.length,pool:pool.length,calls,validCandidates,failures,preprocessingMs,searchMs:performance.now()-began,output:best});
  }
 }
 const summary=Object.fromEntries(['control','roadMotif','roadPoseOnly'].map(method=>{const r=results.filter(r=>r.method===method);return [method,{requests:r.length,validOutputs:r.filter(r=>r.output).length,candidates:r.reduce((s,r)=>s+r.candidates,0),calls:r.reduce((s,r)=>s+r.calls,0)}];}));
 const out='eval/recognition/road-motif-20261028';mkdirSync(out,{recursive:true});writeFileSync(`${out}/results.json`,JSON.stringify({summary,results}));
 mkdirSync('reports/road-motif-20261028',{recursive:true});writeFileSync('reports/road-motif-20261028/summary.json',JSON.stringify({summary,cases:results.map(({output,reference,...r})=>({...r,valid:!!output,objective:output?.objective,meters:output?.meters}))},null,2));
 console.log(JSON.stringify(summary));
},180000);
