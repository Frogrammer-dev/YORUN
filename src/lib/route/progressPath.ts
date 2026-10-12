import {placeShape,type Placement,type Region} from "./fit";
import {type RoadGraph} from "./graph";
import {resample,type ShapeDef} from "./shapes";

/** Whole-loop search over (directed road edge, contour progress). All output
 * vertices are original graph nodes; turns remember the actual incoming edge.
 */
export function progressPath(g:RoadGraph,shape:ShapeDef,p:Placement,region:Region,bins=32,guideWeight=3,turnWeight=40,localPhase=false):number[]|null {
 const outline=placeShape(resample(shape.points,bins),p),count=outline.length-1;
 const phase=new Float64Array(g.n),deviation=new Float64Array(g.n),allowed=new Uint8Array(g.n),segmentDistance=new Float32Array(g.n*count);
 const tol=Math.max(20,p.scale*.06),radius=p.scale*.28;
 for(let n=0;n<g.n;n++){
  let best=Infinity,at=0;const x=g.x[n],y=g.y[n];
  for(let k=0;k<count;k++){const a=outline[k],b=outline[k+1],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy||1))),d=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);segmentDistance[n*count+k]=d;if(d<best){best=d;at=k+t;}}
  phase[n]=at;deviation[n]=best;allowed[n]=+(best<=radius&&x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY);
 }
 let start=-1,best=Infinity;
 for(let n=0;n<g.n;n++)if(allowed[n]){const d=Math.hypot(g.x[n]-outline[0][0],g.y[n]-outline[0][1]);if(d<best){best=d;start=n;}}
 if(start<0)return null;
 const originPhase=phase[start],m=g.adjTo.length,from=new Int32Array(m);for(let a=0;a<g.n;a++)for(let e=g.adjStart[a];e<g.adjStart[a+1];e++)from[e]=a;
 const states=m*(count+1),cost=new Float64Array(states);cost.fill(Infinity);const prev=new Int32Array(states);prev.fill(-1);const lengths=new Float64Array(states);
 const heap:Array<[number,number]>=[];
 const push=(s:number,c:number)=>{let i=heap.length;heap.push([s,c]);while(i>0){const j=(i-1)>>1;if(heap[j][1]<=c)break;heap[i]=heap[j];i=j;}heap[i]=[s,c];};
 const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return top;};
 const relative=(n:number)=>(phase[n]-originPhase+count)%count;
 for(let e=g.adjStart[start];e<g.adjStart[start+1];e++){const b=g.adjTo[e],q=relative(b);if(!allowed[b]||q>count*.2)continue;const k=Math.floor(q),s=k*m+e,d=Math.hypot(g.x[start]-g.x[b],g.y[start]-g.y[b]);cost[s]=d*(1+guideWeight*(deviation[start]+deviation[b])/(2*tol));lengths[s]=d;push(s,cost[s]);}
 let expanded=0;
 while(heap.length&&expanded++<400000){const [s,c]=pop();if(c!==cost[s])continue;const k=Math.floor(s/m),edge=s%m,a=from[edge],b=g.adjTo[edge];if(b===start&&k>=count-1){const path:number[]=[];let t=s;while(t>=0){path.push(g.adjTo[t%m]);t=prev[t];}path.push(start);return path.reverse();}
  for(let e=g.adjStart[b];e<g.adjStart[b+1];e++){const v=g.adjTo[e];if(!allowed[v]||v===a)continue;let q=relative(v),dv=deviation[v],db=deviation[b];
   if(localPhase){let localBest=Infinity;for(let j=k;j<=Math.min(count,k+2);j++){const segment=(Math.floor(originPhase)+j)%count,d=segmentDistance[v*count+segment];if(d<localBest){localBest=d;q=j;db=segmentDistance[b*count+segment];}}dv=localBest;if(dv>radius)continue;}
   if(v===start&&k>=count*.9)q=count;const delta=q-k;if(delta>count*.23||delta<-count*.16)continue;const nextK=Math.max(k,Math.floor(q));if(nextK>count)continue;
   const d=Math.hypot(g.x[b]-g.x[v],g.y[b]-g.y[v]),len=lengths[s]+d;if(len>8000)continue;
   const ux=g.x[b]-g.x[a],uy=g.y[b]-g.y[a],vx=g.x[v]-g.x[b],vy=g.y[v]-g.y[b],cos=(ux*vx+uy*vy)/(Math.hypot(ux,uy)*d||1),turn=Math.acos(Math.max(-1,Math.min(1,cos)))/(Math.PI/2);
   const nc=c+d*(1+guideWeight*(db+dv)/(2*tol))+turnWeight*turn,ns=nextK*m+e;
   if(nc<cost[ns]){cost[ns]=nc;prev[ns]=s;lengths[ns]=len;push(ns,nc);}
  }
 }
 return null;
}
