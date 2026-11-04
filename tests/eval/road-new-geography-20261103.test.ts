// Opt-in frozen validation. No semantic score influences generation or sampling.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { readLocalRoads } from '@/lib/route/roadData.server';
import { graphFromOverpass } from '@/lib/route/osm';
import { project } from '@/lib/route/graph';
import { DIVERSITY_CATALOG } from '@/lib/route/diversityCatalog';
import { generateObjectProposals, auditObjectPath, type ObjectProposal } from '@/lib/route/objectProposals';
import { TimeBudget } from '@/lib/route/budget';

const AREAS = [
  {area:'chuncheon-center',bbox:{south:37.86,west:127.71,north:37.90,east:127.76}},
  {area:'changwon-center',bbox:{south:35.21,west:128.65,north:35.25,east:128.70}},
  {area:'busan-yeongdo',bbox:{south:35.065,west:129.04,north:35.105,east:129.09}},
];
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');

it.skipIf(!process.env.ROAD_NEW_GEOGRAPHY)('generates fixed75 new-geography requests with strict real-edge audits',()=>{
  const base='eval/recognition/road-ranker-20261102/v19';
  const protocol='reports/road-ranker-20261102/protocol-v19-new-geography.md';
  expect(existsSync(protocol)).toBe(true);
  expect(existsSync(base),'Never overwrite or restart a partial experiment').toBe(false);
  expect(DIVERSITY_CATALOG).toHaveLength(25);
  const codeFiles=[protocol,'tests/eval/road-new-geography-20261103.test.ts',
    'src/lib/route/objectProposals.ts','src/lib/route/globalSearch.ts','src/lib/route/graph.ts',
    'src/lib/route/osm.ts','src/lib/route/shapes.ts','src/lib/route/objectTemplates.ts',
    'src/lib/route/diversityCatalog.ts','src/lib/route/roadData.server.ts','data/roads/manifest.json'];
  const hashes=Object.fromEntries(codeFiles.map(p=>[p,sha(readFileSync(p))]));
  mkdirSync(base,{recursive:true});
  const humanRequests=AREAS.flatMap(a=>['animal','object'].flatMap(kind=>
    DIVERSITY_CATALOG.filter(t=>t.kind===kind).map(t=>({area:a.area,key:t.key,kind,
      hash:sha(`v19-human|${a.area}|${t.key}`)})).sort((a,b)=>a.hash.localeCompare(b.hash)).slice(0,2)));
  writeFileSync(`${base}/input-lock.json`,JSON.stringify({hashes,areas:AREAS,humanRequests,
    minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,attempts:60,requestBudgetMs:15000,
    original75Preserved:true,holdoutV2Read:false},null,2),{flag:'wx'});
  const results:Array<ObjectProposal&{sourceFile:string;proposalCategory:string}>=[];
  const reviewSlots:Array<Record<string,unknown>>=[],counts:Array<Record<string,unknown>>=[];
  const sourceSnapshots:Array<Record<string,unknown>>=[];
  const began=performance.now();
  const save=(status:string)=>writeFileSync(`${base}/generation.json`,JSON.stringify({status,results,reviewSlots,counts,
    provenance:{sourceSnapshots,hashes,experiment:'v19-new-geography',independentHumanEvaluation:false},
    elapsedSeconds:(performance.now()-began)/1000}));
  save('running');
  for(const area of AREAS){
    let state:null|{g:ReturnType<typeof graphFromOverpass>;region:{minX:number;minY:number;maxX:number;maxY:number};roadHash:string;sourceFile:string}=null;
    let areaError:string|null=null;
    try{
      const bytes=Buffer.from(JSON.stringify(readLocalRoads(area.bbox)));
      const sourceFile=`${base}/${area.area}-roads.json`;writeFileSync(sourceFile,bytes,{flag:'wx'});
      const roadHash=sha(bytes),g=graphFromOverpass(JSON.parse(bytes.toString()),area.bbox,{detail:'simple',excludeSteps:true});
      const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west);
      const [maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
      state={g,region:{minX,minY,maxX,maxY},roadHash,sourceFile};
      sourceSnapshots.push({...area,roadHash,sourceFile,nodes:g.n});
    }catch(e){areaError=String(e);sourceSnapshots.push({...area,error:areaError});}
    for(const item of DIVERSITY_CATALOG){
      let proposed:ReturnType<typeof generateObjectProposals>|null=null;
      if(state) proposed=generateObjectProposals(state.g,state.region,[item],{area:area.area,
        roadHash:state.roadHash,idPrefix:'v19',attempts:60,preserveHypotheses:true,budget:new TimeBudget(15000)});
      const local=proposed?.results??[];
      expect(local.length).toBeLessThanOrEqual(8);
      for(const row of local){
        if(!state)throw new Error('Missing graph');
        const checked=auditObjectPath(state.g,state.region,row.path);
        expect(checked.valid,row.id).toBe(true);
        expect(row.xy).toEqual(row.path.map(v=>[state.g.x[v],state.g.y[v]]));
        expect(row.latlon).toEqual(row.path.map(v=>[state.g.lat[v],state.g.lon[v]]));
        results.push({...row,sourceFile:state.sourceFile,proposalCategory:item.kind});
      }
      const sorted=[...local].sort((a,b)=>b.generatorSimilarity-a.generatorSimilarity||a.id.localeCompare(b.id));
      reviewSlots.push({area:area.area,proposalShape:item.key,category:item.kind,id:sorted[0]?.id??null,
        validRoad:!!sorted.length,selection:'provisional geometry only; semantic methods pending'});
      counts.push({area:area.area,proposalShape:item.key,category:item.kind,validCandidates:local.length,
        areaError,generation:proposed?.counts??null});
      save('running');console.log(`[v19] ${area.area}/${item.key}: ${local.length}`);
    }
    if(state)expect(sha(readFileSync(state.sourceFile))).toBe(state.roadHash);
  }
  expect(reviewSlots).toHaveLength(75);expect(counts).toHaveLength(75);
  expect(new Set(results.map(r=>r.id)).size).toBe(results.length);
  for(const [p,h] of Object.entries(hashes))expect(sha(readFileSync(p)),p).toBe(h);
  save('complete');
},1_200_000);
