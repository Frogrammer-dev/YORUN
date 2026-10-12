import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { annealLoopSearch } from "@/lib/route/annealLoopSearch";
import { evaluatePath, placeShape, type RouteCandidate } from "@/lib/route/fit";
import { hasEdge, project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
type Row=Omit<ReturnType<typeof annealLoopSearch>,"candidate"> & {candidate:RouteCandidate;caseId:string;cacheKey:string;before:number;after:number;rawBefore:number;rawAfter:number;dataSha256:string;dataTimestamp:string;options:Record<string,number>};
it.skipIf(!process.env.ANNEAL_LOOP_PILOT)("evaluates deterministic fixed-budget face annealing without changing geometry scores",()=>{
  const root="eval/recognition/route-improvement",dataDir="eval/recognition/llm-routes-20261010",out=`${root}/anneal-loops-phase0`;mkdirSync(out,{recursive:true});
  const difficult=new Set(["seomyeon-star","seomyeon-cat","gangnam-cat"]),difficultOnly=!!process.env.ANNEAL_DIFFICULT_ONLY;
  const frozen=JSON.parse(readFileSync(`${root}/frozen-baseline.json`,"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>}};
  const beam=JSON.parse(readFileSync(`${root}/loops-beam-refit/results.json`,"utf8")) as {cases:Array<{caseId:string;candidate:RouteCandidate;pool:RouteCandidate[]}>};
  const codeHashes=Object.fromEntries(["src/lib/route/annealLoopSearch.ts","src/lib/route/loops.ts","src/lib/route/refinePlacement.ts","src/lib/route/fit.ts","src/lib/route/shapes.ts","src/lib/route/graph.ts","src/lib/route/osm.ts"].map(f=>[f,sha(readFileSync(f,"utf8"))]));
  const rows:Row[]=[];
  for(const area of frozen.protocol.areas){
    const source=readFileSync(`${dataDir}/${area.id}-roads.json`,"utf8"),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{detail:"simple",excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
    const inside=(x:number,y:number)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
    for(const id of ["square","heart","star","cat"] as ShapeId[]){
      const caseId=`${area.id}-${id}`;if(difficultOnly&&!difficult.has(caseId))continue;const shape=SHAPE_BY_ID[id];
      const exact=JSON.parse(readFileSync(`${root}/combined-exact-v9/${caseId}.json`,"utf8")).candidate as RouteCandidate,b=beam.cases.find(r=>r.caseId===caseId)!;
      const inputs=[exact,b.candidate,...b.pool];
      const checked=(c:RouteCandidate)=>{const nodes=c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);if(nodes.length<4||nodes[0]!==nodes.at(-1)||!nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(i===0||hasEdge(g,nodes[i-1],v)))||!placeShape(shape.points,c.placement).every(([x,y])=>inside(x,y)))return null;const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);return e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2?e:null;};
      const raw=(c:RouteCandidate)=>{const e=checked(c)!;return 100*Math.exp(-e.meanDev/(.08*c.placement.scale))*(.55+.45*e.featureCoverage)*Math.pow(.9,e.spikes)/(1+.03*e.zigzagPerKm);};
      const validInputs=inputs.filter(c=>checked(c));expect(validInputs.length).toBeGreaterThan(0);
      const before=Math.max(...validInputs.map(c=>checked(c)!.similarity)),rawBefore=Math.max(...validInputs.map(raw));
      const options={seed:parseInt(sha(caseId).slice(0,8),16),proposalBudget:2000,maxSeeds:3,temperatureStart:.03,temperatureEnd:.003,refitTopCount:8,refitEvaluationsPerPath:120};
      const cacheKey=sha(JSON.stringify({source:sha(source),validInputs,codeHashes,options})),file=path.join(out,`${caseId}.json`);let row:Row;
      if(existsSync(file)&&JSON.parse(readFileSync(file,"utf8")).cacheKey===cacheKey)row=JSON.parse(readFileSync(file,"utf8"));
      else{
        const r=annealLoopSearch(g,shape,region,validInputs,options);expect(r.candidate).not.toBeNull();
        expect(r.proposals).toBeLessThanOrEqual(2000);expect(r.proposalEvaluations).toBeLessThanOrEqual(2000);expect(r.refitEvaluations).toBeLessThanOrEqual(960);
        for(const c of r.pool)expect(checked(c)).not.toBeNull();
        const candidate=r.candidate!;expect(checked(candidate)!.similarity).toBeGreaterThanOrEqual(before);expect(raw(candidate)).toBeGreaterThanOrEqual(rawBefore-1e-7);
        row={...r,candidate,caseId,cacheKey,before,after:checked(candidate)!.similarity,rawBefore,rawAfter:raw(candidate),options,dataSha256:sha(source),dataTimestamp:json.osm3s?.timestamp_osm_base};writeFileSync(file,JSON.stringify(row,null,2));
      }
      const routeNodes=(c:RouteCandidate)=>c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)!);
      const edgeKey=(c:RouteCandidate)=>{const nodes=routeNodes(c);return nodes.slice(1).map((v,i)=>nodes[i]<v?`${nodes[i]}-${v}`:`${v}-${nodes[i]}`).sort().join(',');};
      const originalKeys=new Set(validInputs.map(edgeKey));
      for(const c of row.pool){
        expect(checked(c)).not.toBeNull();if(originalKeys.has(edgeKey(c)))continue;
        const nodes=routeNodes(c),outline=placeShape(shape.points,c.placement),[x,y]=outline[0];
        const firstDistance=(g.x[nodes[0]]-x)**2+(g.y[nodes[0]]-y)**2;
        expect(firstDistance).toBeLessThanOrEqual(Math.min(...nodes.map(v=>(g.x[v]-x)**2+(g.y[v]-y)**2))+1e-6);
        let roadArea=0,templateArea=0;for(let i=1;i<nodes.length;i++)roadArea+=g.x[nodes[i-1]]*g.y[nodes[i]]-g.x[nodes[i]]*g.y[nodes[i-1]];
        for(let i=1;i<outline.length;i++)templateArea+=outline[i-1][0]*outline[i][1]-outline[i][0]*outline[i-1][1];
        expect(roadArea*templateArea).toBeGreaterThanOrEqual(0);
      }
      if(row.geometryImprovement){expect(originalKeys.has(edgeKey(row.candidate))).toBe(false);expect(raw(row.candidate)).toBeGreaterThan(row.canonicalInputBestRaw);}
      rows.push(row);console.log(JSON.stringify({caseId,before,after:row.after,seeds:row.seeds,acceptedWorse:row.acceptedWorse,mismatches:row.reconstructionMismatches}));
      writeFileSync(path.join(out,"progress.json"),JSON.stringify(rows,null,2));
    }
  }
  expect(rows).toHaveLength(difficultOnly?3:12);
  const summary={beforeAverage:rows.reduce((s,r)=>s+r.before,0)/rows.length,afterAverage:rows.reduce((s,r)=>s+r.after,0)/rows.length,rawBeforeAverage:rows.reduce((s,r)=>s+r.rawBefore,0)/rows.length,rawAfterAverage:rows.reduce((s,r)=>s+r.rawAfter,0)/rows.length,pass80:rows.filter(r=>r.after>=80).length};
  writeFileSync(path.join(out,difficultOnly?"pilot-results.json":"results.json"),JSON.stringify({protocol:{codeHashes,difficultOnly,input:"combined-exact-v9 winner and loops-beam-refit pool",score:"unchanged unrounded evaluatePath negative log",phaseZero:"nearest actual node to template first vertex, direction agrees with template signed area; no score-based seam search",sameEdgeOutputs:"diagnostic only, never promoted as geometry improvement",geometryPromotion:"must beat both original and phase-zero incumbent scores",fixedPoseDuringAnnealing:true,proposalBudget:2000,maxSeeds:3,temperature:[.03,.003],proposals:["single face flip","neighboring same-label pair flip","neighboring inside/outside swap"],exactReconstructionRequired:true,refitTopCount:8,refitEvaluationsPerPath:120,additionalPostRefitPhaseZeroChecksMax:8,graphDetail:"simple",minMeters:3000,maxMeters:8000,repeatMax:.2,pathAndTemplateInsideRegion:true,actualEdgesOnly:true,incumbentsRetained:true},summary,cases:rows},null,2));console.log(JSON.stringify(summary));
},1800000);
