"""Real road points only -> existing label-free residual model. No target template."""
import importlib.util,json,hashlib
from pathlib import Path
import numpy as np
import torch
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('ms',Path(__file__).with_name('multistroke.py'));ms=importlib.util.module_from_spec(spec);spec.loader.exec_module(ms)
OUT=ROOT/'eval/recognition/road-input-20261029';REPORT=ROOT/'reports/road-input-20261029';REPORT.mkdir(exist_ok=True)
raw=(OUT/'roads.json').read_bytes();data=json.loads(raw)
model=ms.Model();checkpoint=ROOT/'eval/recognition/multistroke-20261029/model-17.pt';model.load_state_dict(torch.load(checkpoint,weights_only=True)['state_dict']);model.eval();torch.set_num_threads(4)
outputs=[];cards=[];montage=Image.new('RGB',(1000,max(1,len(data['results']))*220),'white');draw=ImageDraw.Draw(montage)
for i,r in enumerate(data['results']):
    p=np.array(r['xy'],dtype='float32');extent=np.ptp(p,axis=0).max();center=(p.max(0)+p.min(0))/2;p=(p-center)/extent
    target=ms.resample(p);observed=ms.sparse(target,8);base=ms.resample(observed)
    a=torch.tensor(base[None]);context=torch.tensor(observed[None]);mask=torch.ones(1,len(observed),dtype=torch.bool)
    with torch.no_grad():pred=model(a,context,mask)[0].numpy()
    assert np.allclose(pred[[0,-1]],base[[0,-1]])
    shift=float(np.linalg.norm(pred-base,axis=1).mean()*extent)
    outputs.append({**r,'normalizedRoad':p.tolist(),'observed':observed.tolist(),'interpolated':base.tolist(),'predicted':pred.tolist(),'predictedXY':(pred*extent+center).tolist(),'meanModelDisplacementMeters':shift,'objectIdentity':None,'predictedCurveIsRoadRoute':False})
    panels=[('실제 도로',p,False),('도로에서 뽑은 점',observed,True),('단순 보간',base,False),('모델 출력 · 도로 아님',pred,False)]
    columns=''.join('<section><p>'+label+'</p>'+ms.svg([s],dots)+'</section>' for label,s,dots in panels)
    overlay=ms.svg([p]).replace('</svg>',ms.svg([pred]).split('>',1)[1].replace('#16314a','#df6615'))
    cards.append(f'<article><h2>{r["id"]}</h2><p>실제길 {r["meters"]/1000:.2f}km · 입력 {len(observed)}점 · 보간 대비 모델 이동량 평균 {shift:.1f}m (정확도 아님)</p><div>'+columns+'<section><p>중첩 · 주황=모델 출력</p>'+overlay+'</section></div></article>')
    for j,(_,s,dots) in enumerate(panels):
        xy=[(j*200+100+170*x,i*220+120-170*y) for x,y in s];draw.text((j*200+5,i*220+4),f'{i+1} '+['road','points','interpolated','model'][j],fill='black')
        if dots:
            for x,y in xy:draw.ellipse((x-2,y-2,x+2,y+2),fill='#16314a')
        else:draw.line(xy,fill='#16314a',width=2)
    for s,color in [(p,'#16314a'),(pred,'#df6615')]:draw.line([(900+170*x,i*220+120-170*y) for x,y in s],fill=color,width=2)
summary={'counts':data['counts'],'roadInputCount':len(outputs),'targetShapesUsed':False,'labelsAsInput':False,'modelRetrained':False,'humanRecognitionMeasured':False,'roadSourceHash':hashlib.sha256(raw).hexdigest(),'checkpointHash':hashlib.sha256(checkpoint.read_bytes()).hexdigest(),'meanModelDisplacementMeters':float(np.mean([r['meanModelDisplacementMeters'] for r in outputs])) if outputs else None}
(OUT/'results.json').write_text(json.dumps({'summary':summary,'outputs':outputs}));(REPORT/'summary.json').write_text(json.dumps(summary,indent=2))
html='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>도로점에서 형태 복원</title><style>body{font-family:system-ui;background:#eef3f6;margin:24px}article{background:white;padding:18px;margin:18px 0}article div{display:flex;flex-wrap:wrap}section{margin:5px}</style><h1>도로 데이터 → 점 → 모델 형태 복원</h1><p>목표 사물이나 그림을 지정하지 않았습니다. 지역별 자연 도로고리 첫6개를 입력했습니다. 모델 출력은 해석 후보 곡선이며 실제 달릴 수 있는 길이 아닙니다. 사물 이름을 자동 판정하는 모델도 아닙니다. 원본도로와의 차이를 주황색으로 확인하세요. 기존 그림학습 모델의 도로 입력 전이 실험이며 도로용 재학습은 하지 않았습니다.</p>'''+''.join(cards)+'</html>'
(ROOT/'public/eval/road-input-restore-20261029.html').write_text(html,encoding='utf-8');montage.save(OUT/'montage.png');montage.crop((0,0,1000,min(880,montage.height))).save(OUT/'preview.png');print(json.dumps(summary))
