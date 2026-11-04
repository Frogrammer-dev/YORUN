import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const root = 'eval/recognition/semantic-feature-20261025';
const data = JSON.parse(readFileSync(`${root}/results.json`, 'utf8'));
const mapping = JSON.parse(readFileSync(`${root}/mapping.private.json`, 'utf8')).entries;
if (data.cases.length !== 6 || mapping.length !== 18) throw new Error('Incomplete cohort');
const sha = b => createHash('sha256').update(b).digest('hex');
const summary = ['original', 'uniform', 'feature'].map(mode => {
  const arms = data.cases.map(c => c.arms.find(a => a.mode === mode));
  if (arms.some(a => !a)) throw new Error('Missing arm');
  return { mode, denominator:6, valid:arms.filter(a => a.output.valid).length,
    meanGeometry:arms.reduce((s,a)=>s+a.output.rawSimilarity,0)/6,
    meanFeatureError:arms.reduce((s,a)=>s+a.output.featureDiagnostics.relationObjective,0)/6,
    meanUniformError:arms.reduce((s,a)=>s+a.output.uniformDiagnostics.relationObjective,0)/6,
    attempts:arms.reduce((s,a)=>s+a.diagnostics.attempts,0),
    expanded:arms.reduce((s,a)=>s+a.diagnostics.expanded,0),
    wallMs:arms.reduce((s,a)=>s+a.elapsedMs,0), semanticStatus:'pending independent judgement' };
});
const labels = { original:'기존 기하학 수선', uniform:'균일 윤곽 오차', feature:'식별 특징 가중' };
const cards = data.cases.map((c,i) => `<section><h2>사례 ${i+1}</h2><div class="row">${c.arms.map(a => {
  const entry=mapping.find(m=>m.caseId===c.id&&m.arm===a.mode);
  const png=readFileSync(`${root}/blind/${entry.id}.png`);
  if(sha(png)!==entry.pngHash) throw new Error('Image mismatch');
  return `<figure><figcaption>${labels[a.mode]}</figcaption><img src="data:image/png;base64,${png.toString('base64')}" alt="실제 도로 경로"><p>${(a.output.nativeMeters/1000).toFixed(2)} km</p><details><summary>보조 점수</summary>기하학 ${a.output.rawSimilarity.toFixed(2)} / 100</details></figure>`;
}).join('')}</div></section>`).join('');
const html=`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>식별 특징 실험 비교</title><style>body{font-family:system-ui;margin:24px auto;max-width:1200px;padding:0 16px;background:#f4f6f5;color:#20342c}section{background:white;border-radius:12px;padding:20px;margin:20px 0}.row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}figure{margin:0}img{width:100%;height:auto}figcaption{font-weight:600}p,details{font-size:14px}@media(max-width:650px){.row{grid-template-columns:1fr}}</style><h1>식별 특징을 보존하면 무엇이 달라질까?</h1><p>같은 초기 경로와 배치에서 세 방식을 비교한 개발 실험입니다. 선은 실제 도로이며 북쪽이 위입니다. 이름·꾸밈선은 표시하지 않습니다. 기하학 점수는 사물 인식 확률이 아닙니다. 이 화면은 결과 비교용이며 독립 평가 화면이 아닙니다.</p>${cards}<footer>2026-10-25 · 6조건 × 3방식 · 인식 판정은 별도 보고서 참조</footer></html>`;
mkdirSync('public/eval',{recursive:true});
writeFileSync('public/eval/semantic-feature-20261025.html',html);
mkdirSync('reports/semantic-feature-20261025',{recursive:true});
writeFileSync('reports/semantic-feature-20261025/summary.json',JSON.stringify({sourceHash:sha(readFileSync(`${root}/results.json`)),summary},null,2));
console.log(JSON.stringify(summary,null,2));
