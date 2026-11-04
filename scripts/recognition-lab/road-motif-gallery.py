"""Produce a diagnostic gallery and a compact visual inspection sheet."""
import json
from pathlib import Path
from html import escape
from PIL import Image, ImageDraw

root=Path(__file__).resolve().parents[2]
data=json.loads((root/'eval/recognition/road-motif-20261028/results.json').read_text())
names={'control':'기존 배치 주변 탐색','roadMotif':'도로 꺾임 배치 + 핵심 구간 보존','roadPoseOnly':'동일 도로 배치만 사용'}
def coords(points,size=280):
    xs,ys=zip(*points);cx=(max(xs)+min(xs))/2;cy=(max(ys)+min(ys))/2;s=(size-30)/max(max(xs)-min(xs),max(ys)-min(ys),1e-9)
    return [(size/2+(x-cx)*s,size/2-(y-cy)*s) for x,y in points]
def svg(points):
    if not points:return '<p>유효 출력 없음</p>'
    pts=' '.join(f'{x:.2f},{y:.2f}' for x,y in coords(points))
    return f'<svg viewBox="0 0 280 280"><polyline points="{pts}" fill="none" stroke="#193650" stroke-width="3"/></svg>'
rows=data['results'];cards=[];details=[]
# Interleave methods/cases deterministically; this is not an independent blind trial.
order=sorted(range(len(rows)),key=lambda i:(i*7)%19)
sheet=Image.new('RGB',(840,6*320),'white');draw=ImageDraw.Draw(sheet)
for j,r in enumerate(rows):
    col=j%3;row=j//3;o=r['output']
    draw.text((col*280+10,row*320+5),f'{r["id"]} / {r["method"]}',fill='black')
    if o:draw.line([(x+col*280,y+row*320+25) for x,y in coords(o['xy'])],fill='#193650',width=3)
    else:draw.text((col*280+40,row*320+130),'NO VALID OUTPUT',fill='red')
for n,j in enumerate(order,1):
    r=rows[j];o=r['output']
    cards.append(f'<article><h2>경로 {n:02}</h2>{svg(o["xy"] if o else None)}</article>')
    details.append(f'<tr><td>{n:02}</td><td>{escape(r["id"])}</td><td>{escape(r["shapeId"])}</td><td>{names[r["method"]]}</td><td>{o["objective"]:.5f}</td></tr>' if o else f'<tr><td>{n:02}</td><td>{escape(r["id"])}</td><td>{r["shapeId"]}</td><td>{names[r["method"]]}</td><td>실패</td></tr>')
html='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>도로 꺾임 기반 배치 비교</title><style>body{font-family:system-ui;background:#edf3f8;color:#193650;margin:30px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}article{background:white;border-radius:14px;padding:20px}svg{width:100%;max-width:350px}td,th{padding:10px;border-bottom:1px solid #ccc}summary{cursor:pointer;font-size:22px;margin:25px 0}</style><h1>도로 꺾임 기반 배치 · 3방식 비교</h1><p>먼저 이름 없이 경로를 살펴보세요. 유효 경로 생성과 사물 인식은 다른 평가입니다. 이 페이지는 같은 대상의 여러 결과를 포함한 진단용이며 독립 블라인드 시험이 아닙니다.</p><div class="grid">'''+''.join(cards)+'''</div><details><summary>대상·방식·선택오차 확인</summary><p>오차는 작을수록 기준선에 가깝다는 뜻이며 인식률/원본 100점 점수가 아닙니다.</p><table><tr><th>번호</th><th>조건</th><th>대상</th><th>방식</th><th>정규화 오차</th></tr>'''+''.join(details)+'</table></details></html>'
(root/'public/eval/road-motif-20261028.html').write_text(html,encoding='utf-8')
sheet.save(root/'eval/recognition/road-motif-20261028/montage.png')
print(json.dumps(data['summary']))
for method in names:
    r=[r for r in rows if r['method']==method and r['output']]
    common=[r for r in r if any(s['id']==r['id'] and s['method']=='control' and s['output'] for s in rows)]
    print(method,'common5mean',sum(x['output']['objective'] for x in common)/len(common),'validCandidates',sum(x['validCandidates'] for x in r))
    print([(x['id'],round(x['output']['objective'],5)) for x in r])
