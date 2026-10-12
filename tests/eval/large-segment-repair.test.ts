import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { evaluatePath, placeShape, toCandidate, type RouteCandidate } from "@/lib/route/fit";
import { hasEdge, project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { largeSegmentRepair } from "@/lib/route/largeSegmentRepair";
import { resample, SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

it.skipIf(!process.env.LARGE_SEGMENT_PILOT)("repairs long inaccurate road portions without changing templates or scoring",()=>{
  const sourceDir=path.resolve("eval/recognition/llm-routes-20261010"),input=path.resolve(process.env.LARGE_SEGMENT_INPUT??"eval/recognition/route-improvement/combined-beam-v3/results.json");
  const out=path.resolve(process.env.LARGE_SEGMENT_OUTPUT??"eval/recognition/route-improvement/large-segment");mkdirSync(out,{recursive:true});
  const rowsInput=JSON.parse(readFileSync(input,"utf8")) as Array<{caseId:string;candidate:RouteCandidate}>;
  const areas=(JSON.parse(readFileSync(path.join(sourceDir,"round2-results.json"),"utf8")) as {protocol:{areas:Array<{id:string;bbox:BBox}>}}).protocol.areas;
  const results=[];
  const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
  const codeHashes=Object.fromEntries(["src/lib/route/largeSegmentRepair.ts","src/lib/route/refinePlacement.ts","src/lib/route/fit.ts","src/lib/route/graph.ts","src/lib/route/shapes.ts"].map(f=>[f,hash(readFileSync(f,"utf8"))]));
  for(const row of rowsInput) {
    const area=areas.find(a=>row.caseId.startsWith(`${a.id}-`))!;
    const source=readFileSync(path.join(sourceDir,`${area.id}-roads.json`),"utf8"),json=JSON.parse(source),g=graphFromOverpass(json,area.bbox,{detail:"simple",excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    const c=row.candidate,shape=SHAPE_BY_ID[c.shapeId as ShapeId],nodes=c.latlngs.map(([lat,lon])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
    expect(nodes.every((v,i)=>v>=0&&(i===0||hasEdge(g,nodes[i-1],v)))).toBe(true);
    const before=evaluatePath(g,shape,c.placement,nodes,3000,8000);
    const cacheKey=hash(JSON.stringify({source:hash(source),c,codeHashes,maxCandidates:144})),file=path.join(out,`${row.caseId}.json`);
    let result;
    if(existsSync(file)&&JSON.parse(readFileSync(file,"utf8")).cacheKey===cacheKey)result=JSON.parse(readFileSync(file,"utf8"));
    else {
      const repaired=largeSegmentRepair(g,shape,c.placement,nodes,region,144,18000);expect(repaired).not.toBeNull();
      const candidate=toCandidate(g,shape,repaired!.evaluated.fit??c.placement,repaired!.evaluated);
      expect(candidate.similarity).toBeGreaterThanOrEqual(before.similarity);
      result={caseId:row.caseId,cacheKey,dataSha256:hash(source),dataTimestamp:json.osm3s?.timestamp_osm_base,before:before.similarity,after:candidate.similarity,attempts:repaired!.attempts,evaluatedCandidates:repaired!.evaluatedCandidates,acceptedRepairs:repaired!.acceptedRepairs,expanded:repaired!.expanded,candidate};
      writeFileSync(file,JSON.stringify(result,null,2));
    }
    const finalNodes=result.candidate.latlngs.map(([lat,lon]:[number,number])=>{const [x,y]=project(g.origin,lat,lon);return g.nodeIndex.nearest(x,y,1);});
    expect(finalNodes[0]).toBe(finalNodes.at(-1));
    expect(finalNodes.every((v:number,i:number)=>v>=0&&(i===0||hasEdge(g,finalNodes[i-1],v))&&g.x[v]>=minX&&g.x[v]<=maxX&&g.y[v]>=minY&&g.y[v]<=maxY)).toBe(true);
    const finalScore=evaluatePath(g,shape,result.candidate.placement,finalNodes,3000,8000);
    expect(finalScore.lengthMeters).toBeGreaterThanOrEqual(3000);expect(finalScore.lengthMeters).toBeLessThanOrEqual(8000);expect(finalScore.repeatRatio).toBeLessThanOrEqual(.2);
    expect(finalScore.similarity).toBe(result.after);
    expect(placeShape(shape.points,result.candidate.placement).every(([x,y])=>x>=minX&&x<=maxX&&y>=minY&&y<=maxY)).toBe(true);
    const line=placeShape(resample(shape.points,64),c.placement),cum=new Float64Array(nodes.length);
    for(let i=1;i<nodes.length;i++)cum[i]=cum[i-1]+Math.hypot(g.x[nodes[i]]-g.x[nodes[i-1]],g.y[nodes[i]]-g.y[nodes[i-1]]);
    const nearest=(v:number)=>{let at=0,d=Infinity;for(let k=0;k<64;k++){const z=Math.hypot(g.x[v]-line[k][0],g.y[v]-line[k][1]);if(z<d){d=z;at=k;}}return at;};
    let arcWindows=0,arcLengthMismatch=0,arcMiddleMissing=0,arcZero=0;
    for(let center=1;center<nodes.length-1;center+=Math.max(1,Math.floor(nodes.length/30)))for(const width of [600,1000,1500]){
      let left=center,right=center;while(left>0&&cum[center]-cum[left]<width/2)left--;while(right<nodes.length-1&&cum[right]-cum[center]<width/2)right++;
      const length=cum[right]-cum[left];if(length<600||length>before.lengthMeters*.45)continue;
      const ia=nearest(nodes[left]),ib=nearest(nodes[right]),im=nearest(nodes[Math.floor((left+right)/2)]),positive=(ib-ia+64)%64,pm=(im-ia+64)%64,step=pm<=positive?1:-1;
      let at=ia,arcLength=0,middle=at===im;for(let k=0;k<64&&at!==ib;k++){const next=(at+step+64)%64;arcLength+=Math.hypot(line[next][0]-line[at][0],line[next][1]-line[at][1]);at=next;middle ||=at===im;}
      arcWindows++;if(!middle)arcMiddleMissing++;if(!arcLength)arcZero++;if(arcLength/length<.5||arcLength/length>1.5)arcLengthMismatch++;
    }
    result.arcDiagnostics={windows:arcWindows,lengthRatioOutsideHalfToOneAndHalf:arcLengthMismatch,middleMissing:arcMiddleMissing,zeroArc:arcZero};
    writeFileSync(file,JSON.stringify(result,null,2));
    results.push(result);
    console.log(JSON.stringify({caseId:row.caseId,before:result.before,after:result.after,accepted:result.acceptedRepairs}));
  }
  expect(results).toHaveLength(12);
  const summary={beforeAverage:results.reduce((s,r)=>s+r.before,0)/12,afterAverage:results.reduce((s,r)=>s+r.after,0)/12};
  writeFileSync(path.join(out,"results.json"),JSON.stringify({protocol:{input,codeHashes,graphDetail:"simple",minMeters:3000,maxMeters:8000,repeatMax:.2,objective:"negative log of original unrounded evaluatePath similarity",maxRoutingAttempts:144,windowsMeters:[600,1000,1500],maxRepairRounds:2,uniformRefit:true},summary,cases:results},null,2));
  console.log(JSON.stringify(summary));
},1800000);

