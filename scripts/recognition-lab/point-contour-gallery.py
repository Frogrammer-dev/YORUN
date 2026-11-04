"""Road diagnostic gallery; each case shares one viewport across all methods."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

root=Path('eval/recognition/point-contour-20261028')
data=json.loads((root/'road-results.json').read_text())['results']
ids=list(dict.fromkeys(r['id'] for r in data))
canvas=Image.new('RGB',(1080,len(ids)*280),'white');draw=ImageDraw.Draw(canvas)
cards=[]
for row,case in enumerate(ids):
    group=[r for r in data if r['id']==case]
    points=np.array([p for r in group for p in (r['xy'] or [])+r['outline']])
    center=(points.min(0)+points.max(0))/2;extent=np.ptp(points,axis=0).max()
    def coords(line): return [((x-center[0])/extent*220+130,140-(y-center[1])/extent*220) for x,y in line]
    for col,r in enumerate(group):
        tile=Image.new('RGB',(360,280),'white');d=ImageDraw.Draw(tile)
        d.text((5,5),case+' / '+r['mode'],fill='black')
        d.line(coords(r['outline']),fill='#c7c7c7',width=2)
        if r['xy']:d.line(coords(r['xy']),fill='black',width=3)
        d.text((5,260),'VALID' if r['valid'] else 'NO VALID ROUTE',fill='black')
        canvas.paste(tile,(col*360,row*280))
        def svgline(line,color):return '<polyline points="'+' '.join(f'{x:.2f},{y:.2f}' for x,y in coords(line))+'" fill="none" stroke="'+color+'" stroke-width="2"/>'
        art='<svg viewBox="0 0 300 280" width="300">'+svgline(r['outline'],'#ccc')+(svgline(r['xy'],'black') if r['xy'] else '')+'</svg>'
        cards.append('<article><h3>'+case+' / '+r['mode']+'</h3>'+art+'<p>'+('유효 경로' if r['valid'] else '유효 경로 없음')+'</p></article>')
canvas.save(root/'road-montage.png')
Path('public/eval/point-contour-road-20261028.html').write_text('<meta charset="utf-8"><title>생성 윤곽 → 실제 도로</title><style>body{font-family:sans-serif}main{display:grid;grid-template-columns:repeat(3,1fr)}article{border:1px solid #ddd;padding:10px}</style><h1>생성 윤곽 → 실제 도로: 3조건 진단</h1><p>회색: 참고 윤곽 / 검정: 실제 도로. 같은 행은 동일 축척. 이름을 공개한 진단이며 사람 인식 평가는 아닙니다. 기존 후보에서 점을 추출했으므로 자동 발견 성능이 아닙니다.</p><main>'+''.join(cards)+'</main>',encoding='utf-8')
print('Saved road gallery and montage')
