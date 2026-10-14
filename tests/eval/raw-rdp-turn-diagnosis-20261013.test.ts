import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, turnStats, type RouteCandidate } from '@/lib/route/fit';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { rdpIndices } from '@/lib/art/rdp';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
type XY=[number,number];
const angle=(a:XY,b:XY,c:XY)=>{let d=Math.atan2(c[1]-b[1],c[0]-b[0])-Math.atan2(b[1]-a[1],b[0]-a[0]);while(d>Math.PI)d-=2*Math.PI;while(d < -Math.PI)d+=2*Math.PI;return Math.abs(d);};
it.skipIf(!process.env.RAW_RDP_DIAGNOSIS)('compares raw turns, RDP10m and degree2 chains without changing original routes',()=>{
 const root=path.resolve('eval/recognition/route-improvement'),base=path.join(root,'corrected-arc-segment-20261013/trial-v2'),out=path.join(root,'raw-rdp-turn-diagnosis-20261013'),source=path.resolve('eval/recognition/llm-routes-20261010');mkdirSync(out,{recursive:true});
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),inputText=readFileSync(path.join(base,'frozen-automatic-input.json'),'utf8'),inputs=(JSON.parse(inputText) as {cases:Array<{caseId:string;label:string;candidate:RouteCandidate}>}).cases;
 const areaText=readFileSync(path.join(source,'round2-results.json'),'utf8'),areas=(JSON.parse(areaText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas,results=[];
 for(const caseId of ['gwangalli-cat','seomyeon-star']){
  const row=inputs.find(r=>r.caseId===caseId&&r.label==='narrow')!,area=areas.find(a=>caseId.startsWith(a.id+'-'))!,roadText=readFileSync(path.join(source,`${area.id}-roads.json`),'utf8'),g=graphFromOverpass(JSON.parse(roadText),area.bbox,{detail:'simple',excludeSteps:true}),shape=SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
  const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
  const degree=Array.from({length:g.n},(_,v)=>new Set(Array.from(g.adjTo.slice(g.adjStart[v],g.adjStart[v+1]))).size);
  const originalNodes=row.candidate.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1),input=pairPhaseZero(g,shape,row.candidate.placement,originalNodes);expect(input.every(v=>v>=0)).toBe(true);expect(pairEdgeKey(input)).toBe(pairEdgeKey(originalNodes));
  const inspect=(nodes:number[])=>{
   const xy:XY[]=nodes.map(v=>[g.x[v],g.y[v]]),keep=rdpIndices(xy,10),kept=new Set(keep),raw=xy.slice(1,-1).map((p,i)=>({index:i+1,angle:angle(xy[i],p,xy[i+2]),degree:degree[nodes[i+1]],kept:kept.has(i+1)})),e=evaluatePath(g,shape,row.candidate.placement,nodes,3000,8000),native=turnStats(xy);
   const bounds=[0,...nodes.slice(1,-1).map((v,i)=>degree[v]!==2?i+1:-1).filter(i=>i>=0),nodes.length-1],chains=[];
   for(let j=1;j<bounds.length;j++){
    const left=bounds[j-1],right=bounds[j],pts=xy.slice(left,right+1),localKeep=rdpIndices(pts,10),simplified=localKeep.map(i=>pts[i]),turns=turnStats(pts);
    const internal=raw.filter(t=>t.index>left&&t.index<right);
    const length=pts.slice(1).reduce((s,p,i)=>s+Math.hypot(p[0]-pts[i][0],p[1]-pts[i][1]),0);
    chains.push({left,right,nodeCount:pts.length,length,rawAngleSum:internal.reduce((s,t)=>s+t.angle,0),rawSharp:internal.filter(t=>t.angle>=Math.PI/4).length,localRdpSharp:turns.sharp,localRdpKept:localKeep.length,globalRdpKeptInterior:internal.filter(t=>t.kept).length,entryHeading:Math.atan2(pts[1][1]-pts[0][1],pts[1][0]-pts[0][0]),exitHeading:Math.atan2(pts.at(-1)![1]-pts.at(-2)![1],pts.at(-1)![0]-pts.at(-2)![0]),simplified});
   }
   let chainBoundarySharp=0,chainBoundaryAngleSum=0;
   for(let j=1;j<chains.length;j++){const a=chains[j-1].simplified,b=chains[j].simplified,d=angle(a.at(-2)!,a.at(-1)!,b[1]);chainBoundaryAngleSum+=d;if(d>=Math.PI/4)chainBoundarySharp++;}
   return {lengthMeters:e.lengthMeters,meanDev:e.meanDev,zigzagPerKm:e.zigzagPerKm,similarity:e.similarity,nativeRdpSharp:native.sharp,nativeRdpUturn:native.uturn,rawAngleSum:raw.reduce((s,t)=>s+t.angle,0),rawSharp:raw.filter(t=>t.angle>=Math.PI/4).length,rawSmallAngleSum:raw.filter(t=>t.angle<Math.PI/4).reduce((s,t)=>s+t.angle,0),degree2AngleSum:raw.filter(t=>t.degree===2).reduce((s,t)=>s+t.angle,0),removedRdpAngleSum:raw.filter(t=>!t.kept).reduce((s,t)=>s+t.angle,0),removedDegree2AngleSum:raw.filter(t=>!t.kept&&t.degree===2).reduce((s,t)=>s+t.angle,0),rdpKept:keep.length,originalNodes:nodes.length,degree2Interior:raw.filter(t=>t.degree===2).length,chainCount:chains.length,chains:chains.map(c=>({...c,simplified:undefined})),chainBoundarySharp,chainBoundaryAngleSum,chainApproxSharp:chainBoundarySharp+chains.reduce((s,c)=>s+c.localRdpSharp,0),rawNodes:raw};
  };
  const baseline=inspect(input),modes=[];
  for(const mode of ['control','corrected']){
   const text=readFileSync(path.join(base,`${caseId}-${mode}.json`),'utf8'),alts=(JSON.parse(text) as {alternatives:Array<{left:number;right:number;segment:number[];singleRaw:number}>}).alternatives;
   const rows=alts.map((a,id)=>{const nodes=pairPhaseZero(g,shape,row.candidate.placement,[...input.slice(0,a.left),...a.segment,...input.slice(a.right+1)]);return {id,left:a.left,right:a.right,singleRaw:a.singleRaw,metrics:inspect(nodes)};});
   modes.push({mode,inputSha256:hash(text),alternatives:rows});
  }
  results.push({caseId,roadSha256:hash(roadText),baseline,originalBaseline:inspect(originalNodes),sameInputGeometry:true,modes});
 }
 const codeHashes=Object.fromEntries(['tests/eval/raw-rdp-turn-diagnosis-20261013.test.ts','src/lib/route/fit.ts','src/lib/art/rdp.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/shapes.ts','src/lib/route/pairSegmentRepair.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]));
 writeFileSync(path.join(out,'results.json'),JSON.stringify({protocol:{frozenInputSha256:hash(inputText),areaSha256:hash(areaText),codeHashes,diagnosticOnly:true,rdpToleranceMeters:10,sharpDegrees:45,degree:'unique graph neighbors, endpoints split every measured path',anchor:'original deterministic geometry phase0; no optimized seams',newCandidateGenerated:false,holdoutRead:false},cases:results},null,2));
},180000);
