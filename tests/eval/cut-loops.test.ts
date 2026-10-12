import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { cutLoopSearch } from "@/lib/route/cutLoopSearch";
import { evaluatePath, placeShape, type RouteCandidate } from "@/lib/route/fit";
import { hasEdge, project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

type Result={caseId:string;candidate:RouteCandidate;cacheKey:string;before:number;after:number;pool:RouteCandidate[];cuts:number;evaluated:number;refitEvaluations:number;invalidBoundaries:number;componentsTested:number;placements:number;blocks:number;dataSha256:string;dataTimestamp:string};
const sha=(s:string)=>createHash("sha256").update(s).digest("hex");
it.skipIf(!process.env.CUT_LOOP_PILOT)("compares constrained actual-road cut candidates on the frozen 12 cases",()=>{
  const root="eval/recognition/route-improvement",dataRoot="eval/recognition/llm-routes-20261010",out=process.env.CUT_LOOP_OUTPUT??`${root}/cut-loops`;mkdirSync(out,{recursive:true});
  const frozen=JSON.parse(readFileSync(`${root}/frozen-baseline.json`,"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>};cases:Array<{caseId:string;baseline:RouteCandidate}>};
  const loops=JSON.parse(readFileSync(`${root}/loops/refined-results.json`,"utf8")) as {rows:Array<{caseId:string;candidate:RouteCandidate}>};
  const options={maxPlacements:3,unaryWeights:[.5,1,3,10],boundaryWeights:[.02,.08,.24],maxCuts:36,refitTopCount:8,refitEvaluationsPerPath:120};
  const codeHashes=Object.fromEntries(["src/lib/route/cutLoopSearch.ts","src/lib/route/loops.ts","src/lib/route/refinePlacement.ts","src/lib/route/fit.ts","src/lib/route/shapes.ts","src/lib/route/graph.ts","src/lib/route/osm.ts"].map(f=>[f,sha(readFileSync(f,"utf8"))]));
  const results:Result[]=[];
  for(const area of frozen.protocol.areas){
    const source=readFileSync(`${dataRoot}/${area.id}-roads.json`,"utf8"),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{detail:"simple",excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
    const inside=(x:number,y:number)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
    for(const id of ["square","heart","star","cat"] as ShapeId[]){
      const caseId=`${area.id}-${id}`,shape=SHAPE_BY_ID[id];
      const inputs=[frozen.cases.find(c=>c.caseId===caseId)!.baseline,loops.rows.find(c=>c.caseId===caseId)!.candidate];
      for(const folder of ["combined-pool-v5","combined-rank-v4"]){const file=`${root}/${folder}/${caseId}.json`;if(existsSync(file))inputs.unshift(JSON.parse(readFileSync(file,"utf8")).candidate);}
      const checked=(c:RouteCandidate)=>{
        const nodes=c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
        if(nodes.length<4||nodes[0]!==nodes.at(-1)||!nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(i===0||hasEdge(g,nodes[i-1],v)))||!placeShape(shape.points,c.placement).every(([x,y])=>inside(x,y)))return null;
        const e=evaluatePath(g,shape,c.placement,nodes,3000,8000);return e.lengthMeters>=3000&&e.lengthMeters<=8000&&e.repeatRatio<=.2?e:null;
      };
      const validInputs=inputs.filter(c=>checked(c));expect(validInputs.length).toBeGreaterThan(0);
      const before=Math.max(...validInputs.map(c=>checked(c)!.similarity)),file=path.join(out,`${caseId}.json`),cacheKey=sha(JSON.stringify({data:sha(source),inputs:validInputs,codeHashes,options}));
      let row:Result;
      if(existsSync(file)&&JSON.parse(readFileSync(file,"utf8")).cacheKey===cacheKey)row=JSON.parse(readFileSync(file,"utf8"));
      else{
        const result=cutLoopSearch(g,shape,region,validInputs,options);expect(result.candidate).not.toBeNull();
        expect(result.cuts).toBeLessThanOrEqual(36);expect(result.refitEvaluations).toBeLessThanOrEqual(960);
        for(const c of result.pool)expect(checked(c)).not.toBeNull();
        const e=checked(result.candidate!)!;expect(e.similarity).toBeGreaterThanOrEqual(before);
        row={caseId,cacheKey,before,after:e.similarity,...result,candidate:result.candidate!,dataSha256:sha(source),dataTimestamp:json.osm3s?.timestamp_osm_base};
        writeFileSync(file,JSON.stringify(row,null,2));
      }
      results.push(row);console.log(JSON.stringify({caseId,before,after:row.after,cuts:row.cuts,placements:row.placements,evaluated:row.evaluated}));
      writeFileSync(path.join(out,"progress.json"),JSON.stringify(results,null,2));
    }
  }
  expect(results).toHaveLength(12);
  const summary={beforeAverage:results.reduce((s,r)=>s+r.before,0)/12,afterAverage:results.reduce((s,r)=>s+r.after,0)/12,pass80:results.filter(r=>r.after>=80).length};
  writeFileSync(path.join(out,"results.json"),JSON.stringify({protocol:{options,codeHashes,graphDetail:"simple",score:"unchanged evaluatePath",unary:"face area times template inside/outside mismatch, normalized by scale squared",pairwise:"shared road length times squared template distance; virtual outside fixed label zero",core:"one strongest interior face fixed label one",topology:"up to three connected components are individually tested; holes and pinched boundaries rejected",minMeters:3000,maxMeters:8000,repeatMax:.2,pathAndTemplateInsideRegion:true,incumbentsRetained:true},summary,cases:results},null,2));
  console.log(JSON.stringify(summary));
},1800000);
