import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, toCandidate, type Evaluated, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { searchBlockLoops } from '@/lib/route/loopSearch';
import { matchShape, shapeSamples } from '@/lib/route/loops';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it('fits synthetic heart and cat rotated 150 degrees only when full rotation is opted in',()=>{
  for(const shapeId of ['heart','cat'] as ShapeId[]){
    const shape=SHAPE_BY_ID[shapeId],outline=placeShape(shape.points,{cx:200,cy:-100,scale:1000,rotDeg:150}),tmpl=shapeSamples(shape);
    const limited=matchShape(outline,shape,tmpl,true),explicitLimited=matchShape(outline,shape,tmpl,true,undefined,{fullRotation:false}),full=matchShape(outline,shape,tmpl,true,undefined,{fullRotation:true});
    expect(limited).toEqual(explicitLimited);expect(full).not.toBeNull();
    if(limited){expect(Math.abs(limited.rotDeg)).toBeLessThanOrEqual(50);expect(full!.resid).toBeLessThan(limited.resid);}
    expect(full!.resid).toBeLessThan(.001);expect(Math.abs(full!.rotDeg-150)).toBeLessThan(2);
  }
});

const quality=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);

it.skipIf(!process.env.FULL_ROTATION_LOOPS)('compares default and full-rotation block loops under identical frozen narrow-region budgets',()=>{
  const root=path.resolve('eval/recognition/route-improvement'),sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),out=path.join(root,'full-rotation-loops-20261012');mkdirSync(out,{recursive:true});
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  const inputFile=path.join(root,'pair-segment-20261012/trial-v3-refit/results.json'),inputText=readFileSync(inputFile,'utf8');
  const inputs=(JSON.parse(inputText) as {combinedCases:Array<{caseId:string;candidate:RouteCandidate}>}).combinedCases;
  const areaText=readFileSync(path.join(sourceDir,'round2-results.json'),'utf8'),areas=(JSON.parse(areaText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const pilot=['gwangalli-heart','gwangalli-cat','gangnam-cat'],full=process.env.FULL_ROTATION_LOOPS_ALL==='1',selected=inputs.filter(c=>full||pilot.includes(c.caseId));expect(selected).toHaveLength(full?12:3);
  const codeFiles=['tests/eval/full-rotation-loop.test.ts','src/lib/route/loops.ts','src/lib/route/loopSearch.ts','src/lib/route/pairSegmentRepair.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/shapes.ts','src/lib/route/osm.ts','src/lib/route/budget.ts'];
  const codeHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(readFileSync(f,'utf8'))]));
  const params={naturalSeeds:2000,naturalStepBudget:2000,naturalRandomSeed:83721,quickTop:400,globalSeeds:3,incumbentSeeds:1,baselineSeeds:1,unionThresholds:[.3,.5,.7],placementShift:[-.04,0,.04],placementScale:[.94,1,1.06],placementRotation:[-5,0,5],refitTop:8,refitBudget:128,refitShiftBound:.2,refitScaleBounds:[.8,1.2],refitRotationBound:30,refitFractions:[.06,.03,.015,.0075,.00375],refitRounds:3};
  const results:Array<{label:string;caseId:string;before:number;after:number;inputRaw:number;afterRaw:number;elapsedMs:number}>=[];
  for(const row of selected){
    const area=areas.find(a=>row.caseId.startsWith(a.id+'-'))!,source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{detail:'simple',excludeSteps:true}),shape=SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY},inside=(x:number,y:number)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
    const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
    const nodesFor=(c:RouteCandidate)=>c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
    const validNodes=(nodes:number[])=>nodes.length>=4&&nodes[0]===nodes.at(-1)&&nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(!i||hasEdge(g,nodes[i-1],v)));
    const originalNodes=nodesFor(row.candidate);expect(validNodes(originalNodes)).toBe(true);
    const original=evaluatePath(g,shape,row.candidate.placement,originalNodes,3000,8000),canonicalOriginal=evaluatePath(g,shape,row.candidate.placement,pairPhaseZero(g,shape,row.candidate.placement,originalNodes),3000,8000),originalQ=quality(original,row.candidate.placement),threshold=Math.min(originalQ,quality(canonicalOriginal,row.candidate.placement)),inputKey=pairEdgeKey(originalNodes);
    const baselineFile=path.join(sourceDir,`${row.caseId}-baseline.json`),globalFile=path.join(root,'global-similarity',`${row.caseId}.json`),baselineText=readFileSync(baselineFile,'utf8'),globalText=readFileSync(globalFile,'utf8');
    const baseline=(JSON.parse(baselineText) as {candidate:RouteCandidate}).candidate,global=JSON.parse(globalText) as {pool:RouteCandidate[];dataSha256:string};expect(global.dataSha256).toBe(hash(source));
    const seeds=[...global.pool.slice(0,3).map(c=>c.placement),row.candidate.placement,baseline.placement];expect(seeds).toHaveLength(5);
    for(const fullRotation of [false,true]){
      const label=fullRotation?'full':'control',cacheKey=hash(JSON.stringify({caseId:row.caseId,input:hash(inputText),source:hash(source),global:hash(globalText),baseline:hash(baselineText),codeHashes,params,fullRotation})),file=path.join(out,`${row.caseId}-${label}.json`),began=Date.now();let result;
      if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,'utf8'));
      else{
        writeFileSync(path.join(out,`${row.caseId}-${label}-progress.json`),JSON.stringify({caseId:row.caseId,label,stage:'block-loops',cacheKey}));
        const searched=searchBlockLoops(g,shape,region,seeds,3000,8000,{fullRotation});
        type Scored={candidate:RouteCandidate;nodes:number[];q:number;};const pool=new Map<string,Scored>();let strictEvaluations=0,sameEdgeDiagnostics=0,invalid=0,refitEvaluations=0;
        const assess=(nodes:number[],p:Placement)=>{
          if(!validNodes(nodes)||!placeShape(shape.points,p).every(([x,y])=>inside(x,y)))return null;
          const canonical=pairPhaseZero(g,shape,p,nodes),e=evaluatePath(g,shape,p,canonical,3000,8000);strictEvaluations++;
          if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)return null;
          const q=quality(e,p),key=pairEdgeKey(canonical);if(key===inputKey){sameEdgeDiagnostics++;return null;}
          const item={candidate:toCandidate(g,shape,p,e),nodes:canonical,q};if(!pool.has(key)||pool.get(key)!.q>q)pool.set(key,item);return item;
        };
        for(const c of searched.candidates)if(!assess(nodesFor(c),c.placement))invalid++;
        const sort=()=>[...pool.values()].sort((a,b)=>a.q-b.q);
        writeFileSync(path.join(out,`${row.caseId}-${label}-progress.json`),JSON.stringify({caseId:row.caseId,label,stage:'phase-aware-uniform-refit',searched:searched.evaluated,validGeometries:pool.size,elapsedMs:Date.now()-began}));
        for(const parent of sort().slice(0,8)){
          const initial=parent.candidate.placement;let best=parent,count=0;
          const check=(p:Placement)=>{if(count>=128||p.scale<initial.scale*.8||p.scale>initial.scale*1.2||Math.abs(p.cx-initial.cx)>initial.scale*.2||Math.abs(p.cy-initial.cy)>initial.scale*.2||Math.abs(p.rotDeg-initial.rotDeg)>30||!placeShape(shape.points,p).every(([x,y])=>inside(x,y)))return null;count++;return assess(parent.nodes,p);};
          for(const fraction of params.refitFractions)for(let round=0;round<3&&count<128;round++){
            const origin=best.candidate.placement;let improved=false;
            for(const [dx,dy,ds,dr] of [[1,0,0,0],[-1,0,0,0],[0,1,0,0],[0,-1,0,0],[0,0,1,0],[0,0,-1,0],[0,0,0,1],[0,0,0,-1]]){const p={cx:origin.cx+dx*fraction*initial.scale,cy:origin.cy+dy*fraction*initial.scale,scale:origin.scale*(1+ds*fraction),rotDeg:origin.rotDeg+dr*fraction*100},item=check(p);if(item&&item.q<best.q-1e-7){best=item;improved=true;}}
            if(!improved)break;
          }
          refitEvaluations+=count;
        }
        const best=sort().find(c=>c.q<threshold-1e-7),candidate=best?.candidate??row.candidate;
        result={caseId:row.caseId,label,cacheKey,fullRotation,before:original.similarity,after:candidate.similarity,inputRaw:100*Math.exp(-originalQ),canonicalInputRaw:100*Math.exp(-quality(canonicalOriginal,row.candidate.placement)),afterRaw:best?100*Math.exp(-best.q):100*Math.exp(-originalQ),geometryImprovement:!!best,candidate,pool:sort().slice(0,24).map(c=>c.candidate),sourceSha256:hash(source),globalSeedsSha256:hash(globalText),baselineSha256:hash(baselineText),dataTimestamp:json.osm3s?.timestamp_osm_base,seeds,searchEvaluated:searched.evaluated,naturalCount:searched.naturalCount,blocks:searched.blocks,strictEvaluations,refitEvaluations,invalid,sameEdgeDiagnostics,elapsedMs:Date.now()-began};writeFileSync(file,JSON.stringify(result,null,2));
      }
      const c=result.candidate as RouteCandidate,nodes=nodesFor(c);expect(validNodes(nodes)).toBe(true);expect(placeShape(shape.points,c.placement).every(([x,y])=>inside(x,y))).toBe(true);
      const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);expect(e.similarity).toBe(c.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);expect(result.afterRaw).toBeGreaterThanOrEqual(result.inputRaw-1e-7);
      if(result.geometryImprovement){expect(pairEdgeKey(nodes)).not.toBe(inputKey);expect(nodes).toEqual(pairPhaseZero(g,shape,c.placement,nodes));expect(result.afterRaw).toBeGreaterThan(result.canonicalInputRaw);}else expect(nodes).toEqual(originalNodes);
      results.push(result);console.log(JSON.stringify({caseId:row.caseId,label,before:result.before,after:result.after,rawBefore:result.inputRaw,rawAfter:result.afterRaw,geometryImprovement:result.geometryImprovement,rotDeg:c.placement.rotDeg,evaluated:result.searchEvaluated,ms:result.elapsedMs}));
    }
  }
  const summary=Object.fromEntries(['control','full'].map(label=>{const rows=results.filter(c=>c.label===label);return[label,{caseCount:rows.length,beforeAverage:rows.reduce((s,c)=>s+c.before,0)/rows.length,afterAverage:rows.reduce((s,c)=>s+c.after,0)/rows.length,rawBeforeAverage:rows.reduce((s,c)=>s+c.inputRaw,0)/rows.length,rawAfterAverage:rows.reduce((s,c)=>s+c.afterRaw,0)/rows.length,totalElapsedMs:rows.reduce((s,c)=>s+c.elapsedMs,0)}];}));
  writeFileSync(path.join(out,full?'results.json':'pilot-results.json'),JSON.stringify({protocol:{inputFile,inputHash:hash(inputText),sourceProtocolHash:hash(areaText),codeHashes,params,paramsHash:hash(JSON.stringify(params)),cases:selected.map(c=>c.caseId),narrowOnly:true,originalScore:true,additionalExperimentWithSavedIncumbentsAndGlobalSeeds:true,liveAutomaticAverage:false,fullRotationOnlyControlledDifference:true,phaseZeroEveryNewPathAndPose:true,sameInputEdgeReprintExcluded:true,strictInputPreserved:true,appModified:false,graphDetail:'simple',excludeSteps:true,minMeters:3000,maxMeters:8000,repeatMax:.2},summary,cases:results},null,2));console.log(JSON.stringify(summary));
},7200000);
