import { rdpIndices } from "@/lib/art/rdp";
import { evaluatePath, placeShape, type Evaluated, type Placement, type Region } from "./fit";
import { hasEdge, PathFinder, pointSegDist, type RoadGraph } from "./graph";
import { refinePathPlacement } from "./refinePlacement";
import type { ShapeDef } from "./shapes";

/** Reconnect local bends using existing road edges; never insert synthetic lines. */
export function repairRoadPath(g:RoadGraph,shape:ShapeDef,placement:Placement,input:number[],region:Region,minMeters=3000,maxMeters=8000,maxCandidates=600) {
  const inside=(v:number)=>g.x[v]>=region.minX&&g.x[v]<=region.maxX&&g.y[v]>=region.minY&&g.y[v]<=region.maxY;
  const outline=placeShape(shape.points,placement);
  if(!outline.every(([x,y])=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY))return null;
  const valid=(nodes:number[])=>nodes.length>=4&&nodes[0]===nodes.at(-1)&&nodes.every((v,i)=>inside(v)&&(i===0||hasEdge(g,nodes[i-1],v)));
  if(!valid(input))return null;
  const objective=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
  let best=evaluatePath(g,shape,placement,input,minMeters,maxMeters);
  if(best.lengthMeters<minMeters||best.lengthMeters>maxMeters||best.repeatRatio>.2)return null;
  let score=objective(best,placement),attempts=0,evaluated=0,accepted=0;
  const finder=new PathFinder(g),tried=new Set<string>();
  const distance=(v:number)=>Math.min(...outline.slice(1).map((b,i)=>pointSegDist(g.x[v],g.y[v],outline[i][0],outline[i][1],b[0],b[1])));
  for(let round=0;round<4&&attempts<maxCandidates;round++) {
    const loop=best.path.slice(0,-1),offset=Math.floor(loop.length*(round%2?.25:.5));
    const rotated=[...loop.slice(offset),...loop.slice(0,offset)];rotated.push(rotated[0]);
    const xy=rotated.map(v=>[g.x[v],g.y[v]] as [number,number]);
    const keep=rdpIndices(xy,10),cum=new Float64Array(rotated.length);
    for(let i=1;i<rotated.length;i++)cum[i]=cum[i-1]+Math.hypot(xy[i][0]-xy[i-1][0],xy[i][1]-xy[i-1][1]);
    const corners=keep.slice(1,-1).filter((i,k)=>{
      const a=xy[keep[k]],b=xy[i],c=xy[keep[k+2]];
      const dot=(b[0]-a[0])*(c[0]-b[0])+(b[1]-a[1])*(c[1]-b[1]);
      const norm=Math.hypot(b[0]-a[0],b[1]-a[1])*Math.hypot(c[0]-b[0],c[1]-b[1]);
      return norm>0&&dot/norm<Math.SQRT1_2;
    }).sort((a,b)=>distance(rotated[b])-distance(rotated[a])).slice(0,30);
    let improved:Evaluated|null=null,newScore=score;
    for(const center of corners)for(const window of [60,120,240,400,600]) {
      let left=center,right=center;
      while(left>0&&cum[center]-cum[left]<window/2)left--;
      while(right<rotated.length-1&&cum[right]-cum[center]<window/2)right++;
      if(left===right||right-left<2||cum[right]-cum[left]>best.lengthMeters*.4)continue;
      const a=rotated[left],b=rotated[right];
      for(const [turnCost,guideWeight] of [[0,0],[80,0],[240,0],[80,1.5]]) {
        if(attempts>=maxCandidates)break;
        const key=`${a}:${b}:${turnCost}:${guideWeight}`;if(tried.has(key))continue;tried.add(key);attempts++;
        const guide=guideWeight?{ax:g.x[a],ay:g.y[a],bx:g.x[b],by:g.y[b],tol:Math.max(30,placement.scale*.05),weight:guideWeight}:undefined;
        const segment=finder.route(a,b,guide,10000,turnCost,left>0?rotated[left-1]:-1);
        if(!segment)continue;
        const nodes=[...rotated.slice(0,left),...segment,...rotated.slice(right+1)];
        if(!valid(nodes))continue;
        if(nodes.length===rotated.length&&nodes.every((v,i)=>v===rotated[i]))continue;
        evaluated++;
        const candidate=evaluatePath(g,shape,placement,nodes,minMeters,maxMeters);
        if(candidate.lengthMeters<minMeters||candidate.lengthMeters>maxMeters||candidate.repeatRatio>.2)continue;
        const value=objective(candidate,placement);
        if(value<newScore-1e-7){improved=candidate;newScore=value;}
      }
    }
    if(improved){best=improved;score=newScore;accepted++;}
  }
  const refit=refinePathPlacement(g,shape,placement,best.path,region,minMeters,maxMeters,120);
  const result=refit&&objective(refit.evaluated,refit.placement)<score?refit.evaluated:{...best,fit:placement};
  return {evaluated:result,attempts,evaluatedCandidates:evaluated,acceptedRepairs:accepted,refitEvaluations:refit?.evaluations??0};
}
