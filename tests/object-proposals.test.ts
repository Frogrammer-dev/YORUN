import { expect,it } from 'vitest';
import { buildGraph,makeOrigin,unproject } from '@/lib/route/graph';
import { auditObjectPath,recoverObjectPath } from '@/lib/route/objectProposals';
import { OBJECT_TEMPLATES } from '@/lib/route/objectTemplates';

function fixture(){
  const origin=makeOrigin(37,127),points:[number,number][]=[[-500,-500],[500,-500],[500,500],[-500,500]];
  const ll=points.map(([x,y])=>unproject(origin,x,y));
  const graph=buildGraph(origin,ll.map(p=>p[0]),ll.map(p=>p[1]),[{a:0,b:1,factor:1},{a:1,b:2,factor:1},{a:2,b:3,factor:1},{a:3,b:0,factor:1}],null);
  const path=points.map(([x,y])=>graph.nodeIndex.nearest(x,y,1));path.push(path[0]);
  const index=new Map<string,number[]>();
  for(let v=0;v<graph.n;v++)index.set(`${graph.lat[v]},${graph.lon[v]}`,[v]);
  return {graph,path,index,region:{minX:-1000,minY:-1000,maxX:1000,maxY:1000}};
}

it('recovers exact connected paths and rejects a geographic near miss',()=>{
  const {graph,path,index}=fixture();
  const ll=path.map(v=>[graph.lat[v],graph.lon[v]] as [number,number]);
  expect(recoverObjectPath(graph,ll,index)).toEqual(path);
  ll[1]=[ll[1][0]+1e-10,ll[1][1]];
  expect(recoverObjectPath(graph,ll,index)).toBeNull();
});

it('requires native and projected distances, closed paths and the actual graph edges',()=>{
  const {graph,path,region}=fixture();
  expect(auditObjectPath(graph,region,path).valid).toBe(true);
  expect(auditObjectPath(graph,region,path.slice(0,-1)).valid).toBe(false);
  expect(auditObjectPath(graph,region,[path[0],path[2],path[1],path[0]]).valid).toBe(false);
  expect(auditObjectPath({...graph,adjLen:Float32Array.from(graph.adjLen,n=>n*3)},region,path).valid).toBe(false);
  expect(auditObjectPath(graph,{...region,maxX:0},path).valid).toBe(false);
  expect(auditObjectPath(graph,region,[...path,...path.slice(1)]).valid).toBe(false);
});

it('keeps separate closed, normalized silhouette priors with finite features',()=>{
  expect(OBJECT_TEMPLATES).toHaveLength(6);
  expect(new Set(OBJECT_TEMPLATES.map(t=>t.key)).size).toBe(6);
  for(const {shape} of OBJECT_TEMPLATES){
    expect(shape.points[0]).toEqual(shape.points.at(-1));
    expect(shape.points.every(p=>p.every(Number.isFinite))).toBe(true);
    expect(shape.perimeter).toBeGreaterThan(0);
    const xs=shape.points.map(p=>p[0]),ys=shape.points.map(p=>p[1]);
    expect(Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys))).toBeCloseTo(1);
    expect(shape.features.length).toBeGreaterThan(0);
  }
});
