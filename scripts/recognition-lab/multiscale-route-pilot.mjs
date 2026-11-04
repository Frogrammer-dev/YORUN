import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const source = 'eval/recognition/semantic-feature-20261025/results.json';
const shapeFile = 'src/lib/route/shapes.ts';
const out = 'eval/recognition/multiscale-route-20261027';
const sourceBytes = readFileSync(source), shapeBytes = readFileSync(shapeFile);
const data = JSON.parse(sourceBytes.toString());
const sha = value => createHash('sha256').update(value).digest('hex');
const sigmas = [0, 2, 4, 8], size = 400;
mkdirSync(out, { recursive:true });
const protocol = {
  hypothesis:'Multi-scale foreground overlap changes ranking of frozen real routes toward gross outline agreement; does not establish object recognition.',
  source, sourceHash:sha(sourceBytes), shapeFile, shapeHash:sha(shapeBytes), scriptHash:sha(readFileSync(import.meta.filename)),
  cases:6, candidatesPerCase:3, sigmas, pixels:size, strokePixels:3,
  score:'Mean foreground cosine over sigma 0,2,4,8; blank score 0; no background pixel agreement; no learned model.',
  display:'Common per-case square viewport enclosing all three paths and fixed-pose reference; 24px margin, north up. No contrast auto normalization. 64px auxiliary thumbnail.',
  negatives:'blank,circle,square,seeded random polyline; nonblank control float masks L1-normalized to reference ink before scoring (cosine scale invariant).',
  selection:'Highest mean multi-scale score among three frozen routes, stable mode tie break. Compare to highest original geometric score among same three. No generation or app integration.',
  semanticEvaluation:'Not performed by this script. Proxy ranking only; controls are not extra real-road cases.',
  paidApiCalls:0, parametersFrozenBeforeScoring:true,
};
writeFileSync(`${out}/protocol.json`, JSON.stringify(protocol,null,2));

function shapePoints(id) {
  const match = shapeBytes.toString().match(new RegExp(`id: "${id}"[^\\n]*raw: fromScreen\\((\\[\\[.*?\\]\\])\\)`));
  if (!match) throw new Error(`Unsupported source outline ${id}`);
  const raw = JSON.parse(match[1]).map(([x,y])=>[x,100-y]);
  const xs=raw.map(p=>p[0]), ys=raw.map(p=>p[1]);
  const loX=Math.min(...xs),hiX=Math.max(...xs),loY=Math.min(...ys),hiY=Math.max(...ys),scale=Math.max(hiX-loX,hiY-loY);
  const normalized=raw.map(([x,y])=>[(x-(hiX+loX)/2)/scale,(y-(hiY+loY)/2)/scale]);
  normalized.push([...normalized[0]]);
  return normalized;
}
function project(c, latlngs) {
  const lat0=(c.bbox.north+c.bbox.south)/2,lon0=(c.bbox.east+c.bbox.west)/2,r=Math.PI/180;
  return latlngs.map(([lat,lon])=>[6371000*Math.cos(lat0*r)*(lon-lon0)*r,6371000*(lat-lat0)*r]);
}
function placed(points,p) {
  const angle=p.rotDeg*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return points.map(([x,y])=>[p.cx+p.scale*(x*c-y*s),p.cy+p.scale*(x*s+y*c)]);
}
function svg(points) {
  const d=points.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(5)},${y.toFixed(5)}`).join(' ');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round"/></svg>`);
}
async function variants(points) {
  const original=await sharp(svg(points)).png().toBuffer();
  const list=[];
  for(const sigma of sigmas) {
    const pipeline=sharp(original);
    if(sigma) pipeline.blur(sigma);
    const png=await pipeline.png().toBuffer();
    const gray=await sharp(png).greyscale().raw().toBuffer();
    list.push({sigma,png,mask:Float64Array.from(gray,v=>(255-v)/255)});
  }
  return {list,thumbnail:await sharp(original).resize(64,64).png().toBuffer()};
}
function cosine(a,b) {
  assert.equal(a.length,b.length);
  let aa=0,bb=0,ab=0;
  for(let i=0;i<a.length;i++){aa+=a[i]*a[i];bb+=b[i]*b[i];ab+=a[i]*b[i];}
  return aa<1e-12||bb<1e-12?0:ab/Math.sqrt(aa*bb);
}
function sum(a){return a.reduce((s,v)=>s+v,0);}
function equalInk(a,target){const factor=sum(target)/(sum(a)||1);return Float64Array.from(a,v=>v*factor);}
assert.equal(cosine([0,0],[1,0]),0);
assert.equal(cosine([1,0],[1,0]),1);
assert.equal(cosine([1,0],[0,1]),0);
assert.ok(Math.abs(cosine([.2,.4],[.2,.4])-1)<1e-12);
assert.ok(Math.abs(cosine([.2,.4],[.1,.9])-cosine([2,4],[.1,.9]))<1e-12);

const cases=[],cards=[];
const labels={original:'기존 기하학 수선',uniform:'균일 오차 수선',feature:'특징 가중 수선'};
const img=b=>`data:image/png;base64,${b.toString('base64')}`;
for(const [caseIndex,c] of data.cases.entries()) {
  assert.equal(c.arms.length,3);
  const p=c.baseline.placement,reference=placed(shapePoints(c.shapeId),p);
  const paths=c.arms.map(a=>{assert.ok(a.output?.valid);assert.deepEqual(a.output.placement,p);return project(c,a.output.latlngs);});
  const all=[reference,...paths].flat(),xs=all.map(v=>v[0]),ys=all.map(v=>v[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const span=Math.max(maxX-minX,maxY-minY),cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const screen=points=>points.map(([x,y])=>[200+(x-cx)/span*352,200-(y-cy)/span*352]);
  const ref=await variants(screen(reference)),arms=[];
  for(const [i,a] of c.arms.entries()) {
    const v=await variants(screen(paths[i]));
    const scores=v.list.map((item,k)=>cosine(item.mask,ref.list[k].mask));
    for(const item of v.list) writeFileSync(`${out}/${c.id}-${a.mode}-sigma${item.sigma}.png`,item.png);
    writeFileSync(`${out}/${c.id}-${a.mode}-64.png`,v.thumbnail);
    arms.push({mode:a.mode,geometry:a.output.rawSimilarity,scores,mean:sum(scores)/scores.length,pathHash:sha(JSON.stringify(a.output.path))});
    cards.push(`<section><h2>사례 ${caseIndex+1} · ${labels[a.mode]}</h2><div class="row">${v.list.map(item=>`<figure><img src="${img(item.png)}" alt="실제 경로 흐림 ${item.sigma}"><figcaption>흐림 σ=${item.sigma}</figcaption></figure>`).join('')}</div><p>작은 크기 그대로 보기: <img class="thumb" src="${img(v.thumbnail)}" width="64" height="64" alt="64픽셀 경로"></p><details><summary>보조 지표</summary>다중 크기 윤곽 겹침 ${arms.at(-1).mean.toFixed(4)} · 기하학 ${a.output.rawSimilarity.toFixed(2)}. 인식 확률이 아닙니다.</details></section>`);
  }
  let seed=20261027+caseIndex;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const circle=Array.from({length:97},(_,i)=>[200+140*Math.cos(i/96*2*Math.PI),200+140*Math.sin(i/96*2*Math.PI)]);
  const randomLine=Array.from({length:18},()=>[40+320*random(),40+320*random()]);randomLine.push(randomLine[0]);
  const controls=[];
  for(const [name,points] of [['circle',circle],['square',[[60,60],[340,60],[340,340],[60,340],[60,60]]],['seededRandom',randomLine]]) {
    const v=await variants(points);
    const scores=v.list.map((item,k)=>cosine(equalInk(item.mask,ref.list[k].mask),ref.list[k].mask));
    controls.push({name,scores,mean:sum(scores)/scores.length});
  }
  const blank=new Float64Array(size*size);
  assert.ok(ref.list.every(v=>cosine(blank,v.mask)===0&&Math.abs(cosine(v.mask,v.mask)-1)<1e-12));
  controls.push({name:'blank',scores:[0,0,0,0],mean:0});
  const winner=key=>[...arms].sort((a,b)=>b[key]-a[key]||a.mode.localeCompare(b.mode))[0].mode;
  const sharpWinner=[...arms].sort((a,b)=>b.scores[0]-a.scores[0]||a.mode.localeCompare(b.mode))[0].mode;
  cases.push({id:c.id,shapeId:c.shapeId,viewport:{cx,cy,span},arms,controls,originalWinner:winner('geometry'),sharpWinner,multiscaleWinner:winner('mean'),negativeBeatsBestBySigma:sigmas.map((sigma,k)=>({sigma,beats:Math.max(...controls.map(v=>v.scores[k]))>Math.max(...arms.map(v=>v.scores[k]))}))});
}
assert.equal(sha(readFileSync(source)),protocol.sourceHash);
assert.equal(sha(readFileSync(shapeFile)),protocol.shapeHash);
const summary={denominator:6,changedSelections:cases.filter(c=>c.originalWinner!==c.multiscaleWinner).length,
  changedSelectionsVsSharp:cases.filter(c=>c.sharpWinner!==c.multiscaleWinner).length,
  selectedMeanSharpCosine:sum(cases.map(c=>c.arms.find(a=>a.mode===c.multiscaleWinner).scores[0]))/6,
  selectedMeanGeometry:sum(cases.map(c=>c.arms.find(a=>a.mode===c.multiscaleWinner).geometry))/6,
  geometryWinnerMean:sum(cases.map(c=>c.arms.find(a=>a.mode===c.originalWinner).geometry))/6,
  negativeControlBeatsSelected:cases.filter(c=>Math.max(...c.controls.map(v=>v.mean))>Math.max(...c.arms.map(v=>v.mean))).length,
  semanticStatus:'unmeasured',newRoadGeneration:false,appIntegrated:false};
writeFileSync(`${out}/results.json`,JSON.stringify({protocol,summary,cases},null,2));
mkdirSync(`${out}/blind`,{recursive:true});
const selectedMapping=[...cases].sort((a,b)=>sha(a.id).localeCompare(sha(b.id))).map((c,i)=>{
  const id=`S${String(i+1).padStart(2,'0')}`,mode=c.multiscaleWinner;
  const raw=readFileSync(`${out}/${c.id}-${mode}-sigma0.png`),thumbnail=readFileSync(`${out}/${c.id}-${mode}-64.png`);
  writeFileSync(`${out}/blind/${id}.png`,raw);
  writeFileSync(`${out}/blind/${id}-64.png`,thumbnail);
  return {id,caseId:c.id,mode,rawHash:sha(raw),thumbnailHash:sha(thumbnail)};
});
writeFileSync(`${out}/mapping.private.json`,JSON.stringify({selectedMapping},null,2));
mkdirSync('public/eval',{recursive:true});
writeFileSync('public/eval/multiscale-route-20261027.html',`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>멀리서 보는 실제 경로 실험</title><style>body{font-family:system-ui;max-width:1200px;margin:30px auto;padding:0 16px;background:#f5f7f6;color:#24382e}section{background:white;padding:20px;border-radius:12px;margin:20px 0}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}figure{margin:0}figure img{width:100%}figcaption{font-size:13px}.thumb{vertical-align:middle;width:64px;height:64px}@media(max-width:700px){.row{grid-template-columns:repeat(2,1fr)}}</style><h1>멀리서 보아도 사물처럼 보일까?</h1><p>실제 도로 경로 18개를 원본·흐림·작은 크기로 비교합니다. 경로를 바꾸거나 채색하지 않았습니다. 흐림은 표시 처리이고 착시 생성 AI가 아닙니다. 원본에서 알아볼 수 있는지가 최종 기준이며, 이 비교 화면은 블라인드 평가가 아닙니다.</p><p>기존 6조건의 3후보 재정렬 실험입니다. 새로운 도로 생성이나 인식 정확도 개선을 입증한 결과는 아닙니다.</p>${cards.join('')}</html>`);
console.log(JSON.stringify(summary,null,2));
