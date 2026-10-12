import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { FLEX } from "@/lib/route/flex";
import { PathFinder, project, hasEdge } from "@/lib/route/graph";
import { placeShape, routePlacement, toCandidate, type RouteCandidate } from "@/lib/route/fit";
import { graphFromOverpass } from "@/lib/route/osm";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

it.skipIf(!process.env.ANCHOR_ABLATION)("anchor density and corner preservation on all fixed cases",()=>{
  const baseline=JSON.parse(readFileSync("eval/recognition/route-improvement/frozen-baseline.json","utf8"));
  const original={...FLEX};
  const variants=[
    {id:"sparse8",settings:{keypointCount:8}},
    {id:"sparse12",settings:{keypointCount:12}},
    {id:"dense20",settings:{keypointCount:20}},
    {id:"dense24",settings:{keypointCount:24}},
    {id:"corners",settings:{cornersOnly:true}},
    {id:"corners-guide",settings:{cornersOnly:true,guideWeight:1.2}},
    {id:"dense-guide",settings:{keypointCount:24,guideWeight:1.2,turnCost:140}},
    {id:"sparse-smooth",settings:{keypointCount:8,guideWeight:.4,turnCost:160}},
    {id:"wide-corners",settings:{cornersOnly:true,radius:.15,candidates:8}},
  ];
  const folder="eval/recognition/route-improvement/anchors";mkdirSync(folder,{recursive:true});
  const rows:unknown[]=[];
  try {
    for(const area of baseline.protocol.areas) {
      const source=readFileSync(`eval/recognition/llm-routes-20261010/${area.id}-roads.json`,"utf8");
      const g=graphFromOverpass(JSON.parse(source),area.bbox,{excludeSteps:true,detail:"simple"});
      const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
      const finder=new PathFinder(g);
      for(const id of baseline.protocol.shapes as ShapeId[]) {
        const caseId=`${area.id}-${id}`;
        const old=baseline.cases.find((c:{caseId:string})=>c.caseId===caseId).baseline as RouteCandidate;
        const global=JSON.parse(readFileSync(`eval/recognition/route-improvement/global/${caseId}.json`,"utf8"));
        const parents=[old,...global.pool as RouteCandidate[]];
        const shape=SHAPE_BY_ID[id];
        const tested:unknown[]=[];
        let best=old;
        for(const variant of variants) {
          Object.assign(FLEX,original,variant.settings);
          let candidate:RouteCandidate|undefined;
          for(const parent of parents) {
            const p=parent.placement;
            if(!placeShape(shape.points,p).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY))continue;
            const e=routePlacement(g,finder,shape,p,3000,8000,true);
            if(!e||e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)continue;
            if(!e.path.every(n=>g.x[n]>=minX-1&&g.x[n]<=maxX+1&&g.y[n]>=minY-1&&g.y[n]<=maxY+1))continue;
            if(!e.path.every((n,i)=>i===0||hasEdge(g,e.path[i-1],n)))throw new Error("Disconnected route");
            const c=toCandidate(g,shape,e.fit??p,e);
            if(!candidate||c.cost<candidate.cost)candidate=c;
          }
          tested.push({variant:variant.id,settings:variant.settings,candidate:candidate??null});
          if(candidate&&candidate.cost<best.cost)best=candidate;
        }
        const row={caseId,baseline:old.similarity,global:global.candidate?.similarity??0,candidate:best,variants:tested};
        rows.push(row);writeFileSync(`${folder}/${caseId}.json`,JSON.stringify(row,null,2));
        console.log(JSON.stringify({caseId,baseline:old.similarity,best:best.similarity}));
      }
    }
  } finally {Object.assign(FLEX,original);}
  writeFileSync(`${folder}/results.json`,JSON.stringify(rows,null,2));
},600000);
