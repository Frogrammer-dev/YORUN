// Opt-in resume of the interrupted v19 generation. See protocol-v19-resume-amendment.md.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { readLocalRoads } from '@/lib/route/roadData.server';
import { graphFromOverpass } from '@/lib/route/osm';
import { project } from '@/lib/route/graph';
import { DIVERSITY_CATALOG } from '@/lib/route/diversityCatalog';
import { auditObjectPath, generateObjectProposals, type ObjectProposal } from '@/lib/route/objectProposals';
import { TimeBudget } from '@/lib/route/budget';

type Row=ObjectProposal&{sourceFile:string;proposalCategory:string};
const sha=(x:string|Buffer)=>createHash('sha256').update(x).digest('hex');
const INTERRUPTED_SHA='6744c7f657eae7825709fd7a78fadb2b8829cb4c952003042376ea4040f52ece';
const DB_SHA='5d7d2d7abdd3fc04e729b1bc22e657fde4bb5c1446519e60c02cc494b0775ced';

it.skipIf(!process.env.ROAD_NEW_GEOGRAPHY_RESUME)('resumes the remaining v19 requests without touching saved ones',()=>{
  const base='eval/recognition/road-ranker-20261102/v19';
  const progressFile=`${base}/generation-resume-progress.json`,completeFile=`${base}/generation-complete.json`;
  expect(existsSync(progressFile),'Do not silently restart a resume').toBe(false);
  expect(existsSync(completeFile)).toBe(false);
  const amendment='reports/road-ranker-20261102/protocol-v19-resume-amendment.md';
  const lock=JSON.parse(readFileSync(`${base}/input-lock.json`,'utf8'));
  for(const [p,h] of Object.entries(lock.hashes))expect(sha(readFileSync(p)),p).toBe(h);
  const rawInterrupted=readFileSync(`${base}/generation.json`);
  expect(sha(rawInterrupted)).toBe(INTERRUPTED_SHA);
  const old=JSON.parse(rawInterrupted.toString());
  expect(old.status).toBe('running');expect(old.reviewSlots).toHaveLength(42);expect(old.counts).toHaveLength(42);
  const directory=path.resolve('data/roads');
  const dbPath=path.join(directory,JSON.parse(readFileSync(path.join(directory,'manifest.json'),'utf8')).file);
  const dbBefore=sha(readFileSync(dbPath));
  expect(dbBefore).toBe(DB_SHA);
  const resumeHashes={[amendment]:sha(readFileSync(amendment)),'tests/eval/road-new-geography-resume-20261103.test.ts':sha(readFileSync('tests/eval/road-new-geography-resume-20261103.test.ts'))};

  const done=new Set(old.counts.map((c:{area:string;proposalShape:string})=>`${c.area}|${c.proposalShape}`));
  const results:Row[]=[...old.results],reviewSlots=[...old.reviewSlots],counts=[...old.counts];
  const sourceSnapshots=[...old.provenance.sourceSnapshots];
  const began=performance.now();
  let continuity:Record<string,unknown>|null=null;
  const provenance=()=>({...old.provenance,sourceSnapshots,resume:{interruptedGenerationSHA256:INTERRUPTED_SHA,resumedRequests:75-42,
    resumeHashes,sqliteSHA256Before:dbBefore,continuity,explicitDirectory:directory}});
  const save=(file:string,status:string)=>writeFileSync(file,JSON.stringify({status,results,reviewSlots,counts,provenance:provenance(),
    elapsedSeconds:old.elapsedSeconds+(performance.now()-began)/1000,elapsedNote:'interrupted run elapsed plus resume elapsed'}));
  save(progressFile,'running');

  for(const area of lock.areas as {area:string;bbox:{south:number;west:number;north:number;east:number}}[]){
    const remaining=DIVERSITY_CATALOG.filter(t=>!done.has(`${area.area}|${t.key}`));
    if(!remaining.length)continue;
    const saved=sourceSnapshots.find((s:{area:string})=>s.area===area.area);
    let state:null|{g:ReturnType<typeof graphFromOverpass>;region:{minX:number;minY:number;maxX:number;maxY:number};roadHash:string;sourceFile:string}=null;
    let areaError:string|null=null;
    try{
      const sourceFile=`${base}/${area.area}-roads.json`;
      let bytes:Buffer;
      if(saved){bytes=readFileSync(saved.sourceFile);expect(sha(bytes)).toBe(saved.roadHash);}
      else{bytes=Buffer.from(JSON.stringify(readLocalRoads(area.bbox,directory)));writeFileSync(sourceFile,bytes,{flag:'wx'});}
      const roadHash=sha(bytes),g=graphFromOverpass(JSON.parse(bytes.toString()),area.bbox,{detail:'simple',excludeSteps:true});
      const [minX,minY]=project(g.origin,area.bbox.south,area.bbox.west);
      const [maxX,maxY]=project(g.origin,area.bbox.north,area.bbox.east);
      state={g,region:{minX,minY,maxX,maxY},roadHash,sourceFile};
      if(!saved)sourceSnapshots.push({...area,roadHash,sourceFile,nodes:g.n});
    }catch(e){areaError=String(e);if(!saved)sourceSnapshots.push({...area,error:areaError});}
    const options=()=>({area:area.area,roadHash:state!.roadHash,idPrefix:'v19',attempts:60,preserveHypotheses:true,budget:new TimeBudget(15000)});
    if(state&&area.area==='changwon-center'){
      const crown=DIVERSITY_CATALOG.find(t=>t.key==='crown')!;
      const again=generateObjectProposals(state.g,state.region,[crown],options()).results;
      const before=old.results.filter((r:Row)=>r.area===area.area&&r.proposalShape==='crown');
      const view=(r:ObjectProposal)=>JSON.stringify([r.id,r.geometryKey,r.path,r.meters,r.generatorSimilarity]);
      const same=before.length===again.length&&before.every((r:Row,i:number)=>view(r)===view(again[i]));
      continuity={request:'changwon-center/crown',savedRows:before.length,regeneratedRows:again.length,exactlyEqual:same,usedInResults:false};
      console.log(`[v19-resume] continuity ${JSON.stringify(continuity)}`);
    }
    for(const item of remaining){
      const proposed=state?generateObjectProposals(state.g,state.region,[item],options()):null;
      const local=proposed?.results??[];
      expect(local.length).toBeLessThanOrEqual(8);
      for(const row of local){
        const checked=auditObjectPath(state!.g,state!.region,row.path);
        expect(checked.valid,row.id).toBe(true);
        expect(row.xy).toEqual(row.path.map(v=>[state!.g.x[v],state!.g.y[v]]));
        expect(row.latlon).toEqual(row.path.map(v=>[state!.g.lat[v],state!.g.lon[v]]));
        results.push({...row,sourceFile:state!.sourceFile,proposalCategory:item.kind});
      }
      const sorted=[...local].sort((a,b)=>b.generatorSimilarity-a.generatorSimilarity||a.id.localeCompare(b.id));
      reviewSlots.push({area:area.area,proposalShape:item.key,category:item.kind,id:sorted[0]?.id??null,
        validRoad:!!sorted.length,selection:'provisional geometry only; semantic methods pending'});
      counts.push({area:area.area,proposalShape:item.key,category:item.kind,validCandidates:local.length,
        areaError,generation:proposed?.counts??null});
      save(progressFile,'running');console.log(`[v19-resume] ${area.area}/${item.key}: ${local.length}`);
    }
  }
  expect(reviewSlots).toHaveLength(75);expect(counts).toHaveLength(75);
  expect(new Set(results.map(r=>r.id)).size).toBe(results.length);
  for(const [p,h] of Object.entries(lock.hashes))expect(sha(readFileSync(p)),p).toBe(h);
  expect(sha(readFileSync(`${base}/generation.json`))).toBe(INTERRUPTED_SHA);
  expect(sha(readFileSync(dbPath))).toBe(dbBefore);
  save(completeFile,'complete');save(progressFile,'complete');
},1_500_000);
