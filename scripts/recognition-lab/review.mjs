import { outlineSvg, shuffled, studyFingerprint } from "../../src/lib/eval/recognitionLab.ts";

// Embedded data must not be able to close a script element.
const embed = (value) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

export function reviewHtml(dataset, files, chosen) {
  const cards = shuffled(chosen).map((c) => {
    const groups = new Map();
    for (const f of files) {
      const p = f.predictions.find((p) => p.candidateId === c.id);
      if (!p?.label) continue;
      if (!groups.has(p.label)) groups.set(p.label, { label: p.label, methods: [] });
      groups.get(p.label).methods.push(f.method);
    }
    return { id: c.id, svg: outlineSvg(c.line, 320), proposals: shuffled([...groups.values()]) };
  });
  const identity = { schemaVersion: 1, datasetId: dataset.id, datasetFingerprint: dataset.fingerprint,
    studyFingerprint: studyFingerprint(files), judgeType: "human" };
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>경로 인식 블라인드 평가</title><style>
*{box-sizing:border-box}body{font:16px/1.65 system-ui,sans-serif;background:#f5f6fa;color:#182035;margin:0}main{max-width:760px;margin:auto;padding:28px 20px}h1{font-size:25px}p{margin:10px 0}.muted{color:#657084;font-size:14px}.card{background:white;border:1px solid #dce1eb;border-radius:18px;padding:24px;margin:20px 0}.image{max-width:340px;margin:auto}.image svg{width:100%;height:auto;display:block}input,select,button{font:inherit;padding:10px;border:1px solid #bcc5d6;border-radius:8px}input[type=text]{width:100%}input[type=checkbox]{width:20px;height:20px;vertical-align:middle}button{cursor:pointer;background:white;margin:6px 6px 6px 0}.primary{background:#175ce0;color:white;border-color:#175ce0}label{display:block;margin:12px 0}.proposal{border-top:1px solid #e0e5ef;padding-top:12px;margin-top:18px}.proposal h3{font-size:18px}select{width:100%}progress{width:100%;height:12px}#error{color:#ab2020;min-height:24px}#phase{font-weight:700}button:disabled{opacity:.5;cursor:default}.toolbar{display:flex;flex-wrap:wrap;gap:8px}#finished{padding:20px;background:#e6f6ec;border-radius:12px}
input[type=file]{width:100%;max-width:100%;font-size:14px;padding:8px}.toolbar>label{width:100%}
</style></head><body><main><h1>이 경로는 무엇처럼 보이나요?</h1>
<p>먼저 이름 없이 모든 선을 보고 답합니다. 답을 잠근 뒤 제안 이름을 평가합니다. 모델·점수는 표시하지 않습니다.</p>
<p class="muted">형태 평가만 합니다. 지도·위치·출처를 제거했습니다. 대조용 그림도 섞여 있습니다. 떠오르는 것이 없으면 ‘아무것도 안 보임’을 선택하세요.</p>
<label>판정자 별명 (동일인은 항상 같은 별명)<input id="who" type="text" maxlength="100" placeholder="별명을 입력하세요"></label>
<div class="toolbar"><button id="export">진행 결과 저장</button><label style="margin:6px 0">저장한 결과 이어하기<input id="restore" type="file" accept="application/json"></label></div>
<p id="phase"></p><progress id="progress" max="1" value="0"></progress><div id="card" class="card"></div>
<button id="next" class="primary">답 잠그고 다음</button><p id="error" role="alert"></p>
<p class="muted">진행은 이 브라우저에 임시 저장됩니다. ‘진행 결과 저장’으로 JSON을 내려받아 실험 폴더의 reviews에 보관하세요. 파일의 이름만 바꾸어 다른 판정자로 중복 제출하지 마세요.</p>
</main><script>
const CARDS=${embed(cards)}, IDENTITY=${embed(identity)};
const key='recognition-review:'+IDENTITY.datasetFingerprint+':'+IDENTITY.studyFingerprint+':'+CARDS.map(c=>c.id).join(',');
let state={who:'',free:{},ratings:{}};
try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved&&saved.free&&saved.ratings)state=saved;}catch{}
const who=document.getElementById('who'),card=document.getElementById('card'),next=document.getElementById('next'),error=document.getElementById('error');who.value=state.who;
const persist=()=>{state.who=who.value.trim();try{localStorage.setItem(key,JSON.stringify(state));}catch{}};
who.oninput=persist;
function currentStep(){const free=CARDS.find(c=>!state.free[c.id]);if(free)return {phase:1,c:free};return {phase:2,c:CARDS.find(c=>c.proposals.length&&!state.ratings[c.id])};}
function element(tag,text){const e=document.createElement(tag);if(text)e.textContent=text;return e;}
function selectQuestion(text,choices,name){const l=element('label',text),s=element('select');s.dataset.field=name;for(const [v,t]of [['','선택하세요'],...choices]){const o=element('option',t);o.value=v;s.appendChild(o);}l.appendChild(s);return l;}
function render(){error.textContent='';const {phase,c}=currentStep();const total=CARDS.length+CARDS.filter(c=>c.proposals.length).length,done=Object.keys(state.free).length+Object.keys(state.ratings).length;
document.getElementById('progress').max=total;document.getElementById('progress').value=done;
document.getElementById('phase').textContent=(phase===1?'1단계 · 자유 인식':'2단계 · 이름 납득')+' — '+done+' / '+total;card.replaceChildren();
if(!c){card.appendChild(element('p','평가가 끝났습니다. 진행 결과를 저장하세요.'));next.disabled=true;return;}
const image=element('div');image.className='image';image.innerHTML=c.svg;card.appendChild(image);
if(phase===1){const l=element('label','무엇처럼 보이나요? (자유롭게, 한두 단어)'),input=element('input');input.type='text';input.id='guess';input.maxLength=300;l.appendChild(input);card.appendChild(l);const none=element('label'),check=element('input');check.type='checkbox';check.id='none';none.append(check,document.createTextNode(' 아무것도 안 보임'));card.appendChild(none);check.onchange=()=>{input.disabled=check.checked;if(check.checked)input.value='';};next.textContent='답 잠그고 다음';}
else{card.appendChild(element('p','잠근 답: '+(state.free[c.id].noShape?'아무것도 안 보임':state.free[c.id].guess)));c.proposals.forEach((p,i)=>{const d=element('section');d.className='proposal';d.dataset.index=i;d.appendChild(element('h3','제안: '+p.label));d.appendChild(selectQuestion('잠근 자유 답과 같은 것을 가리키나요?',[['true','같음'],['false','다름'],['null','동의어·해석이 애매함 (검토 필요)']],'match'));d.appendChild(selectQuestion('이름을 보고도 이 선이 그렇게 보이나요?', [['true','그렇게 보임'],['false','그렇게 보이지 않음']],'recognized'));d.appendChild(selectQuestion('얼마나 납득되나요?', [['1','1 · 전혀'],['2','2'],['3','3'],['4','4'],['5','5 · 매우']],'agree'));card.appendChild(d);});next.textContent='이름 평가 저장하고 다음';}}
next.onclick=()=>{try{if(!who.value.trim())throw Error('판정자 별명을 입력하세요.');const {phase,c}=currentStep();if(!c)return;
if(phase===1){const noShape=document.getElementById('none').checked,guess=document.getElementById('guess').value.trim();if(!noShape&&!guess)throw Error('자유 답 또는 아무것도 안 보임을 선택하세요.');state.free[c.id]={guess,noShape};}
else{const ratings=[];for(const d of card.querySelectorAll('.proposal')){const p=c.proposals[Number(d.dataset.index)],fields=Object.fromEntries([...d.querySelectorAll('select')].map(s=>[s.dataset.field,s.value]));if(Object.values(fields).some(v=>!v))throw Error('모든 이름 평가 질문에 답하세요.');for(const method of p.methods)ratings.push({method,label:p.label,match:fields.match==='null'?null:fields.match==='true',recognized:fields.recognized==='true',agree:Number(fields.agree)});}state.ratings[c.id]=ratings;}
persist();render();}catch(e){error.textContent=e.message;}};
document.getElementById('export').onclick=()=>{if(!who.value.trim()){error.textContent='판정자 별명을 입력하세요.';return;}persist();const items=CARDS.filter(c=>state.free[c.id]).map(c=>({candidateId:c.id,...state.free[c.id],ratings:state.ratings[c.id]||[]}));if(!items.length){error.textContent='최소 한 개의 자유 답을 저장하세요.';return;}const out={...IDENTITY,who:state.who,savedAt:new Date().toISOString(),items};const url=URL.createObjectURL(new Blob([JSON.stringify(out,null,2)],{type:'application/json'})),a=element('a');a.href=url;a.download='review-'+IDENTITY.datasetId+'-'+state.who.replace(/[^a-zA-Z0-9가-힣_-]/g,'_')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.getElementById('restore').onchange=async(e)=>{try{const out=JSON.parse(await e.target.files[0].text());if(out.datasetFingerprint!==IDENTITY.datasetFingerprint||out.studyFingerprint!==IDENTITY.studyFingerprint||out.judgeType!=='human'||!out.who)throw Error('다른 실험의 결과입니다.');const free={},ratings={};for(const item of out.items){const c=CARDS.find(c=>c.id===item.candidateId);if(!c)throw Error('이 평가 화면에 없는 경로가 포함되어 있습니다.');if(typeof item.noShape!=='boolean'||typeof item.guess!=='string'||(!item.noShape&&!item.guess.trim()))throw Error('잘못된 자유 판정입니다.');free[c.id]={guess:item.guess,noShape:item.noShape};if(item.ratings.length){for(const r of item.ratings)if(!c.proposals.some(p=>p.label===r.label&&p.methods.includes(r.method))||typeof r.recognized!=='boolean'||![true,false,null].includes(r.match)||![1,2,3,4,5].includes(r.agree))throw Error('잘못된 이름 판정입니다.');if(item.ratings.length!==c.proposals.reduce((n,p)=>n+p.methods.length,0))throw Error('불완전한 이름 판정입니다.');ratings[c.id]=item.ratings;}}state={who:out.who,free,ratings};who.value=out.who;persist();render();}catch(e){error.textContent=e.message;}};
render();
</script></body></html>`;
}

export function comparisonHtml(dataset, files) {
  const cards = dataset.candidates.map((c) => ({ id: c.id, condition: c.condition, source: c.source, split: c.split,
    svg: outlineSvg(c.line), predictions: files.map((f) => ({ method: f.method, ...f.predictions.find((p) => p.candidateId === c.id) })) }));
  return String.raw`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>경로 인식 실험 비교</title>
<style>body{font:15px system-ui;margin:24px;color:#182035;background:#f5f6fa}section{background:#fff;padding:18px;border-radius:12px;margin:12px 0;display:flex;gap:20px;flex-wrap:wrap}.image{width:224px}svg{width:100%;height:auto}pre{white-space:pre-wrap}img{width:140px;image-rendering:pixelated}select,input{padding:10px;font:inherit}</style>
<h1>경로 인식 실험 비교</h1><p>분석자용 화면입니다. 사람 블라인드 평가 전에 판정자에게 보여주지 마세요. 점수는 사람 인식 확률이 아닙니다.</p>
<label>조건 <select id="filter"><option value="">전체</option></select></label> <label>이름 검색 <input id="search"></label><div id="cards"></div>
<script>const CARDS=${embed(cards)};const filter=document.getElementById('filter');for(const condition of [...new Set(CARDS.map(c=>c.condition))]){const o=document.createElement('option');o.value=condition;o.textContent=condition;filter.appendChild(o);}function render(){const root=document.getElementById('cards');root.replaceChildren();const q=document.getElementById('search').value;for(const c of CARDS.filter(c=>(!filter.value||c.condition===filter.value)&&(!q||c.predictions.some(p=>p.label?.includes(q))))){const s=document.createElement('section'),image=document.createElement('div'),text=document.createElement('div');image.className='image';image.innerHTML=c.svg;const h=document.createElement('h3');h.textContent=c.id+' · '+c.source+' · '+c.split;text.appendChild(h);for(const p of c.predictions){const pre=document.createElement('pre');pre.textContent=p.method+': '+(p.label??'미측정 / 거절')+' · raw '+(p.rawScore??'-')+' · '+(p.accepted?'표시 대상':'표시 제외')+'\n'+(p.topK||[]).map(r=>r.label+' '+r.score.toFixed(3)+(r.excluded?' (제외 클래스)':'')).join(', ');text.appendChild(pre);}for(const variant of ['binary','gray']){const a=document.createElement('a');a.href='pixels/'+variant+'/'+c.id+'.json';a.textContent=variant+' 28×28 실제 입력';a.style.marginRight='12px';const img=document.createElement('img');img.src='images/'+variant+'-'+c.id+'.png';img.alt=variant+' 모델 입력';img.onerror=()=>img.remove();a.appendChild(img);text.appendChild(a);}s.append(image,text);root.appendChild(s);}}filter.onchange=render;document.getElementById('search').oninput=render;render();</script></html>`;
}
