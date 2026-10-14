import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { correctedArcRepair } from '@/lib/route/correctedArcRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

it.skipIf(!process.env.CORRECTED_ARC_PILOT)('evaluates joint disjoint real-road replacements with unchanged score and geometry-only phase zero',()=>{
  const sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),input=path.resolve('eval/recognition/route-improvement/multi-segment-20261013/trial-v1/frozen-automatic-input.json'),out=path.resolve('eval/recognition/route-improvement/corrected-arc-segment-20261013/trial-v2');mkdirSync(out,{recursive:true});
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  const inputText=readFileSync(input,'utf8'),areasText=readFileSync(path.join(sourceDir,'round2-results.json'),'utf8');
  writeFileSync(path.join(out,'frozen-automatic-input.json'),inputText);
  const sourceRows=(JSON.parse(inputText) as {cases:Array<{label:string;caseId:string;candidate:RouteCandidate}>}).cases.filter(r=>r.label==='narrow');
  const areas=(JSON.parse(areasText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const cases=['gwangalli-cat','seomyeon-star'];
  const rows=sourceRows.filter(c=>cases.includes(c.caseId));expect(rows).toHaveLength(2);
  const params={maxAlternatives:64,maxRoutingAttempts:128,maxEvaluations:256,beamWidth:8,maxExpanded:18000};
  const codeFiles=['tests/eval/corrected-arc-segment-20261013.test.ts','src/lib/route/correctedArcRepair.ts','src/lib/route/pairSegmentRepair.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/shapes.ts','src/lib/art/rdp.ts'];
  const codeHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(readFileSync(f,'utf8'))]));
  const results=[];
  for(const diversityCorrection of [false,true]) for(const row of rows){
    const maxChanges=6,arcMode=true,normalizedCost=true;
    const area=areas.find(a=>row.caseId.startsWith(a.id+'-'))!,text=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),json=JSON.parse(text),g=graphFromOverpass(json,area.bbox,{detail:'simple',excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY},c=row.candidate,shape=SHAPE_BY_ID[c.shapeId as ShapeId];
    const nodeIndex=new Map<string,number>();for(let v=0;v<g.n;v++)nodeIndex.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
    const nodes=c.latlngs.map(([lat,lon])=>nodeIndex.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
    expect(nodes.every((v,i)=>v>=0&&(!i||hasEdge(g,nodes[i-1],v)))).toBe(true);
    const before=evaluatePath(g,shape,c.placement,nodes,3000,8000);expect(before.similarity).toBe(c.similarity);
    const cacheKey=hash(JSON.stringify({inputHash:hash(inputText),sourceHash:hash(text),caseId:row.caseId,params,maxChanges,arcMode,normalizedCost,diversityCorrection,codeHashes})),file=path.join(out,`${row.caseId}-${diversityCorrection?"corrected":"control"}.json`),began=Date.now();
    let result;
    if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,'utf8'));
    else{
      writeFileSync(path.join(out,`${row.caseId}-progress.json`),JSON.stringify({caseId:row.caseId,stage:'joint-segments',cacheKey}));
      const repaired=correctedArcRepair(g,shape,c.placement,nodes,region,{...params,maxChanges,arcMode,phaseBins:8,normalizedCost,diversityCorrection});expect(repaired).not.toBeNull();
      const candidate=toCandidate(g,shape,c.placement,repaired!.evaluated);
      result={...repaired,evaluated:undefined,caseId:row.caseId,cacheKey,dataSha256:hash(text),dataTimestamp:json.osm3s?.timestamp_osm_base,before:before.similarity,after:candidate.similarity,candidate,elapsedMs:Date.now()-began};
      writeFileSync(file,JSON.stringify(result,null,2));
    }
    const candidate=result.candidate as RouteCandidate,newNodes=candidate.latlngs.map(([lat,lon])=>nodeIndex.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
    expect(newNodes[0]).toBe(newNodes.at(-1));expect(newNodes.every((v,i)=>v>=0&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY&&(!i||hasEdge(g,newNodes[i-1],v)))).toBe(true);
    expect(placeShape(shape.points,candidate.placement).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY)).toBe(true);
    expect(candidate.placement).toEqual(c.placement);
    const e=evaluatePath(g,shape,candidate.placement,newNodes,3000,8000);expect(e.similarity).toBe(candidate.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);
    expect(result.routingAttempts).toBeLessThanOrEqual(params.maxRoutingAttempts);expect(result.singleEvaluations).toBeLessThanOrEqual(params.maxAlternatives);expect(result.preciseEvaluations).toBe(2+result.singleEvaluations+result.pairEvaluations);expect(result.preciseEvaluations).toBeLessThanOrEqual(params.maxEvaluations);expect(result.afterRaw).toBeGreaterThanOrEqual(result.inputRaw-1e-8);
    if(result.geometryImprovement){expect(pairEdgeKey(newNodes)).not.toBe(pairEdgeKey(nodes));expect(newNodes).toEqual(pairPhaseZero(g,shape,c.placement,newNodes));expect(result.afterRaw).toBeGreaterThan(result.phaseZeroInputRaw);}
    else expect(newNodes).toEqual(nodes);
    results.push(result);console.log(JSON.stringify({caseId:row.caseId,before:result.before,after:result.after,rawBefore:result.inputRaw,rawAfter:result.afterRaw,kind:result.kind,alternatives:result.alternativeCount,pairs:result.pairEvaluations,changes:result.selectedChanges,preciseEvaluations:result.preciseEvaluations,maxChanges:result.maxChanges}));
  }
  for(const caseId of cases){const a=results.find(r=>r.caseId===caseId&&!r.diversityCorrection)!,b=results.find(r=>r.caseId===caseId&&r.diversityCorrection)!;expect(a.windowArcs).toEqual(b.windowArcs);const original=JSON.parse(readFileSync(path.resolve('eval/recognition/route-improvement/normalized-arc-segment-20261013/trial-v1',`${caseId}-normalized.json`),'utf8'));expect(a.alternatives).toEqual(original.alternatives);expect(a.afterRaw).toBeCloseTo(original.afterRaw,10);}
  const summary={caseCount:4,beforeAverage:results.reduce((s,c)=>s+c.before,0)/4,afterAverage:results.reduce((s,c)=>s+c.after,0)/4,rawBeforeAverage:results.reduce((s,c)=>s+c.inputRaw,0)/4,rawAfterAverage:results.reduce((s,c)=>s+c.afterRaw,0)/4,geometryImprovements:results.filter(c=>c.geometryImprovement).length,threePlusImprovements:results.filter(c=>c.kind==='multi').length,totalElapsedMs:results.reduce((s,c)=>s+c.elapsedMs,0)};
  writeFileSync(path.join(out,'results.json'),JSON.stringify({protocol:{input,inputHash:hash(inputText),sourceProtocolHash:hash(areasText),codeHashes,params,paramsHash:hash(JSON.stringify(params)),cases,detail:'simple',excludeSteps:true,minMeters:3000,maxMeters:8000,repeatMax:.2,originalScore:true,fixedOriginalTemplatePose:true,additionalRefit:false,deterministic:true,phaseZero:'nearest actual node to original template first point; direction agrees with template signed area; no score based seam search',sameEdgeGainForbidden:true,incumbentPreserved:true,validation:'real edges, closed loop, distances, repeat, original template and route inside original region',edgeDiversityPenalty:2,windowSelection:'automatic original-route deviation-ranked windows; 16 spatially distributed endpoint pairs; no case-specific manual windows',routingProfiles:[[0,0],[80,1],[240,0],[80,4],[80,1],[80,4],[240,1],[0,1]],combinationRanking:'width8 elite4 / negative2 / novelty-and-length-return2; fixed fullQ256 inclusive input2 and single64; whole-outline control versus local monotonic template arc / directed-edge x phase8; max6 fixed; frozen earlier controlled automatic inputs, separate from latest cascade77.4167' },summary,cases:results},null,2));
  console.log(JSON.stringify(summary));
},1800000);
