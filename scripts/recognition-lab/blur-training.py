"""Paired CPU training experiment: clean vs blur-augmented raster inputs."""
import copy, hashlib, importlib.util, json, time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'eval/recognition/point-contour-20261028'
OUT=ROOT/'eval/recognition/blur-training-20261028'
REPORT=ROOT/'reports/blur-training-20261028'
spec=importlib.util.spec_from_file_location('contour',Path(__file__).with_name('point-contour.py'))
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
CLASSES=module.CLASSES

def raster(p,sigma=0):
    image=Image.new('L',(64,64),0)
    xy=[(float(x)*52+32,32-float(y)*52) for x,y in p]
    ImageDraw.Draw(image).line(xy+[xy[0]],fill=255,width=2)
    if sigma:image=image.filter(ImageFilter.GaussianBlur(sigma))
    return np.asarray(image,dtype='float32')[None]/255

class Net(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder=nn.Sequential(nn.Conv2d(1,8,5,padding=2),nn.ReLU(),nn.MaxPool2d(2),nn.Conv2d(8,16,3,padding=1),nn.ReLU(),nn.MaxPool2d(2),nn.Conv2d(16,24,3,padding=1),nn.ReLU(),nn.AdaptiveAvgPool2d((4,4)),nn.Flatten(),nn.Linear(384,128),nn.ReLU())
        self.contour=nn.Linear(128,128);self.label=nn.Linear(128,3)
    def forward(self,x):
        h=self.encoder(x);return self.contour(h).reshape(-1,64,2),self.label(h)

def main():
    started=time.time();torch.set_num_threads(4);OUT.mkdir(parents=True,exist_ok=True);REPORT.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((DATA/'manifest.json').read_text());lookup={}
    for source in manifest['sources']:
        f=DATA/f'{source["class"]}.selected.json'
        assert hashlib.sha256(f.read_bytes()).hexdigest()==source['cacheSHA256']
        for r in json.loads(f.read_text()):lookup[str(r['key_id'])]=module.canonical(r['points'])
    records=manifest['records'];assert len(records)==590
    assert len({r['id'] for r in records})==len(records)
    assert len({r['hash'] for r in records})==len(records)
    points=np.stack([lookup[str(r['id'])] for r in records]);labels=torch.tensor([r['class'] for r in records]);target=torch.tensor(points)
    inputs=torch.tensor(np.stack([[raster(p,s) for p in points] for s in [0,1,2]]))
    split={s:torch.tensor([i for i,r in enumerate(records) if r['split']==s]) for s in ['train','val','test']}
    grid=torch.tensor(np.stack([raster(np.round(p*16)/16) for p in points]))
    test=split['test'];truth=target[test];summaries=[];outputs=[]
    for seed in [17,29]:
        for treatment in ['clean','blur']:
            torch.manual_seed(seed);rng=np.random.default_rng(seed);aug=np.random.default_rng(seed+1000)
            model=Net();opt=torch.optim.Adam(model.parameters(),lr=.001);best=float('inf');history=[]
            for epoch in range(30):
                model.train();order=rng.permutation(split['train'].numpy())
                for start in range(0,len(order),64):
                    idx=torch.tensor(order[start:start+64]);levels=torch.tensor(aug.integers(0,3,len(idx))) if treatment=='blur' else torch.zeros(len(idx),dtype=torch.long)
                    pred,logit=model(inputs[levels,idx]);loss=((pred-target[idx])**2).mean()+.05*nn.functional.cross_entropy(logit,labels[idx])
                    opt.zero_grad();loss.backward();opt.step()
                model.eval()
                with torch.no_grad():score=float(torch.stack([((model(inputs[s,split['val']])[0]-target[split['val']])**2).mean() for s in [0,1]]).mean())
                history.append(score)
                if score<best:best=score;state=copy.deepcopy(model.state_dict());best_epoch=epoch+1
                if (epoch+1)%10==0:print(seed,treatment,'epoch',epoch+1,'val',round(score,6),flush=True)
            model.load_state_dict(state);model.eval();torch.save({'state_dict':state,'seed':seed,'treatment':treatment,'classes':CLASSES,'bestEpoch':best_epoch,'input':'64px ink raster; extent52; line2px','output':'64 normalized contour points + 3 logits'},OUT/f'{treatment}-{seed}.pt')
            metrics={}
            with torch.no_grad():
                for mode,x in [('original',inputs[0,test]),('blur1',inputs[1,test]),('blur2',inputs[2,test]),('grid',grid[test])]:
                    pred,logit=model(x);errors=module.chamfer(pred,truth).numpy();correct=(logit.argmax(1)==labels[test]).numpy()
                    metrics[mode]={'chamfer':float(errors.mean()),'accuracy':float(correct.mean()),'classes':{name:{'chamfer':float(errors[(labels[test]==c).numpy()].mean()),'accuracy':float(correct[(labels[test]==c).numpy()].mean())} for c,name in enumerate(CLASSES)}}
                    for j,i in enumerate(test.tolist()):outputs.append({'seed':seed,'treatment':treatment,'mode':mode,'id':records[i]['id'],'class':CLASSES[records[i]['class']],'predictedClass':CLASSES[int(logit[j].argmax())],'error':float(errors[j]),'target':points[i].tolist(),'predicted':pred[j].tolist()})
            summaries.append({'seed':seed,'treatment':treatment,'bestEpoch':best_epoch,'metrics':metrics,'validationHistory':history})
    decisions=[]
    for seed in [17,29]:
        a,b=[next(r['metrics'] for r in summaries if r['seed']==seed and r['treatment']==t) for t in ['clean','blur']]
        gain=1-b['grid']['chamfer']/a['grid']['chamfer'];degrade=b['original']['chamfer']/a['original']['chamfer']-1;acc=b['original']['accuracy']-a['original']['accuracy']
        decisions.append({'seed':seed,'gridErrorReduction':gain,'originalErrorIncrease':degrade,'originalAccuracyDelta':acc,'supported':gain>=.1 and degrade<=.05 and acc>=-.03})
    summary={'source':'Google Quick Draw selected closed single strokes','license':'CC BY 4.0','manifestSHA256':hashlib.sha256((DATA/'manifest.json').read_bytes()).hexdigest(),'splitCounts':{k:len(v) for k,v in split.items()},'runs':summaries,'decisions':decisions,'hypothesisSupported':all(d['supported'] for d in decisions),'elapsedSeconds':time.time()-started,'humanRecognitionMeasured':False,'realRoadGeneralizationMeasured':False,'imagenetUsed':False}
    (OUT/'results.json').write_text(json.dumps({'summary':summary,'outputs':outputs}))
    (REPORT/'summary.json').write_text(json.dumps(summary,indent=2))
    cards=[]
    # Fixed first 4 held-out IDs per class, first seed; no selection by performance.
    for name in CLASSES:
        ids=[records[i]['id'] for i in test.tolist() if CLASSES[records[i]['class']]==name][:4]
        for rid in ids:
            rs=[next(o for o in outputs if o['seed']==17 and o['id']==rid and o['mode']=='grid' and o['treatment']==t) for t in ['clean','blur']]
            target=np.array(rs[0]['target']);panels=[('정답',target),('격자 변형 입력',np.round(target*16)/16),('원본 학습 출력',rs[0]['predicted']),('흐림 학습 출력',rs[1]['predicted'])]
            cards.append(f'<article><h2>{name} · {rid}</h2><div class="row">'+''.join('<section><p>'+label+'</p>'+module.svg(p)+'</section>' for label,p in panels)+'</div></article>')
    html='<meta charset="utf-8"><title>원본 학습 대 흐림 학습</title><style>body{font-family:system-ui;background:#eef3f7;margin:25px}article{background:white;padding:20px;margin:15px}.row{display:flex;flex-wrap:wrap;gap:20px}</style><h1>학습 방식 비교: 원본 vs 흐림 증강</h1><p>Quick Draw 3종. 실제 학습한 모델의 출력입니다. ImageNet 사진/실제 도로가 아닙니다. seed17의 클래스별 테스트 첫4개를 고정 표시. 입력은 격자 변형 선 그림, 복원 정답은 원래 윤곽입니다. 모델은 정답 이름을 입력받지 않습니다.</p>'+''.join(cards)
    (ROOT/'public/eval/blur-training-20261028.html').write_text(html,encoding='utf-8')
    print(json.dumps({'decisions':decisions,'elapsedSeconds':summary['elapsedSeconds']}),flush=True)

if __name__=='__main__':main()
