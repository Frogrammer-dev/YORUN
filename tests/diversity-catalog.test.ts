import {expect,it} from 'vitest';
import {DIVERSITY_CATALOG,diversityModelCoverage} from '@/lib/route/diversityCatalog';
import {SHAPE_BY_ID} from '@/lib/route/shapes';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';

it('retains all eleven animal and fourteen object hypotheses without changing original shapes',()=>{
  expect(DIVERSITY_CATALOG).toHaveLength(25);
  expect(new Set(DIVERSITY_CATALOG.map(r=>r.key)).size).toBe(25);
  expect(DIVERSITY_CATALOG.filter(r=>r.kind==='animal')).toHaveLength(11);
  expect(DIVERSITY_CATALOG.filter(r=>r.kind==='object')).toHaveLength(14);
  expect(DIVERSITY_CATALOG.find(r=>r.key==='dog')!.shape).toBe(SHAPE_BY_ID.dog);
  expect(DIVERSITY_CATALOG.find(r=>r.key==='fish')!.shape.points).toEqual(SHAPE_BY_ID.fish.points);
  for(const item of DIVERSITY_CATALOG){
    expect(item.shape.points[0]).toEqual(item.shape.points.at(-1));
    expect(item.identifyingFeatures.length).toBeGreaterThan(0);
    expect(item.roadRisk.length).toBeGreaterThan(0);
    expect(item.ambiguity.length).toBeGreaterThan(0);
    expect(item.freeNameAliases.length).toBeGreaterThan(0);
  }
});

it('does not confuse unsupported animal labels with road generation failure',()=>{
  const coverage=diversityModelCoverage(new Set(['dog','fish','cat','coffee_cup']),new Set(['coffee_cup']));
  expect(coverage.find(r=>r.key==='dog')).toMatchObject({clipSupported:true,headSupported:false});
  expect(coverage.find(r=>r.key==='mug')).toMatchObject({clipSupported:true,headSupported:true});
  expect(coverage.find(r=>r.key==='rocket')).toMatchObject({clipSupported:false,headSupported:false});
});

it.skipIf(!process.env.ROAD_DIVERSITY_CATALOG)('freezes the full review catalog with actual model coverage',()=>{
  const folder='eval/recognition/road-ranker-20261102';mkdirSync(folder,{recursive:true});
  const vocabulary=readFileSync('src/lib/art/clipVocabulary.json');
  const head=readFileSync('reports/road-ranker-20261102/sketch-head-v10-train.json');
  const labels=JSON.parse(head.toString()).classLabels as {key:string;object:boolean}[];
  const names=JSON.parse(vocabulary.toString()) as {english:string}[];
  const coverage=diversityModelCoverage(new Set(names.map(c=>c.english)),new Set(labels.filter(c=>c.object).map(c=>c.key)));
  const sha=(data:Buffer|string)=>createHash('sha256').update(data).digest('hex');
  const result={catalog:DIVERSITY_CATALOG.map(item=>({...item,...coverage.find(c=>c.key===item.key)})),
    clipVocabularySHA256:sha(vocabulary),headReportSHA256:sha(head),catalogCodeSHA256:sha(readFileSync('src/lib/route/diversityCatalog.ts')),
    annotationBasis:'Template structure hypotheses; not measured human recognition',humanRecognitionMeasured:false};
  expect(result.catalog.filter(c=>c.kind==='animal'&&c.headSupported)).toHaveLength(0);
  expect(result.catalog.filter(c=>c.kind==='animal'&&c.clipSupported)).toHaveLength(11);
  writeFileSync(`${folder}/diversity-catalog-v11-review.json`,JSON.stringify(result),{flag:'wx'});
});
