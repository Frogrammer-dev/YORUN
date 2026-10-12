import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { findRoutes, placeShape, routePlacement, toCandidate, type Placement, type RouteCandidate } from "@/lib/route/fit";
import { PathFinder, project, type RoadGraph } from "@/lib/route/graph";
import { graphFromOverpass } from "@/lib/route/osm";
import { readLocalRoads } from "@/lib/route/roadData.server";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

const AREAS = [
  { id: "gwangalli", name: "광안리", bbox: { south:35.143,west:129.1,north:35.166,east:129.128 } },
  { id: "seomyeon", name: "서면", bbox: { south:35.145,west:129.048,north:35.17,east:129.076 } },
  { id: "gangnam", name: "강남", bbox: { south:37.49,west:127.02,north:37.515,east:127.051 } },
];
const IDS: ShapeId[] = ["square","heart","star","cat"];
const out = path.resolve("eval/recognition/llm-routes-20261010");
type Proposal = { caseId: string; seeds: Array<{ x:number; y:number; scale:number; rotation:number; reason:string }> };
const write = (file:string,data:unknown) => writeFileSync(path.join(out,file),JSON.stringify(data,null,2));
const svgPath = (pts: readonly (readonly number[])[], transform:(x:number,y:number)=>number[]) => pts.map(([x,y],i)=>`${i ? "L":"M"}${transform(x,y).map(v=>v.toFixed(1)).join(",")}`).join(" ");

it.skipIf(!process.env.LLM_ROUTE_PILOT)("fixed real-road comparison of LLM-guided placements", () => {
  mkdirSync(out,{recursive:true});
  const proposalFile = process.env.LLM_ROUTE_PROPOSALS;
  const method = process.env.LLM_ROUTE_METHOD === "rigid" ? "rigid" : "flex";
  const proposals: Proposal[] = proposalFile ? JSON.parse(readFileSync(proposalFile,"utf8")) : [];
  const expectedCases=new Set(AREAS.flatMap(a=>IDS.map(id=>`${a.id}-${id}`)));
  if(proposalFile && (proposals.length!==expectedCases.size || new Set(proposals.map(p=>p.caseId)).size!==expectedCases.size || proposals.some(p=>!expectedCases.has(p.caseId)||!Array.isArray(p.seeds)||p.seeds.length<1||p.seeds.length>5))) throw new Error("The proposal file must cover all 12 fixed cases exactly once");
  const cases: unknown[] = [];
  for(const area of AREAS) {
    const sourceFile = path.join(out,`${area.id}-roads.json`);
    if(!existsSync(sourceFile)) write(`${area.id}-roads.json`,readLocalRoads(area.bbox));
    const source = readFileSync(sourceFile,"utf8");
    const g = graphFromOverpass(JSON.parse(source),area.bbox,{excludeSteps:true,detail:"simple"});
    const [minX,minY] = project(g.origin,area.bbox.south,area.bbox.west);
    const [maxX,maxY] = project(g.origin,area.bbox.north,area.bbox.east);
    const region = {minX,minY,maxX,maxY};
    const width=maxX-minX,height=maxY-minY;
    const tx = (x:number,y:number) => [60+(x-minX)/width*1000,60+(maxY-y)/height*1000];
    let roads="";
    for(let a=0;a<g.n;a++) for(let j=g.adjStart[a];j<g.adjStart[a+1];j++) {
      const b=g.adjTo[j]; if(a>=b)continue;
      roads+=svgPath([[g.x[a],g.y[a]],[g.x[b],g.y[b]]],tx);
    }
    const grid=Array.from({length:11},(_,i)=>`<path d="M${60+i*100},60V1060 M60,${60+i*100}H1060" stroke="#d9d9d9"/><text x="${60+i*100}" y="40">${i/10}</text><text x="20" y="${1060-i*100}">${i/10}</text>`).join("");
    const map=`<svg xmlns="http://www.w3.org/2000/svg" width="1120" height="1120"><rect width="1120" height="1120" fill="white"/><g font-size="18" fill="#555">${grid}</g><path d="${roads}" fill="none" stroke="#546477" stroke-width="1.4"/><text x="60" y="1100" font-size="18">${area.name} · width ${Math.round(width)}m · height ${Math.round(height)}m · y increases north</text></svg>`;
    writeFileSync(path.join(out,`${area.id}-map.svg`),map);
    for(const id of IDS) {
      const shape=SHAPE_BY_ID[id],caseId=`${area.id}-${id}`;
      let baseline: RouteCandidate | undefined;
      let baselineEvaluated=0;
      const cacheKey=createHash("sha256").update(source).update(readFileSync("src/lib/route/fit.ts")).update(readFileSync("src/lib/route/flex.ts")).update(readFileSync("src/lib/route/shapes.ts")).update(JSON.stringify({id,region,minMeters:3000,maxMeters:8000,steps:80,results:8})).digest("hex");
      const baselineFile=path.join(out,`${caseId}-baseline.json`);
      if(existsSync(baselineFile) && JSON.parse(readFileSync(baselineFile,"utf8")).cacheKey===cacheKey) {
        const saved=JSON.parse(readFileSync(baselineFile,"utf8")); baseline=saved.candidate ?? undefined; baselineEvaluated=saved.evaluated;
      } else {
        const result=findRoutes(g,{shapes:[id],region,minMeters:3000,maxMeters:8000,budget:new StepBudget(80),resultsPerShape:8});
        baselineEvaluated=result.evaluated;
        baseline=result.candidates.find(c=>valid(c,g,minX,minY,maxX,maxY));
        write(`${caseId}-baseline.json`,{candidate:baseline ?? null,evaluated:baselineEvaluated,cacheKey});
      }
      const seeds=proposals.find(p=>p.caseId===caseId)?.seeds ?? [];
      if(seeds.length>5)throw new Error("At most five LLM seeds per case");
      const finder=new PathFinder(g);
      let evaluated=0;
      const pool:Array<{candidate:RouteCandidate;seed:number;stage:string}>=[];
      const check=(p:Placement,seed:number,stage:string) => {
        if(!placeShape(shape.points,p).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY))return undefined;
        evaluated++;
        const e=routePlacement(g,finder,shape,p,3000,8000,true,method);
        if(!e)return undefined;
        const c=toCandidate(g,shape,e.fit ?? p,e);
        if(!valid(c,g,minX,minY,maxX,maxY))return undefined;
        pool.push({candidate:c,seed,stage});
        return c;
      };
      for(let i=0;i<seeds.length;i++) {
        const s=seeds[i];
        if(![s.x,s.y,s.scale,s.rotation].every(Number.isFinite)||s.x<0||s.x>1||s.y<0||s.y>1||s.scale<120||s.scale>Math.min(width,height)||Math.abs(s.rotation)>180)throw new Error("Invalid LLM seed");
        const initial={cx:minX+s.x*width,cy:minY+s.y*height,scale:s.scale,rotDeg:s.rotation};
        check(initial,i,"first-pass");
        // Fixed, bounded geometric refinement, identical for every seed. No model scoring.
        for(const [dx,dy,ds,dr] of [[-.04,0,1,0],[.04,0,1,0],[0,-.04,1,0],[0,.04,1,0],[0,0,.94,0],[0,0,1.06,0],[0,0,1,-6],[0,0,1,6],[-.03,-.03,1,0],[.03,.03,1,0]])
          check({cx:initial.cx+dx*initial.scale,cy:initial.cy+dy*initial.scale,scale:initial.scale*ds,rotDeg:initial.rotDeg+dr},i,"refined");
      }
      pool.sort((a,b)=>a.candidate.cost-b.candidate.cost);
      const llm=pool[0]?.candidate;
      const first=pool.filter(p=>p.stage==="first-pass").sort((a,b)=>a.candidate.cost-b.candidate.cost)[0]?.candidate;
      const row={caseId,area:area.name,shape:shape.name,dataSha256:createHash("sha256").update(source).digest("hex"),graphNodes:g.n,graphEdges:g.edgeCount,baseline:baseline ?? null,firstPass:first ?? null,llm:llm ?? null,baselineEvaluated,llmEvaluated:evaluated,proposals:seeds,attempts:pool.map(p=>({seed:p.seed,stage:p.stage,similarity:p.candidate.similarity,length:p.candidate.lengthMeters,cost:p.candidate.cost}))};
      cases.push(row);
      console.log(JSON.stringify({caseId,baseline:baseline?.similarity ?? null,first:first?.similarity ?? null,llm:llm?.similarity ?? null,baselineEvaluated,llmEvaluated:evaluated}));
      if(llm || baseline) {
        const panel=(c:RouteCandidate|undefined,x:number,label:string)=>`<g transform="translate(${x},0)"><rect width="1120" height="1120" fill="white"/><text x="30" y="30" font-size="24">${label} · ${c?.similarity ?? "실패"}</text><path d="${roads}" fill="none" stroke="#e1e5e9" stroke-width="1"/>${c ? `<path d="${svgPath(c.outline.map(([la,lo])=>project(g.origin,la,lo)),tx)}" fill="none" stroke="#e28837" stroke-dasharray="8 8" stroke-width="4"/><path d="${svgPath(c.latlngs.map(([la,lo])=>project(g.origin,la,lo)),tx)}" fill="none" stroke="#0989ba" stroke-width="5"/>` : ""}</g>`;
        writeFileSync(path.join(out,`${caseId}-comparison.svg`),`<svg xmlns="http://www.w3.org/2000/svg" width="2240" height="1120">${panel(baseline,0,"기존")}${panel(llm,1120,"LLM + 길 연결")}</svg>`);
      }
    }
  }
  write(proposalFile ? `${path.basename(proposalFile,".json")}${method==="rigid" ? "-rigid" : ""}-results.json` : "baseline-results.json",{protocol:{target:80,minMeters:3000,maxMeters:8000,shapes:IDS,areas:AREAS,graphDetail:"simple",baselineStepBudget:80,llmMaxSeeds:5,refinementsPerSeed:10,method,ranking:"unchanged cost; failures count as zero",model:"Codex session LLM; manually authored proposals, not autonomous API execution"},cases});
},600000);

function valid(c:RouteCandidate,g:RoadGraph,minX:number,minY:number,maxX:number,maxY:number) {
  if(c.lengthMeters<3000||c.lengthMeters>8000||c.repeatRatio>.2)return false;
  if(c.latlngs.length<4)return false;
  const first=c.latlngs[0],last=c.latlngs.at(-1)!;
  if(first[0]!==last[0]||first[1]!==last[1])return false;
  return c.latlngs.every(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return x>=minX-1&&x<=maxX+1&&y>=minY-1&&y<=maxY+1;});
}
