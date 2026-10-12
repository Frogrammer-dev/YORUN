import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { findRoutes, type Region, type RouteCandidate } from "@/lib/route/fit";
import { globalSearch } from "@/lib/route/globalSearch";
import { project, type RoadGraph } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

const sha = (s:string) => createHash("sha256").update(s).digest("hex");
type DetailRow = {caseId:string;cacheKey:string;dataSha256:string;dataTimestamp:string|null;detail:"simple"|"normal";area:string;shape:ShapeId;graphNodes:number;graphEdges:number;baselineEvaluated:number;globalEvaluated:number;baseline:RouteCandidate|null;global:RouteCandidate|null};
function valid(c:RouteCandidate,g:RoadGraph,r:Region) {
  const inside = ([lat,lon]:number[]) => { const [x,y]=project(g.origin,lat,lon); return x>=r.minX&&x<=r.maxX&&y>=r.minY&&y<=r.maxY; };
  const first=c.latlngs[0],last=c.latlngs.at(-1);
  return c.latlngs.length>=4 && first[0]===last?.[0] && first[1]===last?.[1] && c.lengthMeters>=3000 && c.lengthMeters<=8000 && c.repeatRatio<=.2 && c.latlngs.every(inside) && c.outline.every(inside);
}

it.skipIf(!process.env.GRAPH_DETAIL_PILOT)("diagnoses road-filter effects separately from the fixed simple benchmark", () => {
  const input=path.resolve("eval/recognition/llm-routes-20261010"),out=path.resolve("eval/recognition/route-improvement/graph-detail");
  mkdirSync(out,{recursive:true});
  const original=JSON.parse(readFileSync(path.join(input,"round2-results.json"),"utf8")) as {protocol:{areas:Array<{id:string;name:string;bbox:BBox}>}};
  const codeHashes=Object.fromEntries(["src/lib/route/fit.ts","src/lib/route/flex.ts","src/lib/route/graph.ts","src/lib/route/globalSearch.ts","src/lib/route/osm.ts","src/lib/route/shapes.ts"].map(f=>[f,sha(readFileSync(f,"utf8"))]));
  const rows:DetailRow[]=[];
  for(const area of original.protocol.areas) {
    const source=readFileSync(path.join(input,`${area.id}-roads.json`),"utf8"),json=JSON.parse(source),dataSha256=sha(source);
    for(const detail of ["simple","normal"] as const) {
      const g=graphFromOverpass(json,area.bbox,{excludeSteps:true,detail});
      const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
      const region={minX,minY,maxX,maxY};
      for(const id of ["square","heart","star","cat"] as ShapeId[]) {
        const caseId=`${area.id}-${id}-${detail}`,file=path.join(out,`${caseId}.json`);
        const cacheKey=sha(JSON.stringify({codeHashes,dataSha256,detail,id,baselineSteps:80,globalInitialAttempts:240,region,version:1}));
        let row:DetailRow;
        if(existsSync(file)&&JSON.parse(readFileSync(file,"utf8")).cacheKey===cacheKey) row=JSON.parse(readFileSync(file,"utf8"));
        else {
          const baseline=findRoutes(g,{shapes:[id],region,minMeters:3000,maxMeters:8000,budget:new StepBudget(80),resultsPerShape:8});
          const search=globalSearch(g,SHAPE_BY_ID[id],region,240);
          const baselineCandidate=baseline.candidates.find(c=>valid(c,g,region))??null;
          const globalCandidate=search.pool.find(c=>valid(c,g,region))??null;
          row={caseId,cacheKey,dataSha256,dataTimestamp:json.osm3s?.timestamp_osm_base??null,detail,area:area.name,shape:id,graphNodes:g.n,graphEdges:g.edgeCount,baselineEvaluated:baseline.evaluated,globalEvaluated:search.evaluated,baseline:baselineCandidate,global:globalCandidate};
          writeFileSync(file,JSON.stringify(row,null,2));
        }
        console.log(JSON.stringify({caseId,nodes:row.graphNodes,baseline:row.baseline?.similarity??0,global:row.global?.similarity??0,globalEvaluated:row.globalEvaluated}));
        rows.push(row);
      }
    }
  }
  expect(rows).toHaveLength(24);
  const summary=["simple","normal"].map(detail=>{const subset=rows.filter(r=>r.detail===detail);return {detail,baselineAverage:subset.reduce((s,r)=>s+(r.baseline?.similarity??0),0)/12,globalAverage:subset.reduce((s,r)=>s+(r.global?.similarity??0),0)/12,baselinePass80:subset.filter(r=>(r.baseline?.similarity??0)>=80).length,globalPass80:subset.filter(r=>(r.global?.similarity??0)>=80).length};});
  writeFileSync(path.join(out,"results.json"),JSON.stringify({protocol:{diagnosticOnly:true,primaryBenchmark:"unchanged simple-road fixed benchmark",graphDetail:"simple vs normal is a separate graph-input ablation; no UI default changes",ranking:"unchanged cost; missing valid candidates count as zero",minMeters:3000,maxMeters:8000,repeatMax:.2,closed:true,roadPathAndOutlineInsideRegion:true,baselineStepBudget:80,globalInitialAttempts:240,globalRefinements:"up to 6 parents x 16 checks; actual count recorded",codeHashes},summary,cases:rows},null,2));
  console.log(JSON.stringify(summary));
},1800000);
