import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,it} from 'vitest';
import {graphFromOverpass,type BBox} from '@/lib/route/osm';
import {project} from '@/lib/route/graph';
import {OBJECT_TEMPLATES} from '@/lib/route/objectTemplates';
import {generateObjectProposals,auditObjectPath} from '@/lib/route/objectProposals';

it.skipIf(!process.env.ROAD_OBJECT_TOOLS)('generates frozen clothing and tool hypotheses on the development roads',()=>{
  const folder='eval/recognition/road-ranker-20261102',output=`${folder}/proposals-v7.json`;
  expect(existsSync(output),'Use a new output path to preserve previous experiments').toBe(false);
  const source=JSON.parse(readFileSync(`${folder}/proposals-v3.json`,'utf8'));
  expect(source.status).toBe('complete');
  const seeds=JSON.parse(readFileSync('eval/recognition/relation-generation-20261021/trial-v1/results.json','utf8')).cases as {area:string;bbox:BBox;roadHash:string}[];
  const results=[...source.results],counts:Record<string,unknown>[]=[],hash=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
  const started=performance.now(),sourceSnapshot=JSON.stringify(source.results);
  const legacyCoreSnapshot='reports/road-ranker-20261102/code-snapshots/objectProposals-v7.ts.txt';
  const legacyCoreSHA256=hash(readFileSync(legacyCoreSnapshot));
  expect(legacyCoreSHA256).toBe('c1069322455b7d96d86975f3310ea0a68c66924f1b8aa6a7e99cd65136f5f9f4');
  const templatesSHA256=hash(JSON.stringify(OBJECT_TEMPLATES)),protocolSHA256=hash(readFileSync('reports/road-ranker-20261102/protocol-v7.md'));
  for(const area of seeds.filter((r,i)=>seeds.findIndex(s=>s.area===r.area)===i)){
    const bytes=readFileSync(`eval/recognition/route-improvement/holdout/${area.area}-roads.json`);expect(hash(bytes)).toBe(area.roadHash);
    const g=graphFromOverpass(JSON.parse(bytes.toString()),area.bbox,{detail:'simple',excludeSteps:true});
    const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east),region={minX,minY,maxX,maxY};
    const keys=new Set<string>();
    for(const row of results.filter(r=>r.area===area.area)){
      const audit=auditObjectPath(g,region,row.path);expect(audit.valid,row.id).toBe(true);if(audit.valid)keys.add(audit.edgeKey);
    }
    const proposed=generateObjectProposals(g,region,OBJECT_TEMPLATES,{area:area.area,roadHash:area.roadHash,idPrefix:'proposal-v7',attempts:60,preserveHypotheses:false,onProgress:c=>console.log(JSON.stringify(c))});
    counts.push(...proposed.counts);
    for(const row of proposed.results){
      const audit=auditObjectPath(g,region,row.path);expect(audit.valid).toBe(true);
      if(!audit.valid||keys.has(audit.edgeKey))continue;keys.add(audit.edgeKey);results.push(row);
    }
  }
  expect(counts).toHaveLength(18);expect(JSON.stringify(results.slice(0,source.results.length))).toBe(sourceSnapshot);
  expect(new Set(results.map(r=>r.id)).size).toBe(results.length);
  const provenance={templatesSHA256,protocolSHA256,sourceSHA256:hash(readFileSync(`${folder}/proposals-v3.json`)),attempts:60,shapes:OBJECT_TEMPLATES.map(t=>t.key),humanRecognitionMeasured:false,
    preserveHypotheses:false,legacyCoreSnapshot,legacyCoreSHA256,
    coreSHA256:hash(readFileSync('src/lib/route/objectProposals.ts')),
    harnessSHA256:hash(readFileSync('tests/eval/road-object-tools-20261102.test.ts'))};
  writeFileSync(`${folder}/proposals-v7.running.json`,JSON.stringify({results,counts,provenance,status:'complete',elapsedSeconds:(performance.now()-started)/1000}));
  renameSync(`${folder}/proposals-v7.running.json`,output);
  writeFileSync('reports/road-ranker-20261102/proposals-v7.json',JSON.stringify({counts,provenance,sourceCount:source.results.length,total:results.length,added:results.length-source.results.length,elapsedSeconds:(performance.now()-started)/1000},null,2));
},1200000);
