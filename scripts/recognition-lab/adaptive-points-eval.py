import importlib.util,json,base64
from pathlib import Path
import numpy as np
import cv2
from PIL import Image,ImageDraw

def mod(name,file):
    s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
a=mod('adaptive','adaptive-points.py');c=mod('contours','imagenet-contours.py')
root=Path('eval/recognition/imagenet-contour-20261028');out=root/'adaptive-v1';out.mkdir(exist_ok=True)
source=json.loads((root/'validation-u2netp-v1/results.json').read_text())['results'];results=[];cards=[]
def error(p,q):
    d=np.stack([a.segment_dist(p,q[i],q[(i+1)%len(q)]) for i in range(len(q))],1).min(1)
    return {'mean':float(d.mean()),'max':float(d.max())}
for i,r in enumerate(source):
    mask=np.array(Image.open(root/f'validation-u2netp-v1/{i+1:02d}-mask.png'))
    found,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    reasons=[v for v in r['reasons'] if v!='feature_overflow']
    if not found or len(max(found,key=cv2.contourArea))<8:
        results.append({'id':r['id'],'valid':False,'reasons':reasons+['missing_contour']});continue
    p=np.array(c.normalize(max(found,key=cv2.contourArea).reshape(-1,2),256));s=a.select(p)
    n=s['count'];uniform=np.floor(np.arange(n)*256/n).astype(int)
    row={'id':r['id'],'label':r['label'],'valid':not reasons,'reasons':reasons,'selection':s,'adaptive':error(p,p[s['indices']]),'matchedUniform':error(p,p[uniform]),'fixed':{str(k):error(p,p[np.floor(np.arange(k)*256/k).astype(int)]) for k in [16,32,64]}}
    results.append(row)
    tile=Image.new('RGB',(660,230),'white');d=ImageDraw.Draw(tile)
    for col,idx in enumerate([list(range(0,256,16)),uniform,s['indices']]):
        pts=[(float(x)*170+110+col*220,120-float(y)*170) for x,y in p];d.line(pts+[pts[0]],fill='#ccc')
        selected=[pts[j] for j in idx];d.line(selected+[selected[0]],fill='black',width=2)
        for j in idx:
            x,y=pts[j];d.ellipse((x-2,y-2,x+2,y+2),fill='red')
    d.text((5,5),str(i+1)+' '+r['label'][:65],fill='black');d.text((5,210),f'Uniform16 / Uniform{n} / Adaptive{n}; valid={not reasons}',fill='black')
    tile.save(out/f'{i+1:02d}.png');encoded=base64.b64encode((out/f'{i+1:02d}.png').read_bytes()).decode();cards.append(f'<img width="660" src="data:image/png;base64,{encoded}">')
v=[r for r in results if r['valid']];summary={'total':24,'validSegmentationHeuristic':len(v),'allProcessed':sum('selection' in r for r in results),'counts':[r['selection']['count'] for r in v],'adaptiveMean':float(np.mean([r['adaptive']['mean'] for r in v])),'matchedUniformMean':float(np.mean([r['matchedUniform']['mean'] for r in v])),'maxOrderedError':max(r['selection']['maxOrderedError'] for r in results if 'selection' in r),'humanRecognitionMeasured':False,'trained':False}
(out/'results.json').write_text(json.dumps({'summary':summary,'results':results},indent=2))
report=Path('reports/adaptive-points-20261028');report.mkdir(exist_ok=True);(report/'summary.json').write_text(json.dumps(summary,indent=2))
Path('public/eval/adaptive-points-20261028.html').write_text('<meta charset="utf-8"><h1>가변 점 추출 비교</h1><p>왼쪽: 균일16점 / 가운데: 가변 방식과 같은 수의 균일점 / 오른쪽: 특징 보존 가변점. 분리 오류가 있는 마스크도 표시합니다. 학습·사물 인식 평가가 아닙니다.</p>'+''.join(cards),encoding='utf-8')
print(json.dumps(summary))
