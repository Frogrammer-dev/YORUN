import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { hasEdge, project, type RoadGraph } from '@/lib/route/graph';
import { evaluatePath, placeShape, type Placement } from '@/lib/route/fit';
import { SHAPE_BY_ID, resample, type ShapeId, type ShapeDef } from '@/lib/route/shapes';
import { pairPhaseZero } from '@/lib/route/pairSegmentRepair';

type Diagnostic = { relationObjective: number };
type State = { valid: boolean; path: number[]; placement: Placement; latlngs: [number,number][]; rawSimilarity: number; nativeMeters: number; projectedMeters: number; repeatRatio: number; projectedRepeatRatio: number; edgeHash: string; uniformDiagnostics: Diagnostic; featureDiagnostics: Diagnostic };
type Arm = { mode: string; output: State | null; diagnostics: { attempts: number; expanded: number; acceptedRepairs: number; history: Array<{proposal:number; objective:number; relationObjective:number}> } };
type Item = {id:string; area:string; bbox:BBox; roadHash:string; shapeId:ShapeId; baseline:State; arms:Arm[]};
const base = 'eval/recognition/semantic-feature-20261025';
const sha = (v:string|Buffer) => createHash('sha256').update(v).digest('hex');
// Independent frozen transcription of the predeclared intervals, not an import
// of the generator's weight or objective functions.
const arcs:Record<string,number[][]> = {bird:[[3,9],[13,15]],apple:[[0,5],[9,13]],turtle:[[0,4],[5,8],[11,14],[18,21],[24,27]],car:[[2,5],[8,11],[12,15]]};
function errors(g:RoadGraph, shape:ShapeDef,p:Placement,path:number[],feature:boolean) {
  const route=resample(path.map(v=>[g.x[v],g.y[v]]),48).slice(0,48), target=placeShape(resample(shape.points,48),p).slice(0,48);
  let min=Infinity, chosen:number[]=[];
  for(const dir of [1,-1]) for(let offset=0;offset<48;offset++) {
    const indices=route.map((_,i)=>(offset+dir*i+96)%48);
    const sum=route.reduce((s,q,i)=>s+(q[0]-target[indices[i]][0])**2+(q[1]-target[indices[i]][1])**2,0);
    if(sum<min){min=sum;chosen=indices;}
  }
  const lengths=[0];
  for(let i=1;i<shape.points.length;i++) lengths.push(lengths[i-1]+Math.hypot(shape.points[i][0]-shape.points[i-1][0],shape.points[i][1]-shape.points[i-1][1]));
  const weights=chosen.map(i=>feature&&arcs[shape.id].some(([a,b])=>i/48*lengths.at(-1)!>=lengths[a]&&i/48*lengths.at(-1)!<=lengths[b])?4:1);
  const ds=route.map((q,i)=>Math.hypot(q[0]-target[chosen[i]][0],q[1]-target[chosen[i]][1])/p.scale), sum=weights.reduce((a,b)=>a+b,0);
  return ds.reduce((s,d,i)=>s+d*weights[i],0)/sum+.5*Math.max(...ds.map((d,i)=>d*weights[i]/(sum/48)));
}
it.skipIf(!process.env.SEMANTIC_FEATURE_AUDIT)('independently audits six fixed cases and three arms without requiring geometric score improvement',()=>{
  const bytes=readFileSync(`${base}/results.json`), data=JSON.parse(bytes.toString()) as {spec:{denominator:number;codeHashes:Record<string,string>};cases:Item[]};
  const initial=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8')) as {spec:{codeHashes:Record<string,string>};cases:Item[]};
  expect(data.cases).toHaveLength(6); expect(data.spec.denominator).toBe(6);
  expect(data.cases.map(c=>c.id).sort()).toEqual(initial.cases.map(c=>c.id).sort());
  for(const file of ['src/lib/route/fit.ts','src/lib/route/shapes.ts']) expect(sha(readFileSync(file))).toBe(initial.spec.codeHashes[file]);
  for(const [file,hash] of Object.entries(data.spec.codeHashes)) {
    expect(sha(readFileSync(file)),file).toBe(hash);
    const snapshot=`${base}/sources/${file.replaceAll('/','__')}.source.txt`;
    if(existsSync(snapshot)) expect(sha(readFileSync(snapshot))).toBe(hash);
  }
  const rows:Array<{id:string;mode:string;failed:boolean;rawSimilarity:number;edgeChanged?:boolean;improvesCanonicalProxy?:boolean}>=[];
  let checked=0;
  for(const item of data.cases) {
    const seed=initial.cases.find(c=>c.id===item.id)!;
    expect(item.shapeId).toBe(seed.shapeId);expect(item.bbox).toEqual(seed.bbox);expect(item.baseline.path).toEqual(seed.baseline.path);expect(item.baseline.placement).toEqual(seed.baseline.placement);
    const bytes=readFileSync(`eval/recognition/route-improvement/holdout/${item.area}-roads.json`);expect(sha(bytes)).toBe(item.roadHash);
    const g=graphFromOverpass(JSON.parse(bytes.toString()),item.bbox,{detail:'simple',excludeSteps:true});
    const [minX,minY]=project(g.origin,item.bbox.south,item.bbox.west),[maxX,maxY]=project(g.origin,item.bbox.north,item.bbox.east),shape=SHAPE_BY_ID[item.shapeId];
    const inside=(x:number,y:number)=>x>=minX-1e-7&&x<=maxX+1e-7&&y>=minY-1e-7&&y<=maxY+1e-7;
    const check=(state:State)=>{
      expect(state.valid).toBe(true);expect(state.placement).toEqual(item.baseline.placement);expect(state.path.length).toBeGreaterThanOrEqual(4);expect(state.path[0]).toBe(state.path.at(-1));expect(state.latlngs).toHaveLength(state.path.length);
      let native=0,projected=0,repeated=0,pRepeated=0;const edges=new Set<string>();
      state.path.forEach((v,i)=>{
        expect(Number.isInteger(v)&&v>=0&&v<g.n).toBe(true);expect(inside(g.x[v],g.y[v])).toBe(true);expect(state.latlngs[i]).toEqual([g.lat[v],g.lon[v]]);if(!i)return;
        const a=state.path[i-1];expect(hasEdge(g,a,v)).toBe(true);let length=NaN;
        for(let k=g.adjStart[a];k<g.adjStart[a+1];k++)if(g.adjTo[k]===v){length=g.adjLen[k];break;}
        expect(Number.isFinite(length)&&length>=0).toBe(true);const d=Math.hypot(g.x[v]-g.x[a],g.y[v]-g.y[a]),key=a<v?`${a}:${v}`:`${v}:${a}`;
        native+=length;projected+=d;if(edges.has(key)){repeated+=length;pRepeated+=d;}edges.add(key);
      });
      expect(native).toBeGreaterThanOrEqual(3000);expect(native).toBeLessThanOrEqual(8000);expect(projected).toBeGreaterThanOrEqual(3000);expect(projected).toBeLessThanOrEqual(8000);expect(repeated/native).toBeLessThanOrEqual(.2);expect(pRepeated/projected).toBeLessThanOrEqual(.2);
      expect(state.nativeMeters).toBeCloseTo(native,7);expect(state.projectedMeters).toBeCloseTo(projected,7);expect(state.repeatRatio).toBeCloseTo(repeated/native,10);expect(state.projectedRepeatRatio).toBeCloseTo(pRepeated/projected,10);expect(state.edgeHash).toBe(sha([...edges].sort().join(',')));
      expect(placeShape(shape.points,state.placement).every(([x,y])=>inside(x,y))).toBe(true);
      const p=state.placement,e=evaluatePath(g,shape,p,state.path,3000,8000),q=e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
      expect(state.rawSimilarity).toBeCloseTo(100*Math.exp(-q),8);
      if(state.uniformDiagnostics) expect(state.uniformDiagnostics.relationObjective).toBeCloseTo(errors(g,shape,p,state.path,false),10);
      if(state.featureDiagnostics) expect(state.featureDiagnostics.relationObjective).toBeCloseTo(errors(g,shape,p,state.path,true),10);checked++;
    };
    check(item.baseline);expect(item.arms.map(a=>a.mode).sort()).toEqual(['feature','original','uniform']);
    for(const arm of item.arms){
      if(!arm.output){rows.push({id:item.id,mode:arm.mode,failed:true,rawSimilarity:0});continue;}
      check(arm.output);const d=arm.diagnostics;expect(d.attempts).toBeLessThanOrEqual(192);expect(d.expanded).toBeLessThanOrEqual(d.attempts*12000);
      if(arm.mode!=='original') {
        const key=arm.mode==='feature'?'featureDiagnostics':'uniformDiagnostics';expect(arm.output[key].relationObjective).toBeLessThanOrEqual(errors(g,shape,item.baseline.placement,item.baseline.path,arm.mode==='feature')+1e-9);
        expect(d.history).toHaveLength(d.acceptedRepairs+1);for(let i=1;i<d.history.length;i++){expect(d.history[i].relationObjective).toBeLessThan(d.history[i-1].relationObjective-1e-9);expect(d.history[i].proposal).toBeGreaterThan(d.history[i-1].proposal);}
        expect(d.history.at(-1)!.relationObjective).toBeCloseTo(arm.output[key].relationObjective,10);
      }
      rows.push({id:item.id,mode:arm.mode,failed:false,rawSimilarity:arm.output.rawSimilarity,edgeChanged:arm.output.edgeHash!==item.baseline.edgeHash,improvesCanonicalProxy:arm.mode==='original'?undefined:errors(g,shape,item.baseline.placement,arm.output.path,arm.mode==='feature')<errors(g,shape,item.baseline.placement,pairPhaseZero(g,shape,item.baseline.placement,item.baseline.path),arm.mode==='feature')-1e-9});
    }
  }
  const summaries=['original','uniform','feature'].map(mode=>{const r=rows.filter(v=>v.mode===mode);expect(r).toHaveLength(6);return {mode,denominator:6,failures:r.filter(v=>v.failed).length,meanRaw:r.reduce((s,v)=>s+v.rawSimilarity,0)/6,edgeChanged:r.filter(v=>v.edgeChanged).length};});
  writeFileSync(`${base}/audit.json`,JSON.stringify({status:'PASS',resultSha256:sha(bytes),checkedStates:checked,summaries,rows,semanticValidation:false},null,2));console.log(JSON.stringify({status:'PASS',checkedStates:checked,summaries}));
},300000);
