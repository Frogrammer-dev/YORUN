import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from "@/lib/route/fit";
import { refinePathPlacement } from "@/lib/route/refinePlacement";
import { hasEdge, project } from "@/lib/route/graph";
import { refineLoopFacesBeam } from "@/lib/route/loopSearch";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

type CandidateRow={caseId:string;candidate:RouteCandidate};
type ResultRow=CandidateRow & {cacheKey:string;before:number;after:number;states:number;evaluated:number;completedDepth:number;seedStates:number;dataSha256:string;dataTimestamp:string;inputScores:number[];pool:RouteCandidate[];refitEvaluations?:number;rawBefore?:number;rawAfter?:number};
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
it.skipIf(!process.env.LOOP_BEAM_PILOT)("evaluates bounded multi-start road-face beam search on the fixed 12 cases",()=>{
  const refit=!!process.env.LOOP_BEAM_REFIT;
  const dataDir="eval/recognition/llm-routes-20261010",out=process.env.LOOP_BEAM_OUTPUT??`eval/recognition/route-improvement/${refit?"loops-beam-refit":"loops-beam-pool"}`;mkdirSync(out,{recursive:true});
  const poolDir="eval/recognition/route-improvement/loops-beam-pool";
  const sourceFiles=[process.env.LOOP_BEAM_INPUT??"eval/recognition/route-improvement/repair-loops-v2/results.json","eval/recognition/route-improvement/loops/face-refined-results.json","eval/recognition/route-improvement/loops/refined-results.json"];
  const inputSets=sourceFiles.map(file=>{const data=JSON.parse(readFileSync(file,"utf8"));return (Array.isArray(data)?data:data.cases??data.rows) as CandidateRow[];});
  const areas=(JSON.parse(readFileSync(path.join(dataDir,"round2-results.json"),"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const options={beamWidth:3,maxDepth:10,maxStates:1400,maxEvaluations:2500,boundaryLimit:60};
  const codeHashes=Object.fromEntries(["src/lib/route/loopSearch.ts","src/lib/route/loops.ts","src/lib/route/fit.ts","src/lib/route/shapes.ts","src/lib/route/graph.ts","src/lib/route/osm.ts","src/lib/route/refinePlacement.ts"].map(f=>[f,sha(readFileSync(f,"utf8"))]));
  const results:ResultRow[]=[];
  for(const area of areas){
    const source=readFileSync(path.join(dataDir,`${area.id}-roads.json`),"utf8"),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{excludeSteps:true,detail:"simple"});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    const inside=(x:number,y:number)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
    const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
    for(const id of ["square","heart","star","cat"] as ShapeId[]){
      const caseId=`${area.id}-${id}`,shape=SHAPE_BY_ID[id],inputs=inputSets.map(rows=>rows.find(r=>r.caseId===caseId)!.candidate);
      const checked=(c:RouteCandidate)=>{
        const nodes=c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
        if(nodes.length<4||nodes[0]!==nodes.at(-1)||!nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(i===0||hasEdge(g,nodes[i-1],v)))||!placeShape(shape.points,c.placement).every(([x,y])=>inside(x,y)))return null;
        const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);return e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2?e:null;
      };
      const validInputs=inputs.filter(c=>checked(c));expect(validInputs.length).toBeGreaterThan(0);
      const before=Math.max(...validInputs.map(c=>checked(c)!.similarity));
      const cacheKey=sha(JSON.stringify({source:sha(source),inputs:validInputs,codeHashes,options})),file=path.join(out,`${caseId}.json`),poolFile=path.join(poolDir,`${caseId}.json`);
      let row:ResultRow;
      if(existsSync(file)&&JSON.parse(readFileSync(file,"utf8")).cacheKey===cacheKey)row=JSON.parse(readFileSync(file,"utf8"));
      else{
        const stored=refit&&existsSync(poolFile)?JSON.parse(readFileSync(poolFile,"utf8")) as ResultRow:null;
        const result=stored?.cacheKey===cacheKey?stored:refineLoopFacesBeam(g,shape,region,validInputs,options);expect(result.candidate).not.toBeNull();
        const e=checked(result.candidate!);expect(e).not.toBeNull();expect(e!.similarity).toBeGreaterThanOrEqual(before);
        row={caseId,cacheKey,before,after:e!.similarity,candidate:result.candidate!,pool:result.pool,states:result.states,evaluated:result.evaluated,completedDepth:result.completedDepth,seedStates:result.seedStates,dataSha256:sha(source),dataTimestamp:json.osm3s?.timestamp_osm_base,inputScores:validInputs.map(c=>checked(c)!.similarity)};
        const rawCache=new WeakMap<RouteCandidate,number>();
        const raw=(c:RouteCandidate)=>{const saved=rawCache.get(c);if(saved!==undefined)return saved;const e=checked(c)!;const value=100*Math.exp(-e.meanDev/(.08*c.placement.scale))*(.55+.45*e.featureCoverage)*Math.pow(.9,e.spikes)/(1+.03*e.zigzagPerKm);rawCache.set(c,value);return value;};
        row.rawBefore=raw(row.candidate);
        if(refit){
          const refined:RouteCandidate[]=[];let count=0;
          for(const parent of row.pool.slice(0,12)){
            const nodes=parent.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)!);
            const r=refinePathPlacement(g,shape,parent.placement,nodes,region,3000,8000,120);if(!r)continue;
            count+=r.evaluations;const c=toCandidate(g,shape,r.placement,r.evaluated);expect(checked(c)).not.toBeNull();refined.push(c);
          }
          const all=[row.candidate,...refined,...row.pool].sort((a,b)=>raw(b)-raw(a));
          row.candidate=all[0];row.after=checked(row.candidate)!.similarity;row.pool=all.slice(0,24);row.refitEvaluations=count;
        }
        row.rawAfter=raw(row.candidate);
        writeFileSync(file,JSON.stringify(row,null,2));
      }
      results.push(row);console.log(JSON.stringify({caseId,before,after:row.after,states:row.states,evaluated:row.evaluated,depth:row.completedDepth}));
      writeFileSync(path.join(out,"progress.json"),JSON.stringify(results,null,2));
    }
  }
  expect(results).toHaveLength(12);
  const summary={beforeAverage:results.reduce((s,r)=>s+r.before,0)/12,afterAverage:results.reduce((s,r)=>s+r.after,0)/12,rawBeamAverage:results.reduce((s,r)=>s+(r.rawBefore??0),0)/12,rawFinalAverage:results.reduce((s,r)=>s+(r.rawAfter??0),0)/12,additionalRefitEvaluations:results.reduce((s,r)=>s+(r.refitEvaluations??0),0),pass80:results.filter(r=>r.after>=80).length};
  writeFileSync(path.join(out,"results.json"),JSON.stringify({protocol:{options,poolRetained:24,uniformRefit:refit,refitTopCount:refit?12:0,refitMaxEvaluationsPerPath:120,rawBeforeMeaning:"beam winner before optional uniform refit, not the initial seed",sourceFiles,inputSha256:sourceFiles.map(f=>sha(readFileSync(f,"utf8"))),codeHashes,graphDetail:"simple",minMeters:3000,maxMeters:8000,repeatMax:.2,closed:true,actualEdgesOnly:true,pathAndTemplateInsideRegion:true,objective:"unchanged unrounded evaluatePath similarity",beamAllowsIntermediateDecline:true,bestValidInputRetained:true},summary,cases:results},null,2));
  console.log(JSON.stringify(summary));
},1800000);
