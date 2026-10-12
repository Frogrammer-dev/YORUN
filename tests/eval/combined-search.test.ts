import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { project, hasEdge, type RoadGraph } from "@/lib/route/graph";
import { evaluatePath, placeShape, toCandidate, type RouteCandidate, type Evaluated, type Placement } from "@/lib/route/fit";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";
import { refinePathPlacement } from "@/lib/route/refinePlacement";

it.skipIf(!process.env.COMBINED_SEARCH)("combine valid routes and refine unchanged silhouettes",()=>{
  const frozen=JSON.parse(readFileSync("eval/recognition/route-improvement/frozen-baseline.json","utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>;shapes:ShapeId[]};cases:Array<{caseId:string;baseline:RouteCandidate}>};
  const folder=`eval/recognition/route-improvement/combined-${process.env.COMBINED_LABEL || "initial"}`;
  mkdirSync(folder,{recursive:true});
  const rows:unknown[]=[];
  const hashFile=(file:string)=>createHash("sha256").update(readFileSync(file)).digest("hex");
  const protocol={cases:12,graphDetail:"simple",minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,closed:true,actualEdgesOnly:true,pathAndTemplateInsideRegion:true,score:"unchanged evaluatePath",rotation:"uniform rotations may exceed 45 degrees",method:"union of saved experimental candidate pools plus uniform placement refit; not a single live algorithm",frozenBaselineSha256:hashFile("eval/recognition/route-improvement/frozen-baseline.json"),dataSha256:Object.fromEntries(frozen.protocol.areas.map(a=>[a.id,hashFile(`eval/recognition/llm-routes-20261010/${a.id}-roads.json`)])),codeSha256:Object.fromEntries(["src/lib/route/fit.ts","src/lib/route/shapes.ts","src/lib/route/refinePlacement.ts","tests/eval/combined-search.test.ts"].map(f=>[f,hashFile(f)]))};
  if(process.env.COMBINED_NO_REFIT)protocol.method="strict union of saved experimental candidate pools, preserving each path start and placement without additional refit; not a single live algorithm";
  writeFileSync(`${folder}/protocol.json`,JSON.stringify(protocol,null,2));
  for(const area of frozen.protocol.areas) {
    const g=graphFromOverpass(JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${area.id}-roads.json`,"utf8")),area.bbox,{excludeSteps:true,detail:"simple"});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
    const region={minX,minY,maxX,maxY};
    for(const id of frozen.protocol.shapes) {
      const caseId=`${area.id}-${id}`,shape=SHAPE_BY_ID[id];
      const old=frozen.cases.find(c=>c.caseId===caseId)!.baseline;
      const pool:Array<{candidate:RouteCandidate;method:string}>=[{candidate:old,method:"frozen-baseline"}];
      for(const variant of ["global","global-1200","global-rotation360","progress-local","global-similarity","global-dense-similarity","global-exact-similarity"]) {
        const file=`eval/recognition/route-improvement/${variant}/${caseId}.json`;
        if(!existsSync(file))continue;
        const result=JSON.parse(readFileSync(file,"utf8")) as {candidate:RouteCandidate|null;pool:RouteCandidate[]};
        for(const candidate of result.pool??[])pool.push({candidate,method:variant});
        if(result.candidate)pool.push({candidate:result.candidate,method:variant});
      }
      const anchorFile=`eval/recognition/route-improvement/anchors/${caseId}.json`;
      if(existsSync(anchorFile)) {
        const result=JSON.parse(readFileSync(anchorFile,"utf8")) as {variants:Array<{variant:string;candidate:RouteCandidate|null}>};
        for(const v of result.variants)if(v.candidate)pool.push({candidate:v.candidate,method:`anchors-${v.variant}`});
      }
      for(const variant of ["loops/refined-results", "loops/face-refined-results", "path/results", "repair/results", "repair-loops-v2/results", "loops-multiseed/results", "loops-beam/results", "loops-beam-refit/results", "combined-rank-v4/results", "combined-pool-v5/results", "combined-incumbent-v6/results", "large-segment/results", "combined-long-v7/results", "ordered-contour/results", "cut-loops/results", "ordered-multiseed/results", "combined-ordered-v8/results", "combined-exact-v9/results", "ordered-multiseed-coarse/results", "ordered-turn-ablation/results", "combined-turn-v10/results", "ordered-normalized/results", "multi-label-contour/results", "anneal-loops-phase0/results"]) {
        const file=`eval/recognition/route-improvement/${variant}.json`;
        if(!existsSync(file))continue;
        const data=JSON.parse(readFileSync(file,"utf8"));
        const list=(Array.isArray(data) ? data : data.cases ?? data.rows ?? data.results ?? []) as Array<{caseId:string;candidate?:RouteCandidate;best?:RouteCandidate;pool?:RouteCandidate[]}>;
        const row=list.find(r=>r.caseId===caseId);
        if(row?.candidate)pool.push({candidate:row.candidate,method:variant});
        if(row?.best && typeof row.best === "object" && Array.isArray(row.best.latlngs))pool.push({candidate:row.best,method:variant});
        for(const candidate of row?.pool??[])pool.push({candidate,method:variant});
      }
      const controlledFile=`eval/recognition/route-improvement/controlled-area/narrow-${caseId}.json`;
      if(existsSync(controlledFile)) {
        const result=JSON.parse(readFileSync(controlledFile,"utf8"));
        if(result.label!=="narrow"||result.caseId!==caseId)throw new Error("Invalid narrow-area source");
        if(result.candidate)pool.push({candidate:result.candidate,method:"controlled-narrow"});
        for(const candidate of result.pool??[])pool.push({candidate,method:"controlled-narrow"});
      }
      const unique=new Map<string,{candidate:RouteCandidate;method:string}>();
      const qualities=new WeakMap<RouteCandidate,number>();
      const objective=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
      const quality=(c:RouteCandidate)=>qualities.get(c)!;
      pool.forEach(p=>{
        if (!p.candidate || !Array.isArray(p.candidate.latlngs)) return false;
        const nodes=pathNodes(g,p.candidate); if(!nodes)return false;
        const inside=(x:number,y:number)=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY;
        if(nodes.some(v=>!inside(g.x[v],g.y[v])) || !placeShape(shape.points,p.candidate.placement).every(([x,y])=>inside(x,y)))return false;
        const e=evaluatePath(g,shape,p.candidate.placement,nodes,3000,8000);
        if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)return false;
        p.candidate=toCandidate(g,shape,p.candidate.placement,e);
        qualities.set(p.candidate,objective(e,p.candidate.placement));
        const key=JSON.stringify(p.candidate.latlngs), previous=unique.get(key);
        if(!previous||quality(p.candidate)<quality(previous.candidate))unique.set(key,p);
      });
      const parents=[...unique.values()].sort((a,b)=>quality(a.candidate)-quality(b.candidate));
      if(!parents.length)throw new Error(`No valid candidates: ${caseId}`);
      let best=parents[0];
      const changes:unknown[]=[];
      for(const parent of parents.slice(0,process.env.COMBINED_NO_REFIT ? 0 : 8)) {
        const nodes=pathNodes(g,parent.candidate);
        if(!nodes)continue;
        const refined=refinePathPlacement(g,shape,parent.candidate.placement,nodes,region,3000,8000,160);
        if(!refined)continue;
        const candidate=toCandidate(g,shape,refined.placement,refined.evaluated);
        qualities.set(candidate,objective(refined.evaluated,refined.placement));
        changes.push({method:parent.method,before:parent.candidate.similarity,after:candidate.similarity,evaluations:refined.evaluations});
        if(quality(candidate)<quality(best.candidate))best={candidate,method:`${parent.method}+refit`};
      }
      const row={caseId,baseline:old.similarity,candidate:best.candidate,unroundedSimilarity:100*Math.exp(-quality(best.candidate)),method:best.method,changes,candidates:parents.length};
      rows.push(row);writeFileSync(`${folder}/${caseId}.json`,JSON.stringify(row,null,2));
      console.log(JSON.stringify({caseId,before:old.similarity,after:best.candidate.similarity,method:best.method}));
    }
  }
  writeFileSync(`${folder}/results.json`,JSON.stringify(rows,null,2));
},600000);

function pathNodes(g:RoadGraph,c:RouteCandidate) {
  const nodes=c.latlngs.map(([lat,lon])=>g.nodeIndex.nearest(...project(g.origin,lat,lon),.5));
  if(nodes.some(n=>n<0)||nodes[0]!==nodes.at(-1)||nodes.some((n,i)=>i>0&&!hasEdge(g,nodes[i-1],n)))return null;
  return nodes;
}
