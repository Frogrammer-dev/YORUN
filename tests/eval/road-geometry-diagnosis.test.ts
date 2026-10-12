import { readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { placeShape, type RouteCandidate } from "@/lib/route/fit";
import { pointSegDist, project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { polylineLength, resample, SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

it.skipIf(!process.env.ROAD_GEOMETRY_DIAGNOSIS)("separates fixed-placement road availability from route selection error",()=>{
  const folder="eval/recognition/route-improvement";
  const frozen=JSON.parse(readFileSync(`${folder}/frozen-baseline.json`,"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>}};
  const input=process.env.ROAD_GEOMETRY_INPUT??`${folder}/combined-incumbent-v6/results.json`;
  const rows=JSON.parse(readFileSync(input,"utf8")) as Array<{caseId:string;candidate:RouteCandidate}>;
  const output=[];
  for(const area of frozen.protocol.areas){
    const g=graphFromOverpass(JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${area.id}-roads.json`,"utf8")),area.bbox,{detail:"simple",excludeSteps:true});
    for(const row of rows.filter(r=>r.caseId.startsWith(`${area.id}-`))){
      const c=row.candidate,shape=SHAPE_BY_ID[c.shapeId as ShapeId];
      const outline=placeShape(shape.points,c.placement);
      const samples=resample(outline,Math.max(8,Math.round(polylineLength(outline)/12)));
      const path=c.latlngs.map(([lat,lon])=>project(g.origin,lat,lon));
      const selected=samples.map(([x,y])=>Math.min(...path.slice(1).map((b,i)=>pointSegDist(x,y,...path[i],...b))));
      const available=samples.map(([x,y])=>g.edgeIndex.distance(x,y,1000));
      const mean=(values:number[])=>values.reduce((a,b)=>a+b,0)/values.length;
      output.push({caseId:row.caseId,similarity:c.similarity,templateToSelectedRoadMeanMeters:mean(selected),templateToAnyRoadMeanMeters:mean(available),selectionGapMeters:mean(selected)-mean(available),zigzagPerKm:c.zigzagPerKm,scale:c.placement.scale});
    }
  }
  writeFileSync(`${folder}/geometry-diagnosis.json`,JSON.stringify({input,note:"Fixed placements only; nearest independent roads need not form a valid closed route. Not an achievable score or a global upper bound.",cases:output},null,2));
  console.log(JSON.stringify(output));
});
