import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { offlineCascadeSearch, OFFLINE_CASCADE_PARAMS } from '@/lib/route/offlineCascadeSearch';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.OFFLINE_CASCADE)('evaluates a deterministic from-roads cold pipeline followed by bounded automatic refinements',()=>{
  const sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),out=path.resolve('eval/recognition/route-improvement/offline-cascade-20261013');mkdirSync(out,{recursive:true});
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  const sourceProtocolText=readFileSync(path.join(sourceDir,'round2-results.json'),'utf8'),areas=(JSON.parse(sourceProtocolText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const pilots=['gwangalli-cat','seomyeon-star','seomyeon-cat','gangnam-cat'],all=process.env.OFFLINE_CASCADE_ALL==='1',reuse=process.env.OFFLINE_CASCADE_REUSE==='1';
  const codeFiles=['src/lib/route/offlineCascadeSearch.ts','tests/eval/offline-cascade-search.test.ts','tests/eval/controlled-area-search.test.ts','src/lib/route/fit.ts','src/lib/route/flex.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/shapes.ts','src/lib/route/budget.ts','src/lib/route/loops.ts','src/lib/route/loopSearch.ts','src/lib/route/globalSearch.ts','src/lib/route/orderedContourPath.ts','src/lib/route/refinePlacement.ts','src/lib/route/largeSegmentRepair.ts','src/lib/route/pairSegmentRepair.ts','src/lib/art/rdp.ts'];
  const codeHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(readFileSync(f,'utf8'))]));
  const normalize=(s:string)=>s.replace(/\r\n/g,'\n'),controlled=normalize(readFileSync('tests/eval/controlled-area-search.test.ts','utf8')),core=normalize(readFileSync('src/lib/route/offlineCascadeSearch.ts','utf8')),start='    const validNodes=(p:number[])';
  const originalCold=controlled.slice(controlled.indexOf(start),controlled.indexOf('    const distances=(c:RouteCandidate|null)')),copiedCold=core.slice(core.indexOf(start),core.indexOf(' const cold={candidate:'));
  expect(copiedCold).toBe(originalCold);
  const params=OFFLINE_CASCADE_PARAMS,paramsHash=hash(JSON.stringify(params)),roadSources=Object.fromEntries(areas.map(a=>[a.id,hash(readFileSync(path.join(sourceDir,`${a.id}-roads.json`),'utf8'))]));
  const protocol={purpose:'Offline automatic cascade; original cold finishes before extra stages; no supplied or saved optimized routes',codeHashes,params,paramsHash,sourceProtocolHash:hash(sourceProtocolText),roadSources,literalColdBodyHash:hash(originalCold),literalColdBodyIdentical:true,defaultMode:'fresh from roads',reuseMode:'only this harness complete generation cache with all code/params/roads/protocol hashes identical',legacyControlledCacheUsed:false,manualSeeds:false,savedBestRoutesRead:false,originalScore:true,phaseZeroAtEveryNewAcceptedPathAndRefitPose:true,sameGeometrySamePoseReprintRejected:true,geometryAndPlacementSeparated:true,coldIncumbentPreserved:true,extraComputeBeyondCold:true,liveAppModified:false,pilot:!all,denominator:all?12:4};
  // Freeze provenance before any candidate quality is evaluated.
  writeFileSync(path.join(out,all?'full-protocol-before-run.json':'pilot-protocol-before-run.json'),JSON.stringify(protocol,null,2));
  const results=[];
  for(const area of areas){
    const source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{detail:'simple',excludeSteps:true}),[minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    for(const shapeId of ['square','heart','star','cat'] as ShapeId[]){
      const caseId=`${area.id}-${shapeId}`;if(!all&&!pilots.includes(caseId))continue;
      const shape=SHAPE_BY_ID[shapeId],cacheKey=hash(JSON.stringify({codeHashes,paramsHash,roadHash:hash(source),sourceProtocolHash:hash(sourceProtocolText),shapeId,bbox:area.bbox})),file=path.join(out,`${caseId}.json`),progressFile=path.join(out,`${caseId}-progress.json`),started=Date.now();
      let result;
      if(reuse&&existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result={...JSON.parse(readFileSync(file,'utf8')),generationCacheReused:true};
      else{
        const output=offlineCascadeSearch(g,shape,region,{onProgress:stage=>writeFileSync(progressFile,JSON.stringify({caseId,stage,cacheKey,sourceHash:hash(source),paramsHash,elapsedMs:Date.now()-started},null,2))});
        result={...output,caseId,cacheKey,sourceHash:hash(source),dataTimestamp:json.osm3s?.timestamp_osm_base,bbox:area.bbox,generationCacheReused:false,generatedFromRoads:true};writeFileSync(file,JSON.stringify(result,null,2));
      }
      const cold=result.cold.candidate as RouteCandidate|null,candidate=result.candidate as RouteCandidate|null;
      const nodesFor=(c:RouteCandidate)=>c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
      for(const c of [cold,candidate,...result.pool].filter(Boolean) as RouteCandidate[]){
        const nodes=nodesFor(c);expect(nodes[0]).toBe(nodes.at(-1));expect(nodes.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,nodes[i-1],v)))).toBe(true);
        expect(placeShape(shape.points,c.placement).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY)).toBe(true);
        const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);expect(e.similarity).toBe(c.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);
      }
      expect(result.raw).toBeGreaterThanOrEqual(result.cold.raw-1e-8);
      for(const stage of result.stages){expect(stage.rawAfter).toBeGreaterThanOrEqual(stage.rawBefore-1e-8);if(stage.rawAfter>stage.rawBefore+1e-7)expect(stage.rawAfter).toBeGreaterThan(stage.canonicalInputRaw);}
      if(candidate&&cold&&JSON.stringify(candidate)!==JSON.stringify(cold)){
        const nodes=nodesFor(candidate);expect(nodes).toEqual(pairPhaseZero(g,shape,candidate.placement,nodes));
        if(pairEdgeKey(nodes)===pairEdgeKey(nodesFor(cold)))expect(candidate.placement).not.toEqual(cold.placement);
      }
      expect(result.stages.find((s:{name:string})=>s.name==='face-beam')?.diagnostics.states??0).toBeLessThanOrEqual(1400);
      expect(result.stages.find((s:{name:string})=>s.name==='pair-segment')?.diagnostics.routingAttempts??0).toBeLessThanOrEqual(128);
      expect(result.stages.find((s:{name:string})=>s.name==='phase-aware-uniform-refit')?.diagnostics.evaluations??0).toBeLessThanOrEqual(128);
      results.push(result);console.log(JSON.stringify({caseId,baseline:result.cold.baselineSimilarity,cold:cold?.similarity??0,after:candidate?.similarity??0,coldRaw:result.cold.raw,afterRaw:result.raw,geometryChanges:result.geometryChanges,placementOnlyChanges:result.placementOnlyChanges,elapsedMs:result.elapsedMs,stages:result.stages.map((s:{name:string;before:number;after:number;rawBefore:number;rawAfter:number;elapsedMs:number})=>({name:s.name,before:s.before,after:s.after,rawBefore:s.rawBefore,rawAfter:s.rawAfter,ms:s.elapsedMs}))}));
    }
  }
  expect(results).toHaveLength(all?12:4);const denominator=all?12:4;
  const summary={caseCount:results.length,denominator,baselineAverage:results.reduce((s,c)=>s+c.cold.baselineSimilarity,0)/denominator,coldAverage:results.reduce((s,c)=>s+(c.cold.candidate?.similarity??0),0)/denominator,afterAverage:results.reduce((s,c)=>s+(c.candidate?.similarity??0),0)/denominator,coldRawAverage:results.reduce((s,c)=>s+c.cold.raw,0)/denominator,afterRawAverage:results.reduce((s,c)=>s+c.raw,0)/denominator,failures:results.filter(c=>!c.candidate).length,geometryChanges:results.reduce((s,c)=>s+(c.geometryChanges??0),0),placementOnlyChanges:results.reduce((s,c)=>s+(c.placementOnlyChanges??0),0),totalElapsedMs:results.reduce((s,c)=>s+c.elapsedMs,0),reusedGenerationCaches:results.filter(c=>c.generationCacheReused).length};
  writeFileSync(path.join(out,all?'results.json':'pilot-results.json'),JSON.stringify({protocol,summary,cases:results},null,2));console.log(JSON.stringify(summary));
},7200000);
