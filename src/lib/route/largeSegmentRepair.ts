import { evaluatePath, placeShape, type Evaluated, type Placement, type Region } from './fit';
import { hasEdge, pointSegDist, type RoadGraph } from './graph';
import { refinePathPlacement } from './refinePlacement';
import { resample, type ShapeDef } from './shapes';

const objective=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
type XY=[number,number];
const distance=(x:number,y:number,line:XY[])=>Math.min(...line.slice(1).map((b,i)=>pointSegDist(x,y,...line[i],...b)));

/** Replace long inaccurate portions with directed-edge road searches guided by the original contour. */
export function largeSegmentRepair(g:RoadGraph,shape:ShapeDef,initial:Placement,input:number[],region:Region,maxAttempts=144,maxExpanded=18000){
 const inside=(v:number)=>v>=0&&g.x[v]>=region.minX&&g.x[v]<=region.maxX&&g.y[v]>=region.minY&&g.y[v]<=region.maxY;
 const valid=(p:number[])=>p.length>=4&&p[0]===p.at(-1)&&p.every((v,i)=>inside(v)&&(!i||hasEdge(g,p[i-1],v)));
 if(!valid(input))return null;
 let placement=initial,best=evaluatePath(g,shape,placement,input,3000,8000),score=objective(best,placement),attempts=0,evaluated=0,accepted=0,expanded=0;
 const outlineInside=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY);
 if(!outlineInside(placement)||best.lengthMeters<3000||best.lengthMeters>8000||best.repeatRatio>.2)return null;
 const m=g.adjTo.length,from=new Int32Array(m);for(let v=0;v<g.n;v++)for(let e=g.adjStart[v];e<g.adjStart[v+1];e++)from[e]=v;
 for(let round=0;round<2&&attempts<maxAttempts;round++){
  const loop=best.path.slice(0,-1),offset=round?Math.floor(loop.length/2):0,nodes=[...loop.slice(offset),...loop.slice(0,offset)];nodes.push(nodes[0]);
  const outline=placeShape(resample(shape.points,64),placement),cum=new Float64Array(nodes.length);for(let i=1;i<nodes.length;i++)cum[i]=cum[i-1]+Math.hypot(g.x[nodes[i]]-g.x[nodes[i-1]],g.y[nodes[i]]-g.y[nodes[i-1]]);
  const windows:Array<{left:number;right:number;error:number}>=[];
  for(let center=1;center<nodes.length-1;center+=Math.max(1,Math.floor(nodes.length/30)))for(const width of [600,1000,1500]){
   let left=center,right=center;while(left>0&&cum[center]-cum[left]<width/2)left--;while(right<nodes.length-1&&cum[right]-cum[center]<width/2)right++;
   if(cum[right]-cum[left]<600||cum[right]-cum[left]>best.lengthMeters*.45)continue;
   const local=nodes.slice(left,right+1).map(v=>[g.x[v],g.y[v]] as XY);
   const forward=local.reduce((s,[x,y])=>s+distance(x,y,outline),0)/local.length;
   const near=outline.filter(([x,y])=>Math.hypot(x-g.x[nodes[center]],y-g.y[nodes[center]])<width*.7);
   const reverse=near.reduce((s,[x,y])=>s+distance(x,y,local),0)/Math.max(1,near.length);
   windows.push({left,right,error:(forward+reverse)/2});
  }
  const selected:typeof windows=[];for(const w of windows.sort((a,b)=>b.error-a.error)){if(selected.some(q=>Math.abs(cum[q.left]-cum[w.left])<150&&Math.abs(cum[q.right]-cum[w.right])<150))continue;selected.push(w);if(selected.length===12)break;}
  let next:Evaluated|null=null,nextPlacement=placement,nextScore=score;
  for(const {left,right} of selected){
   const a=nodes[left],b=nodes[right],mid=nodes[Math.floor((left+right)/2)];
   const nearest=(v:number)=>{let at=0,d=Infinity;for(let k=0;k<64;k++){const z=Math.hypot(g.x[v]-outline[k][0],g.y[v]-outline[k][1]);if(z<d){d=z;at=k;}}return at;};
   const ia=nearest(a),ib=nearest(b),im=nearest(mid),arc=(step:number)=>{const line:XY[]=[outline[ia]];let at=ia;for(let k=0;k<64&&at!==ib;k++){at=(at+step+64)%64;line.push(outline[at]);}return line;};
   const positive=arc(1),negative=arc(-1),guide=positive.some(p=>p===outline[im])?positive:negative;
   if(guide.length<2)continue;
   const dev=new Float64Array(g.n);for(let v=0;v<g.n;v++)dev[v]=distance(g.x[v],g.y[v],guide);
   const forbidden=new Set([...nodes.slice(0,left),...nodes.slice(right+1)]);forbidden.delete(a);forbidden.delete(b);
   const diversity=new Float32Array(m);
   for(const guideWeight of [1,3,8])for(let alternative=0;alternative<2&&attempts<maxAttempts;alternative++){
    attempts++;const costs=new Float64Array(m);costs.fill(Infinity);const prev=new Int32Array(m);prev.fill(-1);const heap:Array<[number,number]>=[];
    const push=(e:number,c:number)=>{let i=heap.length;heap.push([e,c]);while(i){const j=(i-1)>>1;if(heap[j][1]<=c)break;heap[i]=heap[j];i=j;}heap[i]=[e,c];};
    const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return top;};
    for(let e=g.adjStart[a];e<g.adjStart[a+1];e++){const v=g.adjTo[e];if(!inside(v)||forbidden.has(v))continue;costs[e]=g.adjLen[e]*(1+guideWeight*(dev[a]+dev[v])/Math.max(60,placement.scale*.08)+diversity[e]);push(e,costs[e]);}
    let goal=-1,count=0;
    while(heap.length&&count++<maxExpanded){const [edge,c]=pop();if(c!==costs[edge])continue;const u=from[edge],v=g.adjTo[edge];if(v===b){goal=edge;break;}
     for(let e=g.adjStart[v];e<g.adjStart[v+1];e++){const w=g.adjTo[e];if(w===u||w===a||!inside(w)||forbidden.has(w)||dev[w]>placement.scale*.3)continue;
      const dx=g.x[v]-g.x[u],dy=g.y[v]-g.y[u],ex=g.x[w]-g.x[v],ey=g.y[w]-g.y[v];const turn=Math.acos(Math.max(-1,Math.min(1,(dx*ex+dy*ey)/(Math.hypot(dx,dy)*Math.hypot(ex,ey)||1))));
      const nc=c+g.adjLen[e]*(1+guideWeight*(dev[v]+dev[w])/Math.max(60,placement.scale*.08)+diversity[e])+80*turn;
      if(nc<costs[e]){costs[e]=nc;prev[e]=edge;push(e,nc);}
     }
    }expanded+=count;if(goal<0)continue;
    const replacement:number[]=[];for(let e=goal;e>=0;e=prev[e]){replacement.push(g.adjTo[e]);diversity[e]+=2;}replacement.push(a);replacement.reverse();
    const path=[...nodes.slice(0,left),...replacement,...nodes.slice(right+1)];if(!valid(path))continue;const candidate=evaluatePath(g,shape,placement,path,3000,8000);evaluated++;
    if(candidate.lengthMeters<3000||candidate.lengthMeters>8000||candidate.repeatRatio>.2)continue;
    if(objective(candidate,placement)>score+.035)continue;
    const refit=refinePathPlacement(g,shape,placement,path,region,3000,8000,100);const p=refit?.placement??placement,e=refit?.evaluated??candidate,value=objective(e,p);
    if(value<nextScore){next=e;nextPlacement=p;nextScore=value;}
   }
  }
  if(!next)break;best=next;placement=nextPlacement;score=nextScore;accepted++;
 }
 return {evaluated:{...best,fit:placement},attempts,evaluatedCandidates:evaluated,acceptedRepairs:accepted,expanded};
}
