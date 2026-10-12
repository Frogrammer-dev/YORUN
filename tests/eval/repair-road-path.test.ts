import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { evaluatePath, toCandidate, type RouteCandidate } from "@/lib/route/fit";
import { hasEdge, project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { repairRoadPath } from "@/lib/route/repairRoadPath";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

it.skipIf(!process.env.REPAIR_ROAD_PILOT)("repairs local road bends without changing templates or scoring",()=>{
  const sourceDir=path.resolve("eval/recognition/llm-routes-20261010"),input=path.resolve(process.env.REPAIR_ROAD_INPUT??"eval/recognition/route-improvement/combined-initial/results.json");
  const out=path.resolve(process.env.REPAIR_ROAD_OUTPUT??"eval/recognition/route-improvement/repair");mkdirSync(out,{recursive:true});
  const rowsInput=JSON.parse(readFileSync(input,"utf8")) as Array<{caseId:string;candidate:RouteCandidate}>;
  const areas=(JSON.parse(readFileSync(path.join(sourceDir,"round2-results.json"),"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const results=[];
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
  const codeHashes=Object.fromEntries(["src/lib/route/repairRoadPath.ts","src/lib/route/refinePlacement.ts","src/lib/route/fit.ts","src/lib/route/graph.ts","src/lib/route/shapes.ts"].map(f=>[f,hash(readFileSync(f,"utf8"))]));
  for(const row of rowsInput) {
    const area=areas.find(a=>row.caseId.startsWith(`${a.id}-`))!;
    const source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),"utf8"),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{detail:"simple",excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    const c=row.candidate,shape=SHAPE_BY_ID[c.shapeId as ShapeId],nodes=c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
    expect(nodes.every((v,i)=>v>=0&&(i===0||hasEdge(g,nodes[i-1],v)))).toBe(true);
    const before=evaluatePath(g,shape,c.placement,nodes,3000,8000);
    const cacheKey=hash(JSON.stringify({source:hash(source),c,codeHashes,maxCandidates:600})),file=path.join(out,`${row.caseId}.json`);
    let result;
    if(existsSync(file)&&JSON.parse(readFileSync(file,"utf8")).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,"utf8"));
    else {
      const repaired=repairRoadPath(g,shape,c.placement,nodes,region,3000,8000,600);expect(repaired).not.toBeNull();
      const candidate=toCandidate(g,shape,repaired!.evaluated.fit??c.placement,repaired!.evaluated);
      expect(candidate.similarity).toBeGreaterThanOrEqual(before.similarity);
      result={caseId:row.caseId,cacheKey,dataSha256:hash(source),dataTimestamp:json.osm3s?.timestamp_osm_base,before:before.similarity,after:candidate.similarity,attempts:repaired!.attempts,evaluatedCandidates:repaired!.evaluatedCandidates,acceptedRepairs:repaired!.acceptedRepairs,refitEvaluations:repaired!.refitEvaluations,candidate};
      writeFileSync(file,JSON.stringify(result,null,2));
    }
    results.push(result);
    console.log(JSON.stringify({caseId:row.caseId,before:result.before,after:result.after,accepted:result.acceptedRepairs}));
  }
  expect(results).toHaveLength(12);
  const summary={beforeAverage:results.reduce((s,r)=>s+r.before,0)/12,afterAverage:results.reduce((s,r)=>s+r.after,0)/12};
  writeFileSync(path.join(out,"results.json"),JSON.stringify({protocol:{input,codeHashes,graphDetail:"simple",minMeters:3000,maxMeters:8000,repeatMax:.2,objective:"negative log of original unrounded evaluatePath similarity",maxRoutingAttempts:600,windowsMeters:[60,120,240,400,600],maxRepairRounds:4,uniformRefit:true},summary,cases:results},null,2));
  console.log(JSON.stringify(summary));
},1800000);
