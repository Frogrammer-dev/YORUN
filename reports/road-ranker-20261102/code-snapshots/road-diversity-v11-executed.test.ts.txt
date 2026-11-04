// Opt-in development experiment: target-guided generation, NOT a model-only comparison.
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { expect, it } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { hasEdge, project, type RoadGraph } from '@/lib/route/graph';
import { generateObjectProposals, auditObjectPath } from '@/lib/route/objectProposals';
import { TimeBudget } from '@/lib/route/budget';
import { OBJECT_TEMPLATES } from '@/lib/route/objectTemplates';
import { SHAPE_BY_ID } from '@/lib/route/shapes';
import type { Region } from '@/lib/route/fit';

type XY = [number, number];
type SourceRow = {
  id: string; area: string; path: number[]; xy: XY[]; latlon: XY[];
  meters: number; repeatRatio: number; roadHash: string; baselineId: string | null;
  [key: string]: unknown;
};
const ANIMALS = ['cat','fish','dog','rabbit','bird','whale','turtle','elephant','giraffe','butterfly','duck'] as const;
const OBJECTS = ['house','tree','car','rocket','apple','crown','airplane','mug'] as const;
const sha = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');

function audit(g: RoadGraph, region: Region, path: number[]) {
  const reasons: string[] = [];
  if (path.length < 4 || path[0] !== path.at(-1)) reasons.push('not_closed');
  if (!path.every(v => Number.isInteger(v) && v >= 0 && v < g.n)) return { reasons: ['invalid_node'] };
  if (!path.every(v => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY)) reasons.push('outside_region');
  let meters = 0, projectedMeters = 0, repeated = 0, projectedRepeated = 0;
  const edges = new Set<string>();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    if (!hasEdge(g, a, b)) return { reasons: [...reasons, 'missing_edge'] };
    let length = NaN;
    for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) { length = g.adjLen[e]; break; }
    if (!Number.isFinite(length) || length <= 0) return { reasons: [...reasons, 'invalid_edge_length'] };
    const projected = Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    meters += length; projectedMeters += projected;
    if (edges.has(key)) { repeated += length; projectedRepeated += projected; }
    edges.add(key);
  }
  const repeatRatio = repeated / meters, projectedRepeatRatio = projectedRepeated / projectedMeters;
  if (![meters, projectedMeters, repeatRatio, projectedRepeatRatio].every(Number.isFinite)) reasons.push('nonfinite_measurement');
  if (meters < 3000 || meters > 8000) reasons.push('native_distance');
  if (projectedMeters < 3000 || projectedMeters > 8000) reasons.push('projected_distance');
  if (repeatRatio > .2) reasons.push('native_repeat');
  if (projectedRepeatRatio > .2) reasons.push('projected_repeat');
  return { reasons, meters, projectedMeters, repeatRatio, projectedRepeatRatio, edgeHash: sha([...edges].sort().join('|')) };
}



const FEATURE_HYPOTHESES: Record<string, [string, string]> = {
  cat: ['ear peaks and head/body proportion', 'eyes/whiskers absent; short ears may collapse'],
  fish: ['body-to-tail transition and tail fork', 'interior gill/eye absent; narrow tail neck may merge'],
  dog: ['snout, legs and tail relative to torso', 'leg gaps and short snout may disappear'],
  rabbit: ['paired long ears and sitting-body proportions', 'parallel ears may merge into one road protrusion'],
  bird: ['beak/head transition, body and tail', 'beak/wing detail is short; generic leaf-like silhouette risk'],
  whale: ['large rounded body and tail flukes', 'curvature becomes block boundary; fluke neck may collapse'],
  turtle: ['shell-to-head and four-limb arrangement', 'small limb protrusions may become uninformative zigzags'],
  elephant: ['trunk, large body and legs', 'trunk/leg gaps can require long detours; interior ear absent'],
  giraffe: ['long neck, small head and leg proportions', 'thin neck/legs compete with street spacing'],
  butterfly: ['paired upper/lower wings and central waist', 'wing symmetry/waist vulnerable to grid distortion'],
  duck: ['bill, head/neck transition and broad body', 'bill/neck detail can collapse; eye absent'],
  house: ['roof peak and roof-to-wall shoulders', 'without door/window may remain generic polygon'],
  tree: ['crown-to-trunk transition and width ratio', 'organic crown and thin trunk may distort'],
  car: ['roof/body and two wheel notches', 'wheel gaps are small and circular features absent'],
  rocket: ['nose, body and paired fins', 'thin fins/distinctive waist can collapse; no CLIP rocket label'],
  apple: ['top notch/stem and broad body', 'short stem may disappear; circular boundary ambiguity'],
  crown: ['three tips and connecting base', 'tips may flatten or become unrelated spikes'],
  airplane: ['wings, fuselage and tail proportions', 'thin fuselage/wing gaps can merge or demand detours'],
  mug: ['body and handle-side protrusion', 'interior handle hole absent in a single exterior contour'],
  tshirt: ['neck notch, sleeves and torso', 'neck/sleeve gaps may collapse; generic cross ambiguity'],
  pants: ['waist and two separated legs', 'crotch gap may close; generic U-shape ambiguity'],
  hammer: ['wide head and long narrower handle', 'T-shape alone is not sufficient evidence of object recognition'],
  bottle: ['neck, shoulders and wider body', 'short neck can disappear; interior detail absent'],
  key: ['head, shaft and distinct teeth', 'small teeth may vanish; exterior omits key-head hole'],
  chair: ['backrest, seat and separated supports', 'single contour lacks interior structure; generic step ambiguity'],
};

type Snapshot = {area:string; bbox:BBox; sourceFile:string; roadHash:string};

it.skipIf(!process.env.ROAD_DIVERSITY)('generates all25 animal/object hypotheses on frozen v9 roads without changing prior results', () => {
  const began = performance.now();
  // Safety ceiling only: no search/ranking parameters change while this shared budget remains available.
  const budget = new TimeBudget(1170000); // reserve30s for final checks/publication within20min test ceiling
  const folder = 'eval/recognition/road-ranker-20261102';
  const sourceFile = `${folder}/v9-proposals.json`, output = `${folder}/diversity-v11.json`;
  const progress = `${folder}/diversity-v11.running.json`;
  const report = 'reports/road-ranker-20261102/diversity-v11.json';
  const tableFile = 'reports/road-ranker-20261102/diversity-v11.md';
  const protocolFile = 'reports/road-ranker-20261102/protocol-v11.md';
  expect(existsSync(protocolFile), 'Pre-register protocol-v11 first').toBe(true);
  for (const file of [output,progress,report,tableFile]) expect(existsSync(file),`Preserve existing ${file}`).toBe(false);
  const sourceBytes = readFileSync(sourceFile);
  expect(sha(sourceBytes)).toBe('4943a6bf2140951860fe713bfc9cdb258a8101027bda25745c2febc32b678fb0');
  const source = JSON.parse(sourceBytes.toString()) as {status:string; results:SourceRow[]; provenance:{sourceSnapshots:Snapshot[];sqliteSHA256:string}};
  expect(source.status).toBe('complete');expect(source.results).toHaveLength(550);
  expect(source.results.filter(r=>r.baselineId)).toHaveLength(6);
  const originalRows = JSON.stringify(source.results);
  const templates = [
    ...ANIMALS.map(key=>({key,category:'animal',shape:SHAPE_BY_ID[key]})),
    ...OBJECTS.map(key=>({key,category:'object',shape:SHAPE_BY_ID[key]})),
    ...OBJECT_TEMPLATES.map(t=>({...t,category:'object'})),
  ];
  expect(templates).toHaveLength(25);expect(new Set(templates.map(t=>t.key)).size).toBe(25);
  const templatesSHA256 = sha(JSON.stringify(templates));
  const vocabFile = 'src/lib/art/clipVocabulary.json';
  const headDataFile = `${folder}/v10-dataset/dataset.json`;
  const vocab = JSON.parse(readFileSync(vocabFile,'utf8')) as {english:string;excluded:boolean}[];
  const headData = JSON.parse(readFileSync(headDataFile,'utf8')) as {classes:{name:string;word?:string;key?:string;object:boolean}[]};
  const headKeys = new Set(headData.classes.filter(c=>c.object).map(c=>c.key??c.name.replaceAll(' ','_')));
  const aliases: Record<string,string[]> = {mug:['coffee_cup','cup'],tshirt:['t-shirt'],bottle:['wine_bottle']};
  const scope = templates.map(t=>{
    const names = aliases[t.key]??[t.key];
    const matches = vocab.filter(v=>names.includes(v.english));
    return {key:t.key,name:t.shape.name,category:t.category,
      currentHeadSupported:names.some(n=>headKeys.has(n)),currentHeadSupportSource:'frozen v10 object-class metadata; no inference here',
      clipVocabularySupported:matches.length>0,clipRecommendationClassAllowed:matches.some(v=>!v.excluded),
      clipClassMatches:matches,declaredClassNames:names,
      hypothesizedIdentifyingFeatures:FEATURE_HYPOTHESES[t.key][0],silhouetteAndGridRisks:FEATURE_HYPOTHESES[t.key][1],
      featurePreservationMeasured:false,humanRecognitionMeasured:false,template:t.shape};
  });
  const support = new Map(scope.map(s=>[s.key,s]));
  const results: SourceRow[] = [...source.results];
  const counts: Record<string,unknown>[] = [];
  const reviewSlots: Record<string,unknown>[] = [];
  const areas = source.provenance.sourceSnapshots;
  expect(areas.map(a=>a.area)).toEqual(['cheonan-buldang','jeonju-hyoja','ulsan-samsan']);
  const graphs = new Map<string,{g:RoadGraph;region:Region}>();
  const sourceGeometry = new Map<string,string[]>(),sourceIntentGeometry = new Map<string,string[]>();
  for (const row of source.results) {
    const geometry = String(row.geometryKey), intentGeometry = JSON.stringify([row.proposalShape,geometry]);
    sourceGeometry.set(geometry,[...(sourceGeometry.get(geometry)??[]),row.id]);
    sourceIntentGeometry.set(intentGeometry,[...(sourceIntentGeometry.get(intentGeometry)??[]),row.id]);
  }
  const provenance = {sourceFile,sourceSHA256:sha(sourceBytes),protocolFile,protocolSHA256:sha(readFileSync(protocolFile)),
    codeSHA256:sha(readFileSync('tests/eval/road-diversity-20261102.test.ts')),
    coreSHA256:sha(readFileSync('src/lib/route/objectProposals.ts')),generatorSHA256:sha(readFileSync('src/lib/route/globalSearch.ts')),
    shapesSHA256:sha(readFileSync('src/lib/route/shapes.ts')),objectTemplatesSHA256:sha(readFileSync('src/lib/route/objectTemplates.ts')),
    graphSHA256:sha(readFileSync('src/lib/route/graph.ts')),osmSHA256:sha(readFileSync('src/lib/route/osm.ts')),
    templatesSHA256,vocabularySHA256:sha(readFileSync(vocabFile)),headClassMetadataSHA256:sha(readFileSync(headDataFile)),
    sourceSnapshots:areas,sqliteSHA256:source.provenance.sqliteSHA256,
    animalSpecies:ANIMALS,originalObjects:OBJECTS,additionalObjects:OBJECT_TEMPLATES.map(t=>t.key),
    requests:75,attempts:60,fullRotation:true,rankBySimilarity:true,preserveHypotheses:true,maxReturnedPoolPerRequest:8,
    minMeters:3000,maxMeters:8000,maxRepeatRatio:.2,graphDetail:'simple',excludeSteps:true,
    sharedTimeBudgetMs:1170000,testTimeoutMs:1200000,budgetPurpose:'20min safety ceiling with30s final-audit reserve; exhaustion/partial requests remain in denominator75',
    duplicatePolicy:'preserve original550; append each valid intent/geometry hypothesis; record duplicates against source without removing them',
    reviewPolicy:'one retained valid candidate with lowest generator pool rank per request; no semantic model used; null if absent',
    generatorInternalRejectionReasonsAvailable:false,holdoutV2Read:false,original12BenchmarkRead:false,
    currentHeadSupportsAnimals:false,modelInferenceExecuted:false,humanRecognitionMeasured:false,
    learnedHeadAuditStatus:'not performed in this task; auxiliary sketch results are user-reported, not an audited road-recognition result',
    independentHoldout:false,v9RegionsAreDevelopmentData:true,
  };
  const save = (status:'running'|'complete')=>writeFileSync(progress,JSON.stringify({results,counts,scope,reviewSlots,provenance,status,
    sourceCount:550,newCount:results.length-550,completedRequests:counts.length,elapsedSeconds:(performance.now()-began)/1000}));
  save('running');
  const range = (rows:SourceRow[],key:string)=>rows.length?{min:Math.min(...rows.map(r=>Number(r[key]))),max:Math.max(...rows.map(r=>Number(r[key])))}:null;
  for (const area of areas) {
    let state:{g:RoadGraph;region:Region}|null=null,error:string|null=null;
    try {
      const bytes = readFileSync(area.sourceFile);expect(sha(bytes)).toBe(area.roadHash);
      const g = graphFromOverpass(JSON.parse(bytes.toString()),area.bbox,{detail:'simple',excludeSteps:true});
      const [minX,minY] = project(g.origin,area.bbox.south,area.bbox.west),[maxX,maxY] = project(g.origin,area.bbox.north,area.bbox.east);
      state={g,region:{minX,minY,maxX,maxY}};graphs.set(area.area,state);
    } catch(e) {error=e instanceof Error?`${e.name}: ${e.message}`:String(e);}
    for (const template of templates) {
      const requestBegan=performance.now(),info=support.get(template.key)!;
      process.stdout.write(`[v11] START ${area.area} ${template.category} ${template.key}\n`);
      const appended:SourceRow[]=[],strictFailures:Record<string,number>={};
      let count:Record<string,unknown>;
      if(!state) count={area:area.area,proposalShape:template.key,attempts:60,preserveHypotheses:true,coarseSeeds:0,evaluated:0,returned:0,duplicates:0,replaced:0,added:0,
        failures:{},error,partial:true,status:'error',budgetBefore:budget.remaining(),budgetAfter:budget.remaining(),budgetExhausted:!budget.ok()};
      else {
        const proposed=generateObjectProposals(state.g,state.region,[template],{area:area.area,roadHash:area.roadHash,idPrefix:'diversity-v11',attempts:60,preserveHypotheses:true,budget});
        expect(proposed.counts).toHaveLength(1);count={...proposed.counts[0]};
        expect(Number(count.returned)).toBeLessThanOrEqual(8);
        for(const row of proposed.results){
          const check=audit(state.g,state.region,row.path);
          if(check.reasons.length){for(const reason of check.reasons)strictFailures[reason]=(strictFailures[reason]??0)+1;continue;}
          const geometry=String(row.geometryKey),intentGeometry=JSON.stringify([row.proposalShape,geometry]);
          const extended:SourceRow={...row,sourceFile:area.sourceFile,source:'animal-object-diversity-v11',proposalCategory:template.category,
            edgeHash:check.edgeHash,duplicateGeometryOfSourceIds:sourceGeometry.get(geometry)??[],
            duplicateIntentGeometryOfSourceIds:sourceIntentGeometry.get(intentGeometry)??[],
            currentHeadSupported:info.currentHeadSupported,clipVocabularySupported:info.clipVocabularySupported,
            realEdgesChecked:row.path.length-1};
          appended.push(extended);results.push(extended);
        }
      }
      appended.sort((a,b)=>Number(a.proposalPoolRank)-Number(b.proposalPoolRank));
      reviewSlots.push({area:area.area,proposalShape:template.key,category:template.category,
        id:appended[0]?.id??null,proposalPoolRank:appended[0]?.proposalPoolRank??null,
        selection:'generator pool order only; no model score',validRoad:appended.length>0});
      const enriched={...count,category:template.category,validCandidates:appended.length,strictAuditFailures:strictFailures,
        roadGenerationSuccess:appended.length>0,requestOutcome:count.error?'error':count.budgetExhausted?'budget_exhausted':appended.length?'valid_road_candidates':'no_valid_road_candidate',
        sourceGeometryDuplicates:appended.filter(r=>(r.duplicateGeometryOfSourceIds as string[]).length).length,
        sourceIntentGeometryDuplicates:appended.filter(r=>(r.duplicateIntentGeometryOfSourceIds as string[]).length).length,
        nativeDistanceMeters:range(appended,'meters'),projectedDistanceMeters:range(appended,'projectedMeters'),
        nativeRepeatRatio:range(appended,'repeatRatio'),projectedRepeatRatio:range(appended,'projectedRepeatRatio'),
        actualEdgesChecked:appended.reduce((n,r)=>n+r.path.length-1,0),
        currentHeadSupported:info.currentHeadSupported,clipVocabularySupported:info.clipVocabularySupported,
        clipRecommendationClassAllowed:info.clipRecommendationClassAllowed,
        modelSupportIsNotRoadGenerationSuccess:true,humanRecognitionMeasured:false,
        totalRequestSeconds:(performance.now()-requestBegan)/1000};
      counts.push(enriched);save('running');process.stdout.write(`[v11] DONE ${JSON.stringify(enriched)}\n`);
    }
  }
  expect(counts).toHaveLength(75);expect(reviewSlots).toHaveLength(75);
  expect(new Set(counts.map(c=>`${c.area}:${c.proposalShape}`)).size).toBe(75);
  expect(JSON.stringify(results.slice(0,550))).toBe(originalRows);
  expect(results.filter(r=>r.baselineId)).toHaveLength(6);
  expect(new Set(results.map(r=>r.id)).size).toBe(results.length);
  const generated=results.slice(550);expect(generated.length).toBeLessThanOrEqual(600);
  expect(new Set(generated.map(r=>JSON.stringify([r.proposalShape,r.geometryKey]))).size).toBe(generated.length);
  for(const row of results){
    const state=graphs.get(row.area);expect(state,row.id).toBeDefined();if(!state)continue;
    const checked=auditObjectPath(state.g,state.region,row.path);expect(checked.valid,row.id).toBe(true);
    expect(audit(state.g,state.region,row.path).reasons,row.id).toEqual([]);
    expect(row.xy).toEqual(row.path.map(v=>[state.g.x[v],state.g.y[v]]));
    expect(row.latlon).toEqual(row.path.map(v=>[state.g.lat[v],state.g.lon[v]]));
    if(checked.valid){expect(row.meters).toBe(checked.meters);expect(row.repeatRatio).toBe(checked.repeatRatio);
      expect(row.projectedMeters).toBe(checked.projectedMeters);expect(row.projectedRepeatRatio).toBe(checked.projectedRepeatRatio);}
    expect(row.roadHash).toBe(areas.find(a=>a.area===row.area)!.roadHash);
  }
  for(const area of areas){expect(sha(readFileSync(area.sourceFile))).toBe(area.roadHash);expect(results.filter(r=>r.area===area.area&&r.baselineId)).toHaveLength(2);}
  expect(readFileSync(sourceFile)).toEqual(sourceBytes);expect(sha(JSON.stringify(templates))).toBe(templatesSHA256);
  const bySpecies=scope.map(s=>{
    const cases=counts.filter(c=>c.proposalShape===s.key);
    return {key:s.key,name:s.name,category:s.category,requests:cases.length,successfulRoadRequests:cases.filter(c=>c.roadGenerationSuccess).length,
      validCandidates:cases.reduce((n,c)=>n+Number(c.validCandidates),0),errors:cases.filter(c=>c.error).length,
      currentHeadSupported:s.currentHeadSupported,clipVocabularySupported:s.clipVocabularySupported,
      clipRecommendationClassAllowed:s.clipRecommendationClassAllowed,featurePreservationMeasured:false,humanRecognitionMeasured:false};
  });
  const summary={requests:75,sourceCount:550,newCandidates:generated.length,total:results.length,
    animalRequests:counts.filter(c=>c.category==='animal').length,objectRequests:counts.filter(c=>c.category==='object').length,
    successfulRoadRequests:counts.filter(c=>c.roadGenerationSuccess).length,emptyRoadRequests:counts.filter(c=>!c.roadGenerationSuccess).length,
    errors:counts.filter(c=>c.error).length,partialRequests:counts.filter(c=>c.partial).length,budgetExhaustedRequests:counts.filter(c=>c.budgetExhausted).length,
    newAnimalCandidates:generated.filter(r=>r.proposalCategory==='animal').length,newObjectCandidates:generated.filter(r=>r.proposalCategory==='object').length,
    sameIntentGeometryMatchesSource:generated.filter(r=>(r.duplicateIntentGeometryOfSourceIds as string[]).length).length,
    modelIndependentReviewSlots:reviewSlots.length,missingReviewCandidates:reviewSlots.filter(r=>r.id===null).length,
    humanRecognitionMeasured:false,AIRecognitionMeasured:false,semanticInferenceExecuted:false};
  save('complete');renameSync(progress,output);
  const outputSHA256=sha(readFileSync(output));
  writeFileSync(report,JSON.stringify({summary,bySpecies,counts,scope,reviewSlots,provenance,output,outputSHA256,elapsedSeconds:(performance.now()-began)/1000},null,2),{flag:'wx'});
  const table=['# v11 실제 도로 생성·지원 범위 (인식 평가는 미측정)','',
    '| 지역 | 종류 | 범주 | 유효후보 | native m | 투영 m | 최대반복 | 실제간선 검사수 | 시간s | 오류/부분 | head지원 | CLIP사전 |',
    '|---|---|---|---:|---|---|---|---:|---:|---|---|---|',
    ...counts.map(c=>{const n=c.nativeDistanceMeters as {min:number;max:number}|null,p=c.projectedDistanceMeters as {min:number;max:number}|null,r=c.nativeRepeatRatio as {max:number}|null;
      return `| ${c.area} | ${c.proposalShape} | ${c.category} | ${c.validCandidates} | ${n?`${n.min.toFixed(1)}–${n.max.toFixed(1)}`:'—'} | ${p?`${p.min.toFixed(1)}–${p.max.toFixed(1)}`:'—'} | ${r?r.max.toFixed(4):'—'} | ${c.actualEdgesChecked} | ${Number(c.totalRequestSeconds).toFixed(2)} | ${c.error??(c.partial?'partial':'없음')} | ${c.currentHeadSupported?'지원':'미지원'} | ${c.clipVocabularySupported?'있음':'없음'} |`;}),
    '', '모델 미지원은 도로 생성 실패가 아니다. 실제 간선·거리·반복 검사는 사물 인식의 증거가 아니다.',
    '75개 검토 슬롯은 생성기 순위로만 고정했다. 그림 비교/익명 AI 진단/사람 평가는 별도 담당이며 아직 미측정이다.',
    `원본 v9 후보550개·baseline6개 보존. 최종 SHA256: ${outputSHA256}`];
  writeFileSync(tableFile,table.join('\n')+'\n',{flag:'wx'});
  process.stdout.write(`[v11] COMPLETE ${JSON.stringify({...summary,seconds:(performance.now()-began)/1000,outputSHA256})}\n`);
},1200000);
