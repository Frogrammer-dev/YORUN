import { rdpIndices } from '@/lib/art/rdp';
import { evaluatePath, placeShape, type Evaluated, type Placement, type Region } from './fit';
import { hasEdge, pointSegDist, type RoadGraph } from './graph';
import type { ShapeDef } from './shapes';

export interface PairSegmentOptions { maxAlternatives?:number; maxRoutingAttempts?:number; maxPairs?:number; maxExpanded?:number; }
const quality=(e:Evaluated,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);

/** Geometry-only seam and direction; never search for the highest scoring start. */
export function pairPhaseZero(g:RoadGraph,shape:ShapeDef,p:Placement,nodes:number[]){
  let loop=nodes.slice(0,-1);const outline=placeShape(shape.points,p);
  let area=0,targetArea=0;
  for(let i=0;i<loop.length;i++){const a=loop[i],b=loop[(i+1)%loop.length];area+=g.x[a]*g.y[b]-g.x[b]*g.y[a];}
  for(let i=1;i<outline.length;i++)targetArea+=outline[i-1][0]*outline[i][1]-outline[i][0]*outline[i-1][1];
  if(area*targetArea<0)loop=loop.reverse();
  const [x,y]=outline[0];let first=0,closest=Infinity;
  for(let i=0;i<loop.length;i++){const v=loop[i],d=(g.x[v]-x)**2+(g.y[v]-y)**2;if(d<closest-1e-9||Math.abs(d-closest)<=1e-9&&v<loop[first]){first=i;closest=d;}}
  const result=[...loop.slice(first),...loop.slice(0,first)];return [...result,result[0]];
}
export function pairEdgeKey(nodes:number[]){return nodes.slice(1).map((v,i)=>v<nodes[i]?`${v}:${nodes[i]}`:`${nodes[i]}:${v}`).sort().join(',');}

/** Fixed-pose joint replacements. Unlike greedy repair, individually worse or
 * individually out-of-range segments may participate in a valid improving pair.
 * New paths contain existing road edges only. No uniform refit or app integration.
 */
export function pairSegmentRepair(g:RoadGraph,shape:ShapeDef,p:Placement,input:number[],region:Region,options:PairSegmentOptions={},minMeters=3000,maxMeters=8000){
  const {maxAlternatives=64,maxRoutingAttempts=128,maxPairs=512,maxExpanded=18000}=options;
  const inside=(v:number)=>v>=0&&v<g.n&&g.x[v]>=region.minX&&g.x[v]<=region.maxX&&g.y[v]>=region.minY&&g.y[v]<=region.maxY;
  const valid=(nodes:number[])=>nodes.length>=4&&nodes[0]===nodes.at(-1)&&nodes.every((v,i)=>inside(v)&&(!i||hasEdge(g,nodes[i-1],v)));
  const outline=placeShape(shape.points,p);
  if(!valid(input)||!outline.every(([x,y])=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY))return null;
  const original=evaluatePath(g,shape,p,input,minMeters,maxMeters);
  const constraints=(e:Evaluated)=>e.lengthMeters>=minMeters&&e.lengthMeters<=maxMeters&&e.repeatRatio<=.2;
  if(!constraints(original))return null;
  const nodes=pairPhaseZero(g,shape,p,input),canonical=evaluatePath(g,shape,p,nodes,minMeters,maxMeters);
  const originalQ=quality(original,p),canonicalQ=quality(canonical,p),threshold=Math.min(originalQ,canonicalQ),inputKey=pairEdgeKey(input);
  let best=original,bestQ=originalQ,kind:'input'|'single'|'pair'='input';
  const xy=nodes.map(v=>[g.x[v],g.y[v]] as [number,number]),cum=new Float64Array(nodes.length);
  for(let i=1;i<nodes.length;i++)cum[i]=cum[i-1]+Math.hypot(xy[i][0]-xy[i-1][0],xy[i][1]-xy[i-1][1]);
  const deviation=new Float64Array(g.n);
  for(let v=0;v<g.n;v++)deviation[v]=Math.min(...outline.slice(1).map((b,i)=>pointSegDist(g.x[v],g.y[v],...outline[i],...b)));
  const corners=rdpIndices(xy,10).slice(1,-1);
  const centers=[...new Set([...corners,...Array.from({length:16},(_,i)=>Math.round((i+1)*(nodes.length-1)/17))])];
  type Window={left:number;right:number;error:number;center:number};
  const windows:Window[]=[];
  for(const center of centers)for(const width of [240,600,1000,1500]){
    let left=center,right=center;while(left>0&&cum[center]-cum[left]<width/2)left--;while(right<nodes.length-1&&cum[right]-cum[center]<width/2)right++;
    if(right-left<2||cum[right]-cum[left]>original.lengthMeters*.4)continue;
    const error=nodes.slice(left,right+1).reduce((sum,v)=>sum+deviation[v],0)/(right-left+1);
    windows.push({left,right,error,center});
  }
  // Spread endpoints around the loop rather than spending all searches on one bend.
  const selected:Window[]=[],seenWindows=new Set<string>();
  const ranked=windows.sort((a,b)=>b.error-a.error||a.left-b.left||a.right-b.right);
  selection: for(const cap of [1,2,4])for(const w of ranked){
    const key=`${w.left}:${w.right}`,sector=Math.floor(cum[w.center]/original.lengthMeters*8);
    if(seenWindows.has(key)||selected.filter(q=>Math.floor(cum[q.center]/original.lengthMeters*8)===sector).length>=cap)continue;
    selected.push(w);seenWindows.add(key);if(selected.length>=16)break selection;
  }
  const m=g.adjTo.length,from=new Int32Array(m);for(let v=0;v<g.n;v++)for(let e=g.adjStart[v];e<g.adjStart[v+1];e++)from[e]=v;
  type Alternative={left:number;right:number;segment:number[];singleQ:number;singleValid:boolean;singleRaw:number;};
  const alternatives:Alternative[]=[],seenSegments=new Set<string>();
  let routingAttempts=0,expanded=0,singleEvaluations=0,pairEvaluations=0,invalidPairs=0,sameEdgeDiagnostics=0,validPairs=0;
  const forbidden=new Set<number>();
  const edgeDiversity=new Map<string,Float32Array>();
  const route=(a:number,b:number,turnCost:number,guideWeight:number,left:number,diversity:Float32Array)=>{
    const costs=new Float64Array(m);costs.fill(Infinity);const prev=new Int32Array(m);prev.fill(-1);const heap:Array<[number,number]>=[];
    const push=(e:number,c:number)=>{let i=heap.length;heap.push([e,c]);while(i){const j=(i-1)>>1;if(heap[j][1]<=c)break;heap[i]=heap[j];i=j;}heap[i]=[e,c];};
    const pop=()=>{const top=heap[0],last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=last[1])break;heap[i]=heap[j];i=j;}heap[i]=last;}return top;};
    const turn=(u:number,v:number,w:number)=>{const dx=g.x[v]-g.x[u],dy=g.y[v]-g.y[u],ex=g.x[w]-g.x[v],ey=g.y[w]-g.y[v];return Math.acos(Math.max(-1,Math.min(1,(dx*ex+dy*ey)/(Math.hypot(dx,dy)*Math.hypot(ex,ey)||1))));};
    for(let e=g.adjStart[a];e<g.adjStart[a+1];e++){const v=g.adjTo[e];if(!inside(v)||forbidden.has(v))continue;const c=g.adjLen[e]*(1+guideWeight*(deviation[a]+deviation[v])/Math.max(60,p.scale*.08)+diversity[e])+(left>0?turnCost*turn(nodes[left-1],a,v):0);costs[e]=c;push(e,c);}
    let goal=-1,count=0;
    while(heap.length&&count<maxExpanded){const [edge,c]=pop();if(c!==costs[edge])continue;count++;const u=from[edge],v=g.adjTo[edge];if(v===b){goal=edge;break;}
      for(let e=g.adjStart[v];e<g.adjStart[v+1];e++){const w=g.adjTo[e];if(w===u||w===a||!inside(w)||forbidden.has(w))continue;
        const nc=c+g.adjLen[e]*(1+guideWeight*(deviation[v]+deviation[w])/Math.max(60,p.scale*.08)+diversity[e])+turnCost*turn(u,v,w);
        if(nc<costs[e]){costs[e]=nc;prev[e]=edge;push(e,nc);}
      }
    }
    expanded+=count;if(goal<0)return null;const segment:number[]=[];for(let e=goal;e>=0;e=prev[e])segment.push(g.adjTo[e]);segment.push(a);segment.reverse();return segment;
  };
  const merge=(changes:Alternative[])=>{let cursor=0;const result:number[]=[];for(const c of [...changes].sort((a,b)=>a.left-b.left)){result.push(...nodes.slice(cursor,c.left),...c.segment);cursor=c.right+1;}result.push(...nodes.slice(cursor));return result;};
  const accept=(path:number[],e:Evaluated,value:number,nextKind:'single'|'pair')=>{
    if(pairEdgeKey(path)===inputKey){sameEdgeDiagnostics++;return false;}
    if(constraints(e)&&value<threshold-1e-7&&value<bestQ-1e-7){best=e;bestQ=value;kind=nextKind;return true;}return false;
  };
  // Round-robin profiles preserve window diversity under the fixed routing cap.
  generation: for(const [turnCost,guideWeight] of [[0,0],[80,1],[240,0],[80,4],[80,1],[80,4],[240,1],[0,1]])for(const w of selected){
    if(routingAttempts>=maxRoutingAttempts||alternatives.length>=maxAlternatives)break generation;
    const a=nodes[w.left],b=nodes[w.right];forbidden.clear();for(const v of [...nodes.slice(0,w.left),...nodes.slice(w.right+1)])forbidden.add(v);forbidden.delete(a);forbidden.delete(b);
    const windowKey=`${w.left}:${w.right}`,diversity=edgeDiversity.get(windowKey)??new Float32Array(m);edgeDiversity.set(windowKey,diversity);
    routingAttempts++;const segment=route(a,b,turnCost,guideWeight,w.left,diversity);if(!segment||segment.length<2)continue;
    // Penalize both directions of previously generated roads for this exact window.
    // This diversifies candidates without changing the final original score.
    for(let i=1;i<segment.length;i++){const u=segment[i-1],v=segment[i];for(let e=g.adjStart[u];e<g.adjStart[u+1];e++)if(g.adjTo[e]===v)diversity[e]+=2;for(let e=g.adjStart[v];e<g.adjStart[v+1];e++)if(g.adjTo[e]===u)diversity[e]+=2;}
    const key=`${w.left}:${w.right}:${segment.join(',')}`;if(seenSegments.has(key))continue;seenSegments.add(key);
    if(segment.length===w.right-w.left+1&&segment.every((v,i)=>v===nodes[w.left+i]))continue;
    const alt={left:w.left,right:w.right,segment,singleQ:Infinity,singleValid:false,singleRaw:0};
    const path=pairPhaseZero(g,shape,p,merge([alt]));if(!valid(path))continue;
    const e=evaluatePath(g,shape,p,path,minMeters,maxMeters);singleEvaluations++;alt.singleQ=quality(e,p);alt.singleValid=constraints(e);alt.singleRaw=100*Math.exp(-alt.singleQ);alternatives.push(alt);accept(path,e,alt.singleQ,'single');
  }
  const bestSingleQ=bestQ;
  const pairs:Array<{a:number;b:number;proxy:number}>=[];
  for(let a=0;a<alternatives.length;a++)for(let b=a+1;b<alternatives.length;b++){const x=alternatives[a],y=alternatives[b];if(x.right<y.left||y.right<x.left)pairs.push({a,b,proxy:x.singleQ+y.singleQ});}
  pairs.sort((a,b)=>a.proxy-b.proxy||a.a-b.a||a.b-b.b);
  let selectedPair:{a:number;b:number;bothSinglesNonImproving:boolean;betterThanBestSingle:boolean}|null=null;
  const evaluatedGeometry=new Set<string>();
  for(const pair of pairs.slice(0,maxPairs)){
    const x=alternatives[pair.a],y=alternatives[pair.b],path=pairPhaseZero(g,shape,p,merge([x,y]));if(!valid(path)){invalidPairs++;continue;}
    const key=pairEdgeKey(path);if(evaluatedGeometry.has(key))continue;evaluatedGeometry.add(key);
    const e=evaluatePath(g,shape,p,path,minMeters,maxMeters);pairEvaluations++;if(!constraints(e)){invalidPairs++;continue;}validPairs++;
    const value=quality(e,p);if(accept(path,e,value,'pair'))selectedPair={a:pair.a,b:pair.b,bothSinglesNonImproving:(!x.singleValid||x.singleQ>=threshold)&&(!y.singleValid||y.singleQ>=threshold),betterThanBestSingle:value<bestSingleQ-1e-7};
  }
  return {evaluated:{...best,fit:p},kind,geometryImprovement:kind!=='input',selectedPair,routingAttempts,expanded,singleEvaluations,pairEvaluations,validPairs,invalidPairs,sameEdgeDiagnostics,alternativeCount:alternatives.length,availablePairs:pairs.length,windows:selected.length,
    inputRaw:100*Math.exp(-originalQ),phaseZeroInputRaw:100*Math.exp(-canonicalQ),bestSingleRaw:100*Math.exp(-bestSingleQ),afterRaw:100*Math.exp(-bestQ),
    alternatives:alternatives.map(c=>({left:c.left,right:c.right,originalMeters:cum[c.right]-cum[c.left],replacementNodes:c.segment.length,singleRaw:c.singleRaw,singleValid:c.singleValid}))};
}
