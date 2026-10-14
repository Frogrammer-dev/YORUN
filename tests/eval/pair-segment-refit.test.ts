import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, toCandidate, type Evaluated, type Placement, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairEdgeKey, pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';

const quality=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);

it.skipIf(!process.env.PAIR_SEGMENT_REFIT)('compares original and replacement geometries under identical phase-aware uniform refit budgets',()=>{
  const root=path.resolve('eval/recognition/route-improvement'),sourceDir=path.resolve('eval/recognition/llm-routes-20261010'),input=path.join(root,'combined-strict-v11/results.json'),pairInput=path.join(root,'pair-segment-20261012/trial-v2/results.json'),out=path.join(root,'pair-segment-20261012/trial-v3-refit');mkdirSync(out,{recursive:true});
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex'),inputText=readFileSync(input,'utf8'),pairText=readFileSync(pairInput,'utf8');
  const inputs=JSON.parse(inputText) as Array<{caseId:string;candidate:RouteCandidate}>;
  const paired=(JSON.parse(pairText) as {cases:Array<{caseId:string;candidate:RouteCandidate}>}).cases;
  const areaText=readFileSync(path.join(sourceDir,'round2-results.json'),'utf8'),areas=(JSON.parse(areaText) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const codeFiles=['tests/eval/pair-segment-refit.test.ts','src/lib/route/pairSegmentRepair.ts','src/lib/route/fit.ts','src/lib/route/graph.ts','src/lib/route/osm.ts','src/lib/route/shapes.ts'];
  const codeHashes=Object.fromEntries(codeFiles.map(f=>[f,hash(readFileSync(f,'utf8'))]));
  const params={maxEvaluations:128,shiftMaxFraction:.2,scaleMinFraction:.8,scaleMaxFraction:1.2,rotationMaxDegrees:30,fractions:[.06,.03,.015,.0075,.00375],roundsPerFraction:3,minMeters:3000,maxMeters:8000,repeatMax:.2};
  const results=[];const combined=[];const began=Date.now();
  // Validate every original case and the final selected result, not only the four pilots.
  for(const row of inputs){
    const area=areas.find(a=>row.caseId.startsWith(a.id+'-'))!,text=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),'utf8'),json=JSON.parse(text),g=graphFromOverpass(json,area.bbox,{detail:'simple',excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),shape=SHAPE_BY_ID[row.candidate.shapeId as ShapeId];
    const inside=(x:number,y:number)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
    const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
    const nodesFor=(c:RouteCandidate)=>c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
    const valid=(nodes:number[])=>nodes.length>=4&&nodes[0]===nodes.at(-1)&&nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(!i||hasEdge(g,nodes[i-1],v)));
    const validate=(c:RouteCandidate)=>{const nodes=nodesFor(c);expect(valid(nodes)).toBe(true);expect(placeShape(shape.points,c.placement).every(([x,y])=>inside(x,y))).toBe(true);const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);expect(e.similarity).toBe(c.similarity);expect(e.lengthMeters).toBeGreaterThanOrEqual(3000);expect(e.lengthMeters).toBeLessThanOrEqual(8000);expect(e.repeatRatio).toBeLessThanOrEqual(.2);return e;};
    const originalE=validate(row.candidate),originalQ=quality(originalE,row.candidate.placement);
    const repair=paired.find(c=>c.caseId===row.caseId);let selected=row.candidate,selectedQ=originalQ,method='strict-v11';
    if(repair){
      validate(repair.candidate);expect(repair.candidate.placement).toEqual(row.candidate.placement);
      const refit=(inputCandidate:RouteCandidate)=>{
        const nodes=nodesFor(inputCandidate),initial=inputCandidate.placement,original=evaluatePath(g,shape,initial,nodes,3000,8000),originalScore=quality(original,initial);let evaluations=0;
        const check=(p:Placement)=>{
          if(evaluations>=128||p.scale<initial.scale*.8||p.scale>initial.scale*1.2||Math.abs(p.cx-initial.cx)>initial.scale*.2||Math.abs(p.cy-initial.cy)>initial.scale*.2||Math.abs(p.rotDeg-initial.rotDeg)>30||!placeShape(shape.points,p).every(([x,y])=>inside(x,y)))return null;
          evaluations++;const canonical=pairPhaseZero(g,shape,p,nodes),e=evaluatePath(g,shape,p,canonical,3000,8000);if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)return null;return {p,e,q:quality(e,p)};
        };
        let best=check({...initial})!;expect(best).not.toBeNull();const phaseZeroInitialRaw=100*Math.exp(-best.q);
        let output={p:initial,e:original,q:originalScore};
        for(const fraction of params.fractions)for(let round=0;round<3&&evaluations<128;round++){
          const origin=best.p;let improved=false;
          for(const [dx,dy,ds,dr] of [[1,0,0,0],[-1,0,0,0],[0,1,0,0],[0,-1,0,0],[0,0,1,0],[0,0,-1,0],[0,0,0,1],[0,0,0,-1]]){
            const p={cx:origin.cx+dx*fraction*initial.scale,cy:origin.cy+dy*fraction*initial.scale,scale:origin.scale*(1+ds*fraction),rotDeg:origin.rotDeg+dr*fraction*100},item=check(p);if(!item)continue;
            if(item.q<best.q-1e-7){best=item;improved=true;}
            const changedPose=p.cx!==initial.cx||p.cy!==initial.cy||p.scale!==initial.scale||p.rotDeg!==initial.rotDeg;
            // Reprinting unchanged geometry at the identical pose is diagnostic only.
            if(changedPose&&item.q<output.q-1e-7)output=item;
          }
          if(!improved)break;
        }
        expect(evaluations).toBeLessThanOrEqual(128);expect(pairEdgeKey(output.e.path)).toBe(pairEdgeKey(nodes));
        const candidate=toCandidate(g,shape,output.p,output.e);validate(candidate);
        if(output.p!==initial)expect(output.e.path).toEqual(pairPhaseZero(g,shape,output.p,output.e.path));
        return {candidate,raw:100*Math.exp(-output.q),q:output.q,evaluations,phaseZeroInitialRaw,inputRaw:100*Math.exp(-originalScore),changedPose:output.p!==initial};
      };
      const baselineRefit=refit(row.candidate),pairedRefit=refit(repair.candidate),sameGeometry=pairEdgeKey(nodesFor(row.candidate))===pairEdgeKey(nodesFor(repair.candidate));
      if(sameGeometry){expect(pairedRefit.raw).toBeCloseTo(baselineRefit.raw,9);expect(pairedRefit.candidate).toEqual(baselineRefit.candidate);}
      if(baselineRefit.q<selectedQ){selected=baselineRefit.candidate;selectedQ=baselineRefit.q;method='baseline-phase-aware-refit';}
      if(pairedRefit.q<selectedQ){selected=pairedRefit.candidate;selectedQ=pairedRefit.q;method='paired-phase-aware-refit';}
      const geometryContribution=!sameGeometry?pairedRefit.raw-baselineRefit.raw:0;
      const result={caseId:row.caseId,sourceHash:hash(text),dataTimestamp:json.osm3s?.timestamp_osm_base,before:row.candidate.similarity,after:selected.similarity,originalRaw:100*Math.exp(-originalQ),baselineRefit,pairedRefit,sameGeometry,geometryContribution,geometryImproved:!sameGeometry&&pairedRefit.raw>baselineRefit.raw+1e-7,candidate:selected,method};results.push(result);writeFileSync(path.join(out,`${row.caseId}.json`),JSON.stringify(result,null,2));
      console.log(JSON.stringify({caseId:row.caseId,before:result.before,after:result.after,originalRaw:result.originalRaw,baselineRefitRaw:baselineRefit.raw,pairedRefitRaw:pairedRefit.raw,geometryContribution,method}));
    }
    validate(selected);expect(selectedQ).toBeLessThanOrEqual(originalQ+1e-10);combined.push({caseId:row.caseId,candidate:selected,before:row.candidate.similarity,after:selected.similarity,beforeRaw:100*Math.exp(-originalQ),afterRaw:100*Math.exp(-selectedQ),method});
  }
  expect(results).toHaveLength(4);expect(combined).toHaveLength(12);
  const summary={caseCount:4,fullOriginalCaseCount:12,fullBeforeAverage:combined.reduce((s,c)=>s+c.before,0)/12,fullAfterAverage:combined.reduce((s,c)=>s+c.after,0)/12,fullRawBeforeAverage:combined.reduce((s,c)=>s+c.beforeRaw,0)/12,fullRawAfterAverage:combined.reduce((s,c)=>s+c.afterRaw,0)/12,geometryContributions:results.filter(c=>c.geometryImproved).length,elapsedMs:Date.now()-began};
  writeFileSync(path.join(out,'results.json'),JSON.stringify({protocol:{input,inputHash:hash(inputText),pairInput,pairInputHash:hash(pairText),areaProtocolHash:hash(areaText),codeHashes,params,paramsHash:hash(JSON.stringify(params)),phaseZeroEveryPose:true,originalIncumbentPreserved:true,geometryVersusPlacementSeparated:true,samePoseSameEdgeReprintGainDiagnosticOnly:true,appModified:false,uniformTransformOnly:true},summary,cases:results,combinedCases:combined},null,2));console.log(JSON.stringify(summary));
},1800000);
