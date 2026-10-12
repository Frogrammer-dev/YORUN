import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { evaluatePath, toCandidate, type RouteCandidate } from "@/lib/route/fit";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { refinePathPlacement } from "@/lib/route/refinePlacement";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

it.skipIf(!process.env.REFIT_ROUTE_PILOT)("refits the unchanged 12 baseline road paths", () => {
  const input = path.resolve("eval/recognition/llm-routes-20261010");
  const out = path.resolve("eval/recognition/route-improvement/refit");
  mkdirSync(out,{recursive:true});
  const baseline = JSON.parse(readFileSync(path.join(input,"round2-results.json"),"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>};cases:Array<{caseId:string;baseline:RouteCandidate}>};
  const rows = [];
  for (const area of baseline.protocol.areas) {
    const source = readFileSync(path.join(input,`${area.id}-roads.json`),"utf8");
    const g = graphFromOverpass(JSON.parse(source),area.bbox,{excludeSteps:true,detail:"simple"});
    const [minX,minY] = project(g.origin,area.bbox.south,area.bbox.west);
    const [maxX,maxY] = project(g.origin,area.bbox.north,area.bbox.east);
    const region = {minX,minY,maxX,maxY};
    for (const row of baseline.cases.filter(c => c.caseId.startsWith(`${area.id}-`))) {
      const c = row.baseline,shape = SHAPE_BY_ID[c.shapeId as ShapeId];
      const nodes = c.latlngs.map(([lat,lon]) => {const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
      expect(nodes.every(n=>n>=0)).toBe(true);
      for(let i=1;i<nodes.length;i++) expect(Array.from(g.adjTo.slice(g.adjStart[nodes[i-1]],g.adjStart[nodes[i-1]+1])).includes(nodes[i])).toBe(true);
      const before = evaluatePath(g,shape,c.placement,nodes,3000,8000);
      const refined = refinePathPlacement(g,shape,c.placement,nodes,region,3000,8000);
      expect(refined).not.toBeNull();
      expect(refined!.evaluated.path).toEqual(nodes);
      expect(refined!.evaluated.similarity).toBeGreaterThanOrEqual(before.similarity);
      const candidate = toCandidate(g,shape,refined!.placement,refined!.evaluated);
      rows.push({caseId:row.caseId,dataSha256:createHash("sha256").update(source).digest("hex"),before:before.similarity,after:candidate.similarity,evaluations:refined!.evaluations,candidate});
      console.log(`${row.caseId}: ${before.similarity} -> ${candidate.similarity}`);
    }
  }
  expect(rows).toHaveLength(12);
  const result = {protocol:{...baseline.protocol,method:"fixed path, uniform scale/rotation/translation only",ranking:"unchanged unrounded similarity; lower negative log is better",model:"none; geometric refinement of fixed baseline paths",objective:"negative log of unchanged unrounded evaluatePath similarity",limits:{translationFraction:.2,scaleFraction:.2,rotationDegrees:30,maxEvaluations:160}},beforeAverage:rows.reduce((s,r)=>s+r.before,0)/12,afterAverage:rows.reduce((s,r)=>s+r.after,0)/12,cases:rows};
  writeFileSync(path.join(out,"results.json"),JSON.stringify(result,null,2));
  console.log(JSON.stringify({before:result.beforeAverage,after:result.afterAverage}));
},600000);
