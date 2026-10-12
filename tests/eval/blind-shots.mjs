// 블라인드 판정 세트의 썸네일(PNG)과 사람 판정 페이지를 만든다: node tests/eval/blind-shots.mjs
// 설치된 Chrome으로 그린다 (Playwright 전용 브라우저를 따로 받지 않아도 된다).
// 출력: eval/blind/images/cNN.png (캡션 없음), eval/blind/judge.html (사람 판정 2단계 페이지)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const DIR = "eval/blind";
const items = JSON.parse(readFileSync(`${DIR}/items.json`, "utf8"));
const key = JSON.parse(readFileSync(`${DIR}/key.json`, "utf8"));

/** 코스 선 → 정사각형 SVG (북쪽이 위, 가로세로 비율 유지) */
function svg(line, size = 320, pad = 24, stroke = 3) {
  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const k = (size - 2 * pad) / span;
  const ox = pad + (size - 2 * pad - (maxX - minX) * k) / 2, oy = pad + (size - 2 * pad - (maxY - minY) * k) / 2;
  const pts = line.map(([x, y]) => `${(ox + (x - minX) * k).toFixed(1)},${(oy + (maxY - y) * k).toFixed(1)}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="#fff"/><polyline points="${pts}" fill="none" stroke="#111" stroke-width="${stroke}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

mkdirSync(`${DIR}/images`, { recursive: true });
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 320, height: 320 } });
for (const it of items) {
  await page.setContent(`<body style="margin:0">${svg(it.line)}</body>`);
  await page.screenshot({ path: `${DIR}/images/${it.id}.png`, clip: { x: 0, y: 0, width: 320, height: 320 } });
}
await browser.close();

// 사람 판정 페이지: 1단계 '무엇으로 보이나요?'(정답 숨김) → 모두 답한 뒤 2단계 정답 공개·납득 점수
const names = Object.fromEntries(key.map((k) => [k.id, k.name]));
const cards = items.map((it) => ({ id: it.id, svg: svg(it.line, 220, 16, 2.5) }));
writeFileSync(
  `${DIR}/judge.html`,
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>코스 그림 판정</title>
<style>
:root{--bg:#fafafa;--fg:#111;--card:#fff;--line:#ddd;--accent:#e85d04}
body{font:15px system-ui,sans-serif;margin:16px;background:var(--bg);color:var(--fg)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px}
.card svg{width:100%;height:auto;display:block}
input[type=text]{width:100%;box-sizing:border-box;padding:6px;font:inherit}
.step2{display:none;margin-top:6px}.reveal .step2{display:block}.reveal input[type=text]{pointer-events:none;background:#f0f0f0}
.ans{color:var(--accent);font-weight:600}
button{font:inherit;padding:10px 14px;margin:12px 8px 12px 0;border-radius:8px;border:1px solid #999;background:#fff}
</style>
<h1>이 선은 무엇처럼 보이나요?</h1>
<p>달리기 코스 모양 ${cards.length}개입니다. 떠오르는 것을 한두 단어로 적어 주세요. 모르겠으면 비워 두세요. 다 적은 뒤 아래 <b>정답 보기</b>를 누르면, 의도한 그림을 보고 "그렇게 보인다"를 1~5점으로 매깁니다.</p>
<p><label>판정자 이름(별명) <input id="who" type="text" style="width:12em"></label></p>
<div class="grid" id="g"></div>
<button id="reveal">정답 보기 (1단계 끝)</button><button id="save">결과 저장 (JSON)</button>
<script>
const cards=${JSON.stringify(cards)};const names=${JSON.stringify(names)};
const g=document.getElementById("g");
for(const c of cards){const d=document.createElement("div");d.className="card";d.innerHTML=c.svg+'<input type="text" data-id="'+c.id+'" placeholder="무엇처럼 보이나요?"><div class="step2">의도: <span class="ans"></span><br>자유 답이 같은 대상을 가리키나요? <select data-match="'+c.id+'"><option value="">선택</option><option value="true">같음</option><option value="false">다름 / 모르겠음</option></select><br>그렇게 보인다: <select data-id="'+c.id+'"><option value="">-</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select></div>';d.querySelector('.ans').textContent=names[c.id];g.appendChild(d);}
document.getElementById("reveal").onclick=()=>{if(confirm("정답을 보면 1단계 답은 고칠 수 없어요. 계속할까요?")){document.querySelectorAll('input[data-id]').forEach(i=>i.readOnly=true);document.body.classList.add("reveal");}};
document.getElementById("save").onclick=()=>{if(!document.body.classList.contains('reveal')||cards.some(c=>!document.querySelector('select[data-match="'+c.id+'"]').value||!document.querySelector('select[data-id="'+c.id+'"]').value)){alert('정답 공개 후 모든 맞힘·납득 판정을 선택하세요.');return;}const out={who:document.getElementById("who").value,judgeType:'human',items:cards.map(c=>({id:c.id,guess:document.querySelector('input[data-id="'+c.id+'"]').value.trim(),match:document.querySelector('select[data-match="'+c.id+'"]').value==='true',agree:Number(document.querySelector('select[data-id="'+c.id+'"]').value)}))};const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([JSON.stringify(out,null,1)],{type:"application/json"}));a.download="blind-"+(out.who||"anon")+".json";a.click();};
</script>`,
);
console.log(`썸네일 ${items.length}개 → ${DIR}/images/, 사람 판정 페이지 → ${DIR}/judge.html`);
