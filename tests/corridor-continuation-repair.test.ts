import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { corridorContinuationRepair } from '@/lib/route/corridorContinuationRepair';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { project, hasEdge } from '@/lib/route/graph';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import type { RouteCandidate } from '@/lib/route/fit';

it('finds the same real transition across a rotated seam and reverse direction', () => {
  const rows = JSON.parse(readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8')) as {cases:Array<{caseId:string;bbox:BBox;candidate:RouteCandidate}>};
  const row=rows.cases.find(c=>c.caseId==='seomyeon-square')!;
  const g=graphFromOverpass(JSON.parse(readFileSync('eval/recognition/llm-routes-20261010/seomyeon-roads.json','utf8')),row.bbox,{detail:'simple',excludeSteps:true});
  const key=(lat:number,lon:number)=>`${lat.toFixed(7)},${lon.toFixed(7)}`;
  const ids=new Map(Array.from({length:g.n},(_,v)=>[key(g.lat[v],g.lon[v]),v]));
  const nodes=row.candidate.latlngs.map(([lat,lon])=>ids.get(key(lat,lon))!);
  const [minX,minY]=project(g.origin,row.bbox.south,row.bbox.west),[maxX,maxY]=project(g.origin,row.bbox.north,row.bbox.east),region={minX,minY,maxX,maxY};
  const shape=SHAPE_BY_ID[row.candidate.shapeId as ShapeId], run=(ns:number[])=>corridorContinuationRepair(g,shape,row.candidate.placement,ns,region)!;
  const first=run(nodes),loop=nodes.slice(0,-1),rotated=[...loop.slice(7),...loop.slice(0,7)],reverse=loop.slice().reverse();
  expect(first.proposals.length).toBeGreaterThan(0);
  for(const ns of [[...rotated,rotated[0]],[...reverse,reverse[0]]]) expect(run(ns).proposals.map(p=>p.key)).toEqual(first.proposals.map(p=>p.key));
  for(const p of first.proposals) expect(p.path.every((v,i)=>!i||hasEdge(g,p.path[i-1],v))).toBe(true);
  const broken=nodes.slice();broken[1]=broken[0]; expect(run(broken)).toBeNull();
});
