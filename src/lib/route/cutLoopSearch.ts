import { evaluatePath, placeShape, toCandidate, type Placement, type Region, type RouteCandidate } from "./fit";
import { hasEdge, pointSegDist, type RoadGraph } from "./graph";
import { buildBlocks, matchShape, shapeSamples, traceUnion } from "./loops";
import { refinePathPlacement } from "./refinePlacement";
import type { ShapeDef } from "./shapes";

/** Exact binary unary + nonnegative Potts minimization. Label 1 is the source side. */
export function minimizeBinaryEnergy(cost0:number[],cost1:number[],pairs:Array<[number,number,number]>) {
  const n=cost0.length;
  if(cost1.length!==n||[...cost0,...cost1].some(c=>!Number.isFinite(c)||c<0)||pairs.some(([a,b,w])=>!Number.isInteger(a)||!Number.isInteger(b)||a<0||b<0||a>=n||b>=n||!Number.isFinite(w)||w<0))throw new Error("Invalid binary energy");
  const adj:number[][]=Array.from({length:n+2},()=>[]),to:number[]=[],cap:number[]=[],source=n,sink=n+1;
  const add=(a:number,b:number,c:number)=>{const i=to.length;to.push(b,a);cap.push(c,0);adj[a].push(i);adj[b].push(i+1);};
  for(let i=0;i<n;i++){add(source,i,cost0[i]);add(i,sink,cost1[i]);}
  for(const [a,b,w]of pairs){add(a,b,w);add(b,a,w);}
  const level=new Int32Array(n+2),cursor=new Int32Array(n+2),queue=new Int32Array(n+2),eps=1e-10;
  const bfs=()=>{level.fill(-1);let head=0,tail=0;queue[tail++]=source;level[source]=0;while(head<tail){const v=queue[head++];for(const e of adj[v])if(cap[e]>eps&&level[to[e]]<0){level[to[e]]=level[v]+1;queue[tail++]=to[e];}}return level[sink]>=0;};
  const send=(v:number,flow:number):number=>{if(v===sink)return flow;for(;cursor[v]<adj[v].length;cursor[v]++){const e=adj[v][cursor[v]],u=to[e];if(cap[e]<=eps||level[u]!==level[v]+1)continue;const sent=send(u,Math.min(flow,cap[e]));if(sent>eps){cap[e]-=sent;cap[e^1]+=sent;return sent;}}return 0;};
  let flow=0;
  while(bfs()){cursor.fill(0);for(;;){const sent=send(source,Number.POSITIVE_INFINITY);if(sent<=eps)break;flow+=sent;}}
  bfs();const labels:number[]=Array.from({length:n},(_,i)=>level[i]>=0?1:0);
  const energy=labels.reduce((sum,x,i)=>sum+(x?cost1[i]:cost0[i]),0)+pairs.reduce((sum,[a,b,w])=>sum+(labels[a]!==labels[b]?w:0),0);
  return {labels,energy,flow};
}

export interface CutLoopOptions {maxPlacements?:number;unaryWeights?:number[];boundaryWeights?:number[];maxCuts?:number;refitTopCount?:number;refitEvaluationsPerPath?:number;}

/** Candidate generator only: connected, hole-free road boundaries are validated and scored afterwards. */
export function cutLoopSearch(g:RoadGraph,shape:ShapeDef,region:Region,inputs:RouteCandidate[],options:CutLoopOptions={},minMeters=3000,maxMeters=8000){
  const {maxPlacements=3,unaryWeights=[.5,1,3,10],boundaryWeights=[.02,.08,.24],maxCuts=36,refitTopCount=8,refitEvaluationsPerPath=120}=options;
  const m=buildBlocks(g,(region.maxX-region.minX)*(region.maxY-region.minY)/4),tmpl=shapeSamples(shape);
  const inside=(x:number,y:number)=>x>=region.minX&&x<=region.maxX&&y>=region.minY&&y<=region.maxY;
  const validPlacement=(p:Placement)=>placeShape(shape.points,p).every(([x,y])=>inside(x,y));
  const validPath=(nodes:number[])=>nodes.length>=4&&nodes[0]===nodes.at(-1)&&nodes.every((v,i)=>v>=0&&inside(g.x[v],g.y[v])&&(i===0||hasEdge(g,nodes[i-1],v)));
  const index=new Map<string,number>();for(let v=0;v<g.n;v++)index.set(`${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`,v);
  const nodesOf=(c:RouteCandidate)=>c.latlngs.map(([lat,lon])=>index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`)??-1);
  const objective=(e:ReturnType<typeof evaluatePath>,p:Placement)=>e.meanDev/(.08*p.scale)+Math.log1p(.03*e.zigzagPerKm)-Math.log(.55+.45*e.featureCoverage)-e.spikes*Math.log(.9);
  type Scored={candidate:RouteCandidate;score:number;nodes:number[]};
  const pool:Scored[]=[],parents:Scored[]=[],seen=new Set<string>();let cuts=0,evaluated=0,refitEvaluations=0,invalidBoundaries=0,componentsTested=0;
  const assess=(nodes:number[],placements:Placement[])=>{
    if(!validPath(nodes))return;
    const key=nodes.slice(1).map((v,i)=>nodes[i]<v?`${nodes[i]}-${v}`:`${v}-${nodes[i]}`).sort().join(',');
    for(const p of placements){if(!validPlacement(p))continue;const e=evaluatePath(g,shape,p,nodes,minMeters,maxMeters);evaluated++;if(e.lengthMeters<minMeters||e.lengthMeters>maxMeters||e.repeatRatio>.2)continue;pool.push({candidate:toCandidate(g,shape,p,e),score:objective(e,p),nodes});}
    seen.add(key);
  };
  for(const input of inputs){const start=pool.length;assess(nodesOf(input),[input.placement]);if(pool.length>start)parents.push(pool.at(-1)!);}
  parents.sort((a,b)=>a.score-b.score);
  const selected:Scored[]=[];
  for(const parent of parents){const p=parent.candidate.placement;if(selected.some(s=>{const q=s.candidate.placement;return Math.hypot(p.cx-q.cx,p.cy-q.cy)<.08*p.scale&&Math.abs(p.scale-q.scale)<.08*p.scale&&Math.abs(p.rotDeg-q.rotDeg)<8;}))continue;selected.push(parent);if(selected.length>=maxPlacements)break;}
  for(const parent of selected){
    const p=parent.candidate.placement,outline=placeShape(shape.points,p);
    const inTemplate=(x:number,y:number)=>{let yes=false;for(let i=0,j=outline.length-1;i<outline.length;j=i++){const a=outline[i],b=outline[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;};
    const distance=(x:number,y:number)=>Math.min(...outline.slice(1).map((b,i)=>pointSegDist(x,y,outline[i][0],outline[i][1],b[0],b[1])));
    const eligible=m.faces.map(f=>inside(f.minX,f.minY)&&inside(f.maxX,f.maxY));
    const q=m.faces.map(f=>f.samples.filter(([x,y])=>inTemplate(x,y)).length/f.samples.length);
    let core=-1;for(let f=0;f<m.faces.length;f++)if(eligible[f]&&q[f]>=.6&&(core<0||q[f]>q[core]||q[f]===q[core]&&Math.hypot(m.faces[f].cx-p.cx,m.faces[f].cy-p.cy)<Math.hypot(m.faces[core].cx-p.cx,m.faces[core].cy-p.cy)))core=f;
    if(core<0)continue;
    const boundary=m.edgeNodes.map((nodes,e)=>{let weighted=0,length=0;for(let i=1;i<nodes.length;i++){const a=nodes[i-1],b=nodes[i],len=Math.hypot(g.x[a]-g.x[b],g.y[a]-g.y[b]);weighted+=len*(distance((g.x[a]+g.x[b])/2,(g.y[a]+g.y[b])/2)/(.1*p.scale))**2;length+=len;}return m.edgeLen[e]/p.scale*(.02+(length?weighted/length:0));});
    for(const unaryWeight of unaryWeights)for(const boundaryWeight of boundaryWeights){
      if(cuts>=maxCuts)break;
      const d0=m.faces.map((f,i)=>unaryWeight*f.area/(p.scale*p.scale)*q[i]),d1=m.faces.map((f,i)=>unaryWeight*f.area/(p.scale*p.scale)*(1-q[i]));
      const pairs:Array<[number,number,number]>=[];
      for(let e=0;e<m.edgeNodes.length;e++){const a=m.heFace[2*e],b=m.heFace[2*e+1],w=boundaryWeight*boundary[e];if(a===b)continue;if(a>=0&&b>=0)pairs.push([a,b,w]);else if(a>=0)d1[a]+=w;else if(b>=0)d1[b]+=w;}
      const infinity=d0.reduce((s,v,i)=>s+v+d1[i],0)+pairs.reduce((s,e)=>s+e[2],0)+1;
      d0[core]=infinity;for(let f=0;f<m.faces.length;f++)if(!eligible[f])d1[f]=infinity;
      const {labels}=minimizeBinaryEnergy(d0,d1,pairs);cuts++;
      const used=new Uint8Array(m.faces.length),components:number[][]=[];
      for(let start=0;start<labels.length;start++){if(!labels[start]||used[start])continue;const stack=[start],component:number[]=[];used[start]=1;while(stack.length){const f=stack.pop()!;component.push(f);for(const h of m.faces[f].hes){const next=m.heFace[h^1];if(next>=0&&labels[next]&&!used[next]){used[next]=1;stack.push(next);}}}components.push(component);}
      components.sort((a,b)=>b.reduce((s,f)=>s+m.faces[f].area,0)-a.reduce((s,f)=>s+m.faces[f].area,0));
      for(const faces of components.slice(0,3)){componentsTested++;const flags=new Uint8Array(m.faces.length+1);for(const f of faces)flags[f]=1;const nodes=traceUnion(g,m,flags,faces);if(!nodes||!validPath(nodes)){invalidBoundaries++;continue;}
        const key=nodes.slice(1).map((v,i)=>nodes[i]<v?`${nodes[i]}-${v}`:`${v}-${nodes[i]}`).sort().join(',');if(seen.has(key))continue;
        const fit=matchShape(nodes.map(v=>[g.x[v],g.y[v]] as [number,number]),shape,tmpl,true);assess(nodes,fit?[p,fit]:[p]);
      }
    }
  }
  pool.sort((a,b)=>a.score-b.score);
  const unique=new Set<string>();
  const distinct=pool.filter(entry=>{const key=entry.nodes.slice(1).map((v,i)=>entry.nodes[i]<v?`${entry.nodes[i]}-${v}`:`${v}-${entry.nodes[i]}`).sort().join(',');if(unique.has(key))return false;unique.add(key);return true;});
  pool.splice(0,pool.length,...distinct);
  const top=pool.slice(0,refitTopCount);
  for(const parent of top){const r=refinePathPlacement(g,shape,parent.candidate.placement,parent.nodes,region,minMeters,maxMeters,refitEvaluationsPerPath);if(!r)continue;refitEvaluations+=r.evaluations;pool.push({candidate:toCandidate(g,shape,r.placement,r.evaluated),score:objective(r.evaluated,r.placement),nodes:parent.nodes});}
  pool.sort((a,b)=>a.score-b.score);
  return {candidate:pool[0]?.candidate??null,pool:pool.slice(0,16).map(p=>p.candidate),cuts,evaluated,refitEvaluations,invalidBoundaries,componentsTested,placements:selected.length,blocks:m.faces.length};
}
