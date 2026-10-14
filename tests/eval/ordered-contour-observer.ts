import { placeShape, type Placement, type Region } from '@/lib/route/fit';
import { pointSegDist, type RoadGraph } from '@/lib/route/graph';
import { resample, type ShapeDef } from '@/lib/route/shapes';
import type { Budget } from '@/lib/route/budget';

export interface OrderedContourOptions {bins:number;guideWeight:number;radiusFraction:number;reverse?:boolean;maxExpanded?:number;turnWeight?:number;turnMode?:'angle'|'sharp';normalizedCost?:boolean;expectedRoadMeters?:number;lengthWeight?:number;minMeters?:number;maxMeters?:number;budget?:Budget;}
/** Phase advances keep the exact road node fixed. Only road-edge transitions add path geometry. */
export function orderedContourPathObserved(g:RoadGraph,shape:ShapeDef,p:Placement,region:Region,start:number,options:OrderedContourOptions,observe:(event:Record<string,number>)=>void){
 const {bins,guideWeight,radiusFraction,reverse=false,maxExpanded=400000,turnWeight=80,turnMode='angle',normalizedCost=false,expectedRoadMeters=5000,lengthWeight=1,minMeters=3000,maxMeters=8000,budget}=options;
 if(!Number.isFinite(minMeters)||!Number.isFinite(maxMeters)||minMeters<0||maxMeters<=0||minMeters>maxMeters||budget&&!budget.ok())return {path:null,expanded:0,states:0};
 let outline=placeShape(resample(shape.points,bins),p);if(reverse)outline=[outline[0],...outline.slice(1,-1).reverse(),outline[0]];
 const originalOutline=placeShape(shape.points,p),outlinePerimeter=originalOutline.slice(1).reduce((sum,b,i)=>sum+Math.hypot(b[0]-originalOutline[i][0],b[1]-originalOutline[i][1]),0);
 const radius=p.scale*radiusFraction,tol=Math.max(20,p.scale*.06),m=g.adjTo.length,stride=m+1,total=(bins+1)*stride;
 const from=new Int32Array(m);for(let v=0;v<g.n;v++){if(v%256===0&&budget&&!budget.ok())return {path:null,expanded:0,states:total};for(let e=g.adjStart[v];e<g.adjStart[v+1];e++)from[e]=v;}
 const allowed=new Uint8Array(g.n),segment=new Float32Array(g.n*bins),sample=new Float32Array(g.n*(bins+1));
 for(let v=0;v<g.n;v++){
  if(v%64===0&&budget&&!budget.ok())return {path:null,expanded:0,states:total};
  allowed[v]=+(g.x[v]>=region.minX&&g.x[v]<=region.maxX&&g.y[v]>=region.minY&&g.y[v]<=region.maxY);
  for(let k=0;k<bins;k++)segment[v*bins+k]=pointSegDist(g.x[v],g.y[v],...outline[k],...outline[k+1]);
  for(let k=0;k<=bins;k++)sample[v*(bins+1)+k]=Math.hypot(g.x[v]-outline[k][0],g.y[v]-outline[k][1]);
 }
 if(start<0||!allowed[start]||sample[start*(bins+1)]>radius)return {path:null,expanded:0,states:total};
 const cost=new Float64Array(total);cost.fill(Infinity);const length=new Float32Array(total),previous=new Int32Array(total);previous.fill(-1);
 const heap:Array<[number,number]>=[];
 const push=(s:number,c:number)=>{let i=heap.length;heap.push([s,c]);while(i){const j=(i-1)>>1;if(heap[j][1]<=c)break;heap[i]=heap[j];i=j;}heap[i]=[s,c];};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
 cost[m]=0;push(m,0);let expanded=0,goal=-1;
 const update=(s:number,next:number,c:number,len:number)=>{observe({kind:0,state:next,proposedCost:c,storedCost:cost[next],proposedLength:len,storedLength:length[next],accepted:+(c<cost[next]),minMeters});if(c<cost[next]){cost[next]=c;length[next]=len;previous[next]=s;push(next,c);}};
 while(heap.length&&expanded<maxExpanded&&(!budget||budget.ok())){
  const [s,c]=pop();if(c!==cost[s])continue;expanded++;budget?.spend();const phase=Math.floor(s/stride),edge=s%stride,node=edge===m?start:g.adjTo[edge];
  observe({kind:1,state:s,phase,bins,node,start,length:length[s],cost:c,minMeters});if(phase===bins&&node===start&&length[s]>=minMeters){goal=s;break;}
  if(phase<bins&&sample[node*(bins+1)+phase+1]<=radius){
   const spacing=Math.hypot(outline[phase+1][0]-outline[phase][0],outline[phase+1][1]-outline[phase][1]);
   const phasePenalty=normalizedCost?spacing*sample[node*(bins+1)+phase+1]/(.16*p.scale*outlinePerimeter):guideWeight*spacing*sample[node*(bins+1)+phase+1]/tol;
   update(s,(phase+1)*stride+edge,c+phasePenalty,length[s]);
  }
  const contourPhase=Math.min(phase,bins-1);
  for(let e=g.adjStart[node];e<g.adjStart[node+1];e++){
   const v=g.adjTo[e],d=g.adjLen[e],len=length[s]+d;
   if(!allowed[v]||len>maxMeters||segment[v*bins+contourPhase]>radius*2||(edge!==m&&v===from[edge]))continue;
   let turn=0;if(edge!==m){const u=from[edge],dx=g.x[node]-g.x[u],dy=g.y[node]-g.y[u],ex=g.x[v]-g.x[node],ey=g.y[v]-g.y[node];turn=Math.acos(Math.max(-1,Math.min(1,(dx*ex+dy*ey)/(Math.hypot(dx,dy)*Math.hypot(ex,ey)||1))));}
   const deviation=(segment[node*bins+contourPhase]+segment[v*bins+contourPhase])/2;
   // Local approximation: expected route length is fixed, and raw-edge turns approximate final RDP turns.
   const roadPenalty=normalizedCost?d*deviation/(.16*p.scale*expectedRoadMeters)+d*1e-7+.03/(expectedRoadMeters/1000)*+(turn>=Math.PI/4):d*(lengthWeight+guideWeight*deviation/tol)+turnWeight*(turnMode==='sharp'?+(turn>=Math.PI/4):turn);
   update(s,phase*stride+e,c+roadPenalty,len);
  }
 }
 if(goal<0)return {path:null,expanded,states:total};
 const path:number[]=[];for(let s=goal;s>=0;s=previous[s]){const e=s%stride,v=e===m?start:g.adjTo[e];if(path.at(-1)!==v)path.push(v);}path.reverse();
 return {path,expanded,states:total};
}
