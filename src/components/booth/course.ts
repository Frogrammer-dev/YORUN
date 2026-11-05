import roads from "./roads.json";
export const nodes=roads.nodes;
const adj=nodes.map(()=>[] as number[]);
for(const [a,b] of roads.edges){adj[a].push(b);adj[b].push(a);}
export const streets=roads.edges.map(([a,b])=>"M"+nodes[a].join(" ")+"L"+nodes[b].join(" ")).join("");
export const templates={
  강아지:[[-.9,-.15],[-1,-.48],[-.84,-.45],[-.73,-.13],[.15,-.15],[.25,-.55],[.49,-.82],[.67,-.81],[.69,-.53],[.95,-.31],[.94,-.08],[.59,.01],[.46,.67],[.28,.66],[.29,.32],[-.38,.32],[-.52,.68],[-.72,.67],[-.72,-.13]],
  하트:[[0,.85],[-.78,.07],[-.95,-.34],[-.77,-.7],[-.43,-.79],[0,-.49],[.43,-.79],[.77,-.7],[.95,-.34],[.78,.07]],
  물고기:[[-.9,0],[-.54,-.43],[.03,-.49],[.5,-.19],[.91,-.48],[.88,.48],[.5,.19],[.03,.49],[-.54,.43]]
};
export type Shape=keyof typeof templates;
export const shapes=Object.keys(templates) as Shape[];
const dist=(p:number[],q:number[])=>Math.hypot(p[0]-q[0],p[1]-q[1]);
function nearest(p:number[]){let best=0;for(let i=1;i<nodes.length;i++)if(dist(nodes[i],p)<dist(nodes[best],p))best=i;return best;}
function connect(start:number,end:number){
  const cost=new Float64Array(nodes.length).fill(Infinity),from=new Int32Array(nodes.length).fill(-1),seen=new Set<number>();
  cost[start]=0;const open=new Set([start]);
  while(open.size){
    let a=-1,min=Infinity;
    for(const i of open){const f=cost[i]+dist(nodes[i],nodes[end]);if(f<min){min=f;a=i;}}
    if(a===end)break;
    open.delete(a);seen.add(a);
    for(const b of adj[a]){if(seen.has(b))continue;const next=cost[a]+dist(nodes[a],nodes[b]);if(next<cost[b]){from[b]=a;cost[b]=next;open.add(b);}}
  }
  const path=[end];while(path[0]!==start){const p=from[path[0]];if(p<0)throw Error("연결된 길을 찾지 못했어요.");path.unshift(p);}
  return path;
}
export type Course={path:number[];distance:number};
function loop(points:readonly (readonly number[])[],center:number[]):Course{
  const anchors=points.map(([x,y])=>nearest([center[0]+x*480,center[1]+y*480])).filter((id,i,all)=>id!==all[i-1]);
  if(new Set(anchors).size<3) throw Error("코스를 만들 도로가 부족해요.");
  const path=[anchors[0]];
  for(const id of [...anchors.slice(1),anchors[0]])path.push(...connect(path[path.length-1],id).slice(1));
  const distance=path.slice(1).reduce((n,id,i)=>n+dist(nodes[id],nodes[path[i]]),0);
  return {path,distance};
}
export const extract=(shape:Shape,center:number[])=>loop(templates[shape],center);
/** 설명으로 만든 윤곽(y 위로)을 지도 크기에 맞춘다. 준비된 모양과 같이 가로세로 -1~1에 넣는다 */
export function extractOutline(line:readonly (readonly number[])[],center:number[]){
  const xs=line.map(p=>p[0]),ys=line.map(p=>p[1]);
  const mx=(Math.min(...xs)+Math.max(...xs))/2,my=(Math.min(...ys)+Math.max(...ys))/2;
  const half=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))/2||1;
  return loop(line.map(([x,y])=>[(x-mx)/half*.95,-(y-my)/half*.95]),center);
}
export function drawing(path:number[]){return path.map((n,i)=>(i?"L":"M")+nodes[n].join(" ")).join("");}
