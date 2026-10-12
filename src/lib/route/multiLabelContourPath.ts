import {placeShape,type Placement,type Region} from './fit';
import {pointSegDist,type RoadGraph} from './graph';
import {resample,type ShapeDef} from './shapes';

export interface MultiLabelContourOptions {bins:number;radiusFraction?:number;reverse?:boolean;expectedRoadMeters:number;maxLabels?:number;maxExpanded?:number;maxGoals?:number;}
/** Approximate resource-aware contour search. Immutable predecessor labels preserve reconstruction. */
export function multiLabelContourPath(g:RoadGraph,shape:ShapeDef,p:Placement,region:Region,start:number,options:MultiLabelContourOptions){
 const {bins,radiusFraction=.16,reverse=false,expectedRoadMeters,maxLabels=300000,maxExpanded=200000,maxGoals=24}=options;
 let outline=placeShape(resample(shape.points,bins),p);if(reverse)outline=[outline[0],...outline.slice(1,-1).reverse(),outline[0]];
 const original=placeShape(shape.points,p),perimeter=original.slice(1).reduce((s,b,i)=>s+Math.hypot(b[0]-original[i][0],b[1]-original[i][1]),0),radius=p.scale*radiusFraction,m=g.adjTo.length,stride=m+1;
 const from=new Int32Array(m);for(let v=0;v<g.n;v++)for(let e=g.adjStart[v];e<g.adjStart[v+1];e++)from[e]=v;
 const allowed=new Uint8Array(g.n),segment=new Float32Array(g.n*bins),sample=new Float32Array(g.n*(bins+1));
 for(let v=0;v<g.n;v++){allowed[v]=+(g.x[v]>=region.minX&&g.x[v]<=region.maxX&&g.y[v]>=region.minY&&g.y[v]<=region.maxY);for(let k=0;k<bins;k++)segment[v*bins+k]=pointSegDist(g.x[v],g.y[v],...outline[k],...outline[k+1]);for(let k=0;k<=bins;k++)sample[v*(bins+1)+k]=Math.hypot(g.x[v]-outline[k][0],g.y[v]-outline[k][1]);}
 if(start<0||!allowed[start]||sample[start*(bins+1)]>radius)return{paths:[] as number[][],expanded:0,labels:0,goals:0,capReached:false};
 type Label={edge:number;phase:number;length:number;cost:number;previous:number;key:number};
 const labels:Label[]=[],best=new Map<number,number>(),heap:Array<[number,number]>=[];
 const push=(id:number,c:number)=>{let i=heap.length;heap.push([id,c]);while(i){const j=(i-1)>>1;if(heap[j][1]<=c)break;heap[i]=heap[j];i=j;}heap[i]=[id,c];};
 const pop=()=>{const first=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return first;};
 const update=(edge:number,phase:number,length:number,cost:number,previous:number)=>{if(labels.length>=maxLabels)return;const bucket=Math.min(16,Math.floor(length/500)),key=(phase*stride+edge)*17+bucket,old=best.get(key);if(old!==undefined&&labels[old].cost<=cost)return;const id=labels.length;labels.push({edge,phase,length,cost,previous,key});best.set(key,id);push(id,cost);};
 update(m,0,0,0,-1);let expanded=0,goals=0;const paths:number[][]=[],seen=new Set<string>();
 while(heap.length&&expanded<maxExpanded&&goals<maxGoals){const [id]=pop(),label=labels[id];if(best.get(label.key)!==id)continue;expanded++;const {edge,phase,length,cost}=label,node=edge===m?start:g.adjTo[edge];
  if(phase===bins&&node===start&&length>=3000){goals++;const path:number[]=[];for(let previous=id;previous>=0;previous=labels[previous].previous){const e=labels[previous].edge,v=e===m?start:g.adjTo[e];if(path.at(-1)!==v)path.push(v);}path.reverse();const key=path.join(',');if(!seen.has(key)){seen.add(key);paths.push(path);}continue;}
  if(phase<bins&&sample[node*(bins+1)+phase+1]<=radius){const spacing=Math.hypot(outline[phase+1][0]-outline[phase][0],outline[phase+1][1]-outline[phase][1]);update(edge,phase+1,length,cost+spacing*sample[node*(bins+1)+phase+1]/(.16*p.scale*perimeter),id);}
  const k=Math.min(phase,bins-1);
  for(let e=g.adjStart[node];e<g.adjStart[node+1];e++){const v=g.adjTo[e],d=g.adjLen[e],nextLength=length+d;if(!allowed[v]||nextLength>8000||segment[v*bins+k]>radius*2||(edge!==m&&v===from[edge]))continue;
   let turn=0;if(edge!==m){const u=from[edge],dx=g.x[node]-g.x[u],dy=g.y[node]-g.y[u],ex=g.x[v]-g.x[node],ey=g.y[v]-g.y[node];turn=Math.acos(Math.max(-1,Math.min(1,(dx*ex+dy*ey)/(Math.hypot(dx,dy)*Math.hypot(ex,ey)||1))));}
   const deviation=(segment[node*bins+k]+segment[v*bins+k])/2,nc=cost+d*deviation/(.16*p.scale*expectedRoadMeters)+d*1e-7+.03/(expectedRoadMeters/1000)*+(turn>=Math.PI/4);
   update(e,phase,nextLength,nc,id);
  }
 }
 return{paths,expanded,labels:labels.length,goals,capReached:labels.length>=maxLabels||expanded>=maxExpanded};
}
