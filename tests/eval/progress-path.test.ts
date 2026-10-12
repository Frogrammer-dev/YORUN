import {it} from "vitest";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {graphFromOverpass} from "@/lib/route/osm";
import {hasEdge,project} from "@/lib/route/graph";
import {evaluatePath,toCandidate,type RouteCandidate} from "@/lib/route/fit";
import {SHAPE_BY_ID,type ShapeId} from "@/lib/route/shapes";
import {progressPath} from "@/lib/route/progressPath";
it.skipIf(!process.env.PROGRESS_PATH)("whole-loop contour progress state on fixed real roads",()=>{
 const baseline=JSON.parse(readFileSync("eval/recognition/route-improvement/frozen-baseline.json","utf8"));const folder=`eval/recognition/route-improvement/${process.env.PROGRESS_LABEL??"progress"}`;mkdirSync(folder,{recursive:true});const rows:unknown[]=[];
 for(const a of baseline.protocol.areas){const g=graphFromOverpass(JSON.parse(readFileSync(`eval/recognition/llm-routes-20261010/${a.id}-roads.json`,"utf8")),a.bbox,{excludeSteps:true,detail:"simple"});const [minX,minY]=project(g.origin,a.bbox.south,a.bbox.west),[maxX,maxY]=project(g.origin,a.bbox.north,a.bbox.east),region={minX,minY,maxX,maxY};
 for(const id of baseline.protocol.shapes as ShapeId[]){const caseId=`${a.id}-${id}`;if(process.env.PROGRESS_CASE&&!caseId.includes(process.env.PROGRESS_CASE))continue;
 const old=baseline.cases.find((c:{caseId:string})=>c.caseId===caseId).baseline as RouteCandidate,global=JSON.parse(readFileSync(`eval/recognition/route-improvement/global/${caseId}.json`,"utf8")),parents=[old,...global.pool as RouteCandidate[]],shape=SHAPE_BY_ID[id],pool:RouteCandidate[]=[];let attempted=0,connected=0;const start=Date.now();
 for(const parent of parents)for(const [bins,guide,turn] of [[32,3,40],[32,6,80],[48,3,40],[48,6,100]]){attempted++;const p=parent.placement,path=progressPath(g,shape,p,region,bins,guide,turn,process.env.PROGRESS_LOCAL==="1");if(!path)continue;connected++;
 if(path[0]!==path.at(-1)||!path.every((n,i)=>i===0||hasEdge(g,path[i-1],n)))throw new Error("Disconnected progress route");
 const e=evaluatePath(g,shape,p,path,3000,8000);if(e.lengthMeters<3000||e.lengthMeters>8000||e.repeatRatio>.2)continue;pool.push(toCandidate(g,shape,p,e));}
 pool.sort((a,b)=>a.cost-b.cost);const row={caseId,baseline:old.similarity,candidate:pool[0]??null,pool:pool.slice(0,8),attempted,connected,ms:Date.now()-start};rows.push(row);writeFileSync(`${folder}/${caseId}.json`,JSON.stringify(row,null,2));console.log(JSON.stringify({caseId,baseline:old.similarity,similarity:row.candidate?.similarity??0,attempted,connected,ms:row.ms}));
 }}writeFileSync(`${folder}/results.json`,JSON.stringify(rows,null,2));
},3600000);
