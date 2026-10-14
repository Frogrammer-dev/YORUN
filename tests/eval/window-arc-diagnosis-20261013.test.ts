import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { placeShape, type RouteCandidate } from '@/lib/route/fit';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { pointSegDist } from '@/lib/route/graph';
import { resample, SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
type XY=[number,number];
const distance=(v:XY,line:XY[])=>Math.min(...line.slice(1).map((b,i)=>pointSegDist(...v,...line[i],...b)));
const sample=(line:XY[])=>{
  const result:XY[]=[];
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],n=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/12));
    for(let k=0;k<n;k++)result.push([a[0]+(b[0]-a[0])*k/n,a[1]+(b[1]-a[1])*k/n]);
  }
  result.push(line.at(-1)!);return result;
};
/** Anchored node/template DTW. No seam optimization, no score measurements. */
const align=(nodes:XY[],outline:XY[])=>{
 const n=nodes.length,m=outline.length,dp=new Float64Array(n*m);dp.fill(Infinity);const prev=new Int8Array(n*m);prev.fill(-1);
 for(let i=0;i<n;i++)for(let k=0;k<m;k++){
  const cost=(nodes[i][0]-outline[k][0])**2+(nodes[i][1]-outline[k][1])**2,at=i*m+k;
  if(!i&&!k){dp[at]=cost;continue;}
  const options=[[i-1,k-1,0],[i-1,k,1],[i,k-1,2]];
  for(const [j,l,kind] of options)if(j>=0&&l>=0&&dp[j*m+l]+cost<dp[at]){dp[at]=dp[j*m+l]+cost;prev[at]=kind;}
 }
 const assigned:number[][]=Array.from({length:n},()=>[]);let i=n-1,k=m-1;
 while(i>=0&&k>=0){assigned[i].push(k);const kind=prev[i*m+k];if(kind<0)break;if(kind!==2)i--;if(kind!==1)k--;}
 return assigned.map(a=>Math.round(a.reduce((s,v)=>s+v,0)/a.length));
};
it.skipIf(!process.env.WINDOW_ARC_DIAGNOSIS)('measures segment arc mismatch without changing candidate quality or reading holdout',()=>{
 const base=path.resolve('eval/recognition/route-improvement/multi-segment-20261013/trial-v1'),out=path.resolve('eval/recognition/route-improvement/window-arc-diagnosis-20261013');mkdirSync(out,{recursive:true});
 const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
 const source=path.resolve('eval/recognition/llm-routes-20261010'),frozenText=readFileSync(path.join(base,'frozen-automatic-input.json'),'utf8'),input=(JSON.parse(frozenText) as {cases:Array<{label:string;caseId:string;candidate:RouteCandidate}>}).cases;
 const areasText=readFileSync(path.join(source,'round2-results.json'),'utf8'),areas=(JSON.parse(areasText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
 const results=[];
 for(const caseId of ['gwangalli-cat','seomyeon-star']){
  const row=input.find(r=>r.label==='narrow'&&r.caseId===caseId)!,area=areas.find(a=>caseId.startsWith(a.id+'-'))!,roadsText=readFileSync(path.join(source,`${area.id}-roads.json`),'utf8');
  const g=graphFromOverpass(JSON.parse(roadsText),area.bbox,{detail:'simple',excludeSteps:true}),shape=SHAPE_BY_ID[row.candidate.shapeId as ShapeId],index=new Map<string,number>();
  for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
  const nodes=pairPhaseZero(g,shape,row.candidate.placement,row.candidate.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1));expect(nodes.every(v=>v>=0)).toBe(true);
  const xy=nodes.map(v=>[g.x[v],g.y[v]] as XY),outline=placeShape(resample(shape.points,64),row.candidate.placement),phases=align(xy,outline);
  expect(phases.every((k,i)=>!i||k>=phases[i-1])).toBe(true);
  const altText=readFileSync(path.join(base,`${caseId}-depth2.json`),'utf8'),alts=(JSON.parse(altText) as {alternatives:Array<{left:number;right:number;segment:number[];singleRaw:number;singleValid:boolean}>}).alternatives;
  const rows=alts.map((a,id)=>{
   const first=phases[a.left],last=phases[a.right],arc=outline.slice(first,last+1);
   if(arc.length<2)return {id,left:a.left,right:a.right,first,last,stationaryArc:true,singleRaw:a.singleRaw};
   const metrics=(line:XY[])=>{
    const points=sample(line),arcPoints=sample(arc);
    const nearest=points.map(v=>{let best=Infinity,k=0;for(let j=1;j<outline.length;j++){const d=pointSegDist(...v,...outline[j-1],...outline[j]);if(d<best){best=d;k=j-1;}}return k;});
    const mean=(values:number[])=>values.reduce((s,v)=>s+v,0)/values.length;
    const forwardGlobal=mean(points.map(v=>distance(v,outline))),forwardArc=mean(points.map(v=>distance(v,arc))),reverseArc=mean(arcPoints.map(v=>distance(v,line)));
    return {forwardGlobal,forwardArc,reverseArc,bidirectionalArc:(forwardArc+reverseArc)/2,arcOutsideNearestFraction:nearest.filter(k=>Math.min(...[k-64,k,k+64].map(t=>Math.max(first-t,0,t-last)))>2).length/nearest.length,backwardJumpCount:nearest.filter((k,i)=>i&&((k-nearest[i-1]+96)%64)-32 < -2).length,largeJumpCount:nearest.filter((k,i)=>i&&Math.abs(((k-nearest[i-1]+96)%64)-32)>8).length,nearestProgress:nearest};
   };
   const old=metrics(xy.slice(a.left,a.right+1)),replacement=metrics(a.segment.map(v=>[g.x[v],g.y[v]] as XY));
   return {id,left:a.left,right:a.right,first,last,singleRaw:a.singleRaw,singleValid:a.singleValid,old,replacement,globalImprovesArcWorsens:replacement.forwardGlobal<old.forwardGlobal&&replacement.bidirectionalArc>old.bidirectionalArc,arcCoverageWorsens:replacement.reverseArc>old.reverseArc};
  });
  const measured=rows.filter(r=>!('stationaryArc' in r));
  results.push({caseId,sourceSha256:hash(roadsText),alternativesSha256:hash(altText),phaseMap:phases,rows,summary:{alternatives:rows.length,measured:measured.length,globalImprovesArcWorsens:measured.filter(r=>r.globalImprovesArcWorsens).length,arcCoverageWorsens:measured.filter(r=>r.arcCoverageWorsens).length,replacementArcOutside:measured.filter(r=>r.replacement!.arcOutsideNearestFraction>0).length,replacementBackwardJumps:measured.filter(r=>r.replacement!.backwardJumpCount>0).length}});
 }
 const codeHashes=Object.fromEntries(['tests/eval/window-arc-diagnosis-20261013.test.ts','src/lib/route/fit.ts','src/lib/route/shapes.ts','src/lib/route/pairSegmentRepair.ts'].map(f=>[f,hash(readFileSync(f,'utf8'))]));
 writeFileSync(path.join(out,'results.json'),JSON.stringify({protocol:{frozenInputSha256:hash(frozenText),sourceProtocolSha256:hash(areasText),codeHashes,anchor:'original geometric phase0 path; template sample0 to64 anchored DTW, no score seam selection',sampleSpacingMaxMeters:12,diagnosticOnly:true,noHoldout:true},cases:results},null,2));
},180000);
