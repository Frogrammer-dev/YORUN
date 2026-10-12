import {it} from "vitest";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {graphFromOverpass} from "@/lib/route/osm";
import {project} from "@/lib/route/graph";
import {SHAPE_BY_ID,type ShapeId} from "@/lib/route/shapes";
import {globalSearch} from "@/lib/route/globalSearch";
import {FLEX} from "@/lib/route/flex";
it.skipIf(!process.env.GLOBAL_SEARCH)("global diversified real-road search",()=>{
 if(process.env.GLOBAL_CORNERS)FLEX.cornersOnly=process.env.GLOBAL_CORNERS==="1";
 if(process.env.GLOBAL_KEYPOINTS)FLEX.keypointCount=Number(process.env.GLOBAL_KEYPOINTS);
 const areas=[{id:"gwangalli",bbox:{south:35.143,west:129.1,north:35.166,east:129.128}},{id:"seomyeon",bbox:{south:35.145,west:129.048,north:35.17,east:129.076}},{id:"gangnam",bbox:{south:37.49,west:127.02,north:37.515,east:127.051}}];
 const folder=`eval/recognition/route-improvement/${process.env.GLOBAL_LABEL??"global"}`;mkdirSync(folder,{recursive:true});const rows:unknown[]=[];
 for(const a of areas){const source=readFileSync(`eval/recognition/llm-routes-20261010/${a.id}-roads.json`,"utf8"),g=graphFromOverpass(JSON.parse(source),a.bbox,{excludeSteps:true,detail:"simple"});const [minX,minY]=project(g.origin,a.bbox.south,a.bbox.west),[maxX,maxY]=project(g.origin,a.bbox.north,a.bbox.east);
 for(const id of ["square","heart","star","cat"] as ShapeId[]){const caseId=`${a.id}-${id}`;if(process.env.GLOBAL_CASE&&!caseId.includes(process.env.GLOBAL_CASE))continue;
 const baselineText=readFileSync(`eval/recognition/llm-routes-20261010/${caseId}-baseline.json`,"utf8"),started=Date.now();const result=globalSearch(g,SHAPE_BY_ID[id],{minX,minY,maxX,maxY},Number(process.env.GLOBAL_ATTEMPTS??240),process.env.GLOBAL_FULL_ROTATION==="1",process.env.GLOBAL_SIMILARITY_RANK==="1");const row={caseId,searchOptions:{attempts:Number(process.env.GLOBAL_ATTEMPTS??240),fullRotation:process.env.GLOBAL_FULL_ROTATION==="1",rankBySimilarity:process.env.GLOBAL_SIMILARITY_RANK==="1",keypointCount:FLEX.keypointCount,cornersOnly:FLEX.cornersOnly},searchCodeSha256:createHash("sha256").update(readFileSync("src/lib/route/globalSearch.ts")).digest("hex"),dataSha256:createHash("sha256").update(source).digest("hex"),baselineSha256:createHash("sha256").update(baselineText).digest("hex"),baseline:JSON.parse(baselineText).candidate?.similarity??0,...result,elapsedMs:Date.now()-started};rows.push(row);writeFileSync(`${folder}/${caseId}.json`,JSON.stringify(row,null,2));console.log(JSON.stringify({caseId,baseline:row.baseline,similarity:result.candidate?.similarity??0,evaluated:result.evaluated,ms:row.elapsedMs}));
 }}writeFileSync(`${folder}/results.json`,JSON.stringify(rows,null,2));
},3600000);
