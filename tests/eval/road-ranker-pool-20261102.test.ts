import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { it, expect } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { hasEdge, project } from '@/lib/route/graph';
import { buildBlocks, growLoops } from '@/lib/route/loops';
import { StepBudget } from '@/lib/route/budget';

it.skipIf(!process.env.ROAD_RANKER_POOL)('exports a diverse, independently validated natural road pool', () => {
  const seeds = JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json', 'utf8')).cases as {area:string;bbox:BBox;roadHash:string}[];
  const prior = JSON.parse(readFileSync('eval/recognition/road-input-20261029/roads.json', 'utf8')).results as {id:string;area:string;path:number[]}[];
  const results = [], counts = [];
  for (const area of seeds.filter((r,i) => seeds.findIndex(s => s.area === r.area) === i)) {
    const bytes = readFileSync(`eval/recognition/route-improvement/holdout/${area.area}-roads.json`);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(area.roadHash);
    const g = graphFromOverpass(JSON.parse(bytes.toString()), area.bbox, {detail:'simple',excludeSteps:true});
    const [minX,minY] = project(g.origin,area.bbox.south,area.bbox.west), [maxX,maxY] = project(g.origin,area.bbox.north,area.bbox.east);
    const region = {minX,minY,maxX,maxY}, blocks = buildBlocks(g,(maxX-minX)*(maxY-minY)/4);
    const loops = growLoops(g,blocks,region,3000,8000,{seeds:Math.min(2000,blocks.faces.length),budget:new StepBudget(2000),fraction:1,seed:83721});
    const accepted: Set<string>[] = [], seen = new Set<string>(); let checked = 0;
    // Fixed hash order avoids concentrating all new samples in the first loop seeds.
    const shuffled = loops.map(r => ({path:r.path,key:createHash('sha256').update(`83721:${r.path.join(',')}`).digest('hex')})).sort((a,b)=>a.key.localeCompare(b.key));
    const source = [...prior.filter(r => r.area === area.area).map(r => ({path:r.path,baselineId:r.id})), ...shuffled.map(r => ({path:r.path,baselineId:null}))];
    for (const entry of source) {
      const path = entry.path; checked++;
      if (path.length < 4 || path[0] !== path.at(-1) || !path.every(v => g.x[v]>=minX && g.x[v]<=maxX && g.y[v]>=minY && g.y[v]<=maxY)) continue;
      let meters=0, projectedMeters=0, repeated=0, projectedRepeat=0;
      const edges = new Set<string>();
      for (let i=1;i<path.length;i++) {
        const a=path[i-1],b=path[i]; expect(hasEdge(g,a,b)).toBe(true);
        let length=NaN;
        for(let e=g.adjStart[a];e<g.adjStart[a+1];e++) if(g.adjTo[e]===b){length=g.adjLen[e];break;}
        const distance=Math.hypot(g.x[a]-g.x[b],g.y[a]-g.y[b]), key=a<b?`${a}:${b}`:`${b}:${a}`;
        expect(Number.isFinite(length)).toBe(true);
        meters+=length; projectedMeters+=distance;
        if(edges.has(key)){repeated+=length;projectedRepeat+=distance;}
        edges.add(key);
      }
      if(meters<3000||meters>8000||projectedMeters<3000||projectedMeters>8000||repeated/meters>.2||projectedRepeat/projectedMeters>.2)continue;
      const hash=createHash('sha256').update([...edges].sort().join('|')).digest('hex');
      if(seen.has(hash))continue; seen.add(hash);
      if(!entry.baselineId && accepted.some(other => {
        let overlap=0;for(const key of edges)if(other.has(key))overlap++;
        return overlap/(edges.size+other.size-overlap)>.8;
      }))continue;
      accepted.push(edges);
      results.push({id:`${area.area}-pool-${accepted.length}`,area:area.area,baselineId:entry.baselineId,roadHash:area.roadHash,edgeHash:hash,path,xy:path.map(v=>[g.x[v],g.y[v]]),latlon:path.map(v=>[g.lat[v],g.lon[v]]),meters,projectedMeters,repeatRatio:repeated/meters,projectedRepeatRatio:projectedRepeat/projectedMeters});
      if(accepted.length===120)break;
    }
    counts.push({area:area.area,roadHash:area.roadHash,naturalLoops:loops.length,checked,exported:accepted.length});
  }
  expect(results.filter(r=>r.baselineId)).toHaveLength(18);
  expect(new Set(results.map(r=>r.edgeHash)).size).toBe(results.length);
  const out='eval/recognition/road-ranker-20261102';mkdirSync(out,{recursive:true});
  writeFileSync(`${out}/roads.json`,JSON.stringify({targetShapesUsed:false,seed:83721,budget:2000,counts,results}));
  mkdirSync('reports/road-ranker-20261102',{recursive:true});writeFileSync('reports/road-ranker-20261102/pool.json',JSON.stringify({counts,total:results.length,roadsSHA256:createHash('sha256').update(readFileSync(`${out}/roads.json`)).digest('hex')},null,2));
  console.log(JSON.stringify({counts,total:results.length}));
},180000);

it.skipIf(!process.env.ROAD_RANKER_AUDIT)('checks inference preserves every source path and coordinate',()=>{
  const root='eval/recognition/road-ranker-20261102';
  const bytes=readFileSync(`${root}/roads.json`), hash=createHash('sha256').update(bytes).digest('hex');
  const source=JSON.parse(bytes.toString()).results as Record<string,unknown>[];
  const files=['predictions-clean-17.json','predictions-clean-29.json','predictions-road-17.json','predictions-road-29.json'];
  if(existsSync(`${root}/predictions-clip-v2.json`))files.push('predictions-clip-v2.json');
  for(const file of files){
    const data=JSON.parse(readFileSync(`${root}/${file}`,'utf8'));
    expect(data.inputSHA256).toBe(hash);
    expect(data.outputs).toHaveLength(source.length);
    const lookup=new Map(data.outputs.map((r:Record<string,unknown>)=>[r.id,r]));
    expect(lookup.size).toBe(source.length);
    for(const row of source){
      const output=lookup.get(row.id) as Record<string,unknown>;
      for(const key of Object.keys(row))expect(output[key]).toEqual(row[key]);
      expect(output.coordinatesUnchanged).toBe(true);
      expect(Number.isFinite(output.score)).toBe(true);
    }
  }
});
