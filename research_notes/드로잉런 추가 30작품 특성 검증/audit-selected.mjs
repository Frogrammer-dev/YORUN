import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const rows=read('selected_30.json'),summary=read('summary.json');
assert.equal(rows.length,30);assert.equal(new Set(rows.map(x=>x.id)).size,30);
const prior=new Set(['1598374796','1396716975','5517952512','8943283545']);
for(const x of rows){assert(!prior.has(x.activity_id));assert(!/death.?star|c.?3po/i.test(x.title));for(const k of ['source_url','image_url','run_evidence','visual_method','visual_scope','parts_evidence'])assert(x[k],x.id+': '+k);}
const known=rows.filter(x=>x.activity_id);assert.equal(new Set(known.map(x=>x.activity_id)).size,known.length);assert.equal(new Set(rows.map(x=>x.image_url)).size,30);
for(const k of Object.keys(summary.morphology)){const counts=Object.fromEntries(['yes','no','uncertain'].map(v=>[v,rows.filter(x=>x[k]===v).length]));assert.deepEqual(counts,summary.morphology[k]);assert.equal(Object.values(counts).reduce((a,b)=>a+b),30);}
assert.equal(rows.filter(x=>x.distance_km!==null).length,summary.distance.known);assert.equal(rows.filter(x=>x.distance_km===null).length,summary.distance.unknown);
for(const [bin,fn] of [['within_3_8',n=>n>=3&&n<=8],['above_8',n=>n>8],['below_3',n=>n<3]])assert.deepEqual(rows.filter(x=>x.id!=='A08'&&x.distance_km!==null&&fn(x.distance_km)).map(x=>x.id),summary.distance[bin]);
for(const level of ['R1','R2'])assert.equal(rows.filter(x=>x.run_evidence_level===level).length,summary.run_evidence[level]);
assert.deepEqual(Object.fromEntries([...new Set(rows.map(x=>x.creator_group))].map(k=>[k,rows.filter(x=>x.creator_group===k).length])),summary.creator_groups);
assert(!rows.some(x=>['C05','AR02','BR01','BR02'].includes(x.id)));assert(rows.some(x=>x.id==='AR01'));
const report=fs.readFileSync(path.join(root,'../../reports/드로잉런 추가 30작품 특성 검증.md'),'utf8');for(const x of rows)assert(report.includes('|'+x.id+' '+x.title.replaceAll('|','/')));
console.log(JSON.stringify({checks:'PASS',n:30,counts:summary.morphology,distance:summary.distance,run:summary.run_evidence,creator_labels:Object.keys(summary.creator_groups).length},null,2));
