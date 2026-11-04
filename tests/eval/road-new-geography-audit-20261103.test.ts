import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readLocalRoads } from '@/lib/route/roadData.server';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { project } from '@/lib/route/graph';
import { auditObjectPath, type ObjectProposal } from '@/lib/route/objectProposals';

it.skipIf(!process.env.ROAD_NEW_GEOGRAPHY_AUDIT)('requeries explicit default DB and independently checks every saved v19 path',()=>{
  const folder='eval/recognition/road-ranker-20261102/v19';
  // protocol-v19-resume-amendment.md: generation.json stays as the interrupted record.
  const data=JSON.parse(readFileSync(`${folder}/generation-complete.json`,'utf8')) as {
    status:string;results:ObjectProposal[];reviewSlots:{area:string;proposalShape:string;id:string|null}[];
    provenance:{sourceSnapshots:{area:string;bbox:BBox;roadHash:string;sourceFile:string}[]}};
  expect(data.status).toBe('complete');expect(data.reviewSlots).toHaveLength(75);
  const sha=(x:Buffer)=>createHash('sha256').update(x).digest('hex');
  const supplement=JSON.parse(readFileSync('reports/road-ranker-20261102/v19-source-supplement.json','utf8'));
  expect(supplement.ROAD_DATA_DIR).toBeNull();
  expect(sha(readFileSync('data/roads/manifest.json'))).toBe(supplement.manifestSHA256);
  const areas=[];
  for(const area of data.provenance.sourceSnapshots){
    const bytes=readFileSync(area.sourceFile);
    const requery=Buffer.from(JSON.stringify(readLocalRoads(area.bbox,path.resolve('data/roads'))));
    expect(requery.equals(bytes),`Exact explicit DB snapshot: ${area.area}`).toBe(true);
    expect(sha(bytes)).toBe(area.roadHash);
    const g=graphFromOverpass(JSON.parse(bytes.toString()),area.bbox,{detail:'simple',excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west);
    const [maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
    const rows=data.results.filter(r=>r.area===area.area);
    for(const row of rows){
      const a=auditObjectPath(g,{minX,minY,maxX,maxY},row.path);expect(a.valid,row.id).toBe(true);
      expect(row.roadHash).toBe(area.roadHash);
      expect(row.xy).toEqual(row.path.map(v=>[g.x[v],g.y[v]]));
      expect(row.latlon).toEqual(row.path.map(v=>[g.lat[v],g.lon[v]]));
      if(a.valid){expect(row.meters).toBe(a.meters);expect(row.repeatRatio).toBe(a.repeatRatio);
        expect(row.projectedMeters).toBe(a.projectedMeters);expect(row.projectedRepeatRatio).toBe(a.projectedRepeatRatio);}
    }
    areas.push({area:area.area,nodes:g.n,candidates:rows.length,exactExplicitDBSnapshot:true});
  }
  expect(areas).toHaveLength(3);
  const ids=new Set(data.results.map(r=>r.id));
  expect(data.reviewSlots.every(s=>s.id===null||ids.has(s.id))).toBe(true);
  writeFileSync('reports/road-ranker-20261102/v19-road-audit.json',JSON.stringify({
    allSavedPathsAudited:data.results.length,requests:75,areas,
    provenanceLimitation:'DB SHA supplement captured during run, not pre-run; exact snapshot requery verified afterwards'},null,2));
},120000);
