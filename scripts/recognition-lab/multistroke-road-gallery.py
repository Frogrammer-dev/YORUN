"""Compare frozen restored strokes and full executable graph walks."""
import json
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'eval/recognition/multistroke-road-20261029'
data=json.loads((OUT/'results.json').read_text())
def transform(strokes):
    p=[p for s in strokes for p in s];xs,ys=zip(*p);cx=(max(xs)+min(xs))/2;cy=(max(ys)+min(ys))/2;s=250/max(max(xs)-min(xs),max(ys)-min(ys),1e-9)
    return lambda p:(150+(p[0]-cx)*s,150-(p[1]-cy)*s)
def svg(strokes,orange=None):
    t=transform(strokes);body=''
    for seq,color in [(strokes,'#173a57'),(orange or [],'#d45b0b')]:
        for s in seq:
            coords=' '.join(f'{t(p)[0]:.2f},{t(p)[1]:.2f}' for p in s)
            body+=f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="2.5"/>'
    return '<svg viewBox="0 0 300 300">'+body+'</svg>'
cards=[];montage=Image.new('RGB',(900,9*330),'white');draw=ImageDraw.Draw(montage)
for i,r in enumerate(data['results']):
    o=r['output'];status='거리·반복 기준 통과' if r['valid'] else '실패 진단용 · 추천 아님'
    if not o:cards.append(f'<article>{r["area"]} {r["class"]}: 연결 실패</article>');continue
    groups=[r['source'],[o['xy']],[o['xy']]]
    for j,strokes in enumerate(groups):
        t=transform(strokes);draw.text((j*300+5,i*330+5),f'{r["area"]} {r["class"]} '+['restored','full route','connectors'][j],fill='black')
        for ss,color in [(strokes,'#173a57'),(o['connectors'] if j==2 else [],'#d45b0b')]:
            for s in ss:
                if len(s)>1:draw.line([(t(p)[0]+j*300,t(p)[1]+i*330+25) for p in s],fill=color,width=2)
    cards.append(f'<article><h2>{r["area"]} · {r["class"]}</h2><b>{status}</b><p>거리 {o["meters"]/1000:.2f}km · 반복 {o["repeatRatio"]*100:.1f}% · 획 사이 연결 {o["connectorMeters"]/1000:.2f}km · 한 노드로 축소된 획 {o["collapsedStrokes"]}개</p><div class="row"><section>복원 그림{svg(r["source"])}</section><section>전체 실제 주행 경로{svg([o["xy"]])}</section><section>같은 경로 · 주황색은 획 사이 이동{svg([o["xy"]],o["connectors"])}</section></div><p>통과 후보 {r["validCandidates"]}/27 · 선택 결과 실패 사유: {", ".join(o["reasons"]) or "없음"}</p></article>')
html='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>다중 획 복원 → 실제 도로</title><style>body{font-family:system-ui;background:#eef3f6;margin:25px;color:#173a57}article{background:white;margin:18px 0;padding:20px;border-radius:12px}.row{display:flex;flex-wrap:wrap;gap:12px}section{flex:1;min-width:260px}svg{width:100%;max-width:400px}</style><h1>복원 그림을 실제 도로에 연결</h1><p>3그림 × 3지역, 243배치 중 3/9조건이 거리3–8km·반복20% 기준 통과. 6개 실패도 그대로 표시합니다. 통과는 사물 인식 성공을 뜻하지 않습니다. 주황색도 실제로 달려야 하는 경로이며 전체 그림과 거리에서 제외하지 않았습니다. 원본 획순서 고정, 그림당 크기 탐색 없음.</p>'''+''.join(cards)+'</html>'
(ROOT/'public/eval/multistroke-road-20261029.html').write_text(html,encoding='utf-8');montage.save(OUT/'montage.png')
montage.crop((0,0,900,990)).save(OUT/'preview-daejeon.png')
print('gallery written; cases:',len(cards))
