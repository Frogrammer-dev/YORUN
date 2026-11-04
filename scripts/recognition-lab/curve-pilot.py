"""Fixed cubic-chain ablation inspired by Cloud2Curve, NOT its reproduction."""
import copy,hashlib,importlib.util,json,time
from pathlib import Path
import numpy as np
import torch
from torch import nn
ROOT=Path(__file__).resolve().parents[2]
DATA=ROOT/'eval/recognition/point-contour-20261028'
OUT=ROOT/'eval/recognition/curve-pilot-20261029'
REPORT=ROOT/'reports/curve-pilot-20261029'
spec=importlib.util.spec_from_file_location('pc',Path(__file__).with_name('point-contour.py'));pc=importlib.util.module_from_spec(spec);spec.loader.exec_module(pc)

class CurveModel(pc.Model):
    def __init__(self):
        super().__init__();self.decoder[-1]=nn.Linear(256,24)
    def controls(self,x,c):
        f=self.encoder(x)
        return self.decoder(torch.cat([f.max(1).values,f.mean(1),nn.functional.one_hot(c,3).float()],1)).reshape(-1,4,3,2)
    def forward(self,x,c):
        q=self.controls(x,c);t=torch.arange(16,dtype=x.dtype,device=x.device)[None,None,:,None]/16
        a=q[:,:,0,None];b=q[:,:,1,None];d=q[:,:,2,None];e=q[:,:,0].roll(-1,1)[:,:,None]
        return ((1-t)**3*a+3*(1-t)**2*t*b+3*(1-t)*t*t*d+t**3*e).reshape(-1,64,2)

def main():
    began=time.time();OUT.mkdir(parents=True,exist_ok=True);REPORT.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((DATA/'manifest.json').read_text());points={}
    for source in manifest['sources']:
        p=DATA/f'{source["class"]}.selected.json';assert hashlib.sha256(p.read_bytes()).hexdigest()==source['cacheSHA256']
        for r in json.loads(p.read_text()):points[str(r['key_id'])]=pc.canonical(r['points'])
    rows=[dict(r,p=points[str(r['id'])]) for r in manifest['records']]
    for r in rows:assert hashlib.sha256(r['p'].tobytes()).hexdigest()==r['hash']
    assert len({r['hash'] for r in rows})==590
    torch.manual_seed(pc.SEED);model=CurveModel();rng=np.random.default_rng(pc.SEED)
    x=torch.rand(2,16,2);c=torch.tensor([0,1]);assert torch.allclose(model(x,c),model(x.flip(1),c),atol=1e-6)
    # Each segment starts at its anchor, and its endpoint is next segment's anchor.
    assert torch.allclose(model(x,c)[:,::16],model.controls(x,c)[:,:,0])
    opt=torch.optim.Adam(model.parameters(),lr=.001);val=pc.batch(pc.build(rows,'val',pc.SEED+1));best=float('inf');history=[]
    for epoch in range(60):
        items=pc.build(rows,'train',pc.SEED+100+epoch);order=rng.permutation(len(items));model.train()
        for start in range(0,len(order),64):
            a,c,y=pc.batch([items[i] for i in order[start:start+64]]);pred=model(a,c)
            loss=((pred-y)**2).mean()+.2*pc.chamfer(pred,y).mean();opt.zero_grad();loss.backward();opt.step()
        model.eval()
        with torch.no_grad():score=float(pc.chamfer(model(val[0],val[1]),val[2]).mean())
        history.append(score)
        if score<best:best=score;state=copy.deepcopy(model.state_dict());best_epoch=epoch+1
        if (epoch+1)%10==0:print('epoch',epoch+1,'val',score,flush=True)
    model.load_state_dict(state);torch.save({'state_dict':state,'architecture':'four fixed cubic segments; not official Cloud2Curve','bestEpoch':best_epoch,'classes':pc.CLASSES},OUT/'model.pt')
    old=pc.Model();old.load_state_dict(torch.load(DATA/'model.pt',weights_only=True)['state_dict']);old.eval()
    source=json.loads((DATA/'results.json').read_text())['outputs'];assert len(source)==267;outputs=[]
    with torch.no_grad():
        for r in source:
            a=torch.tensor([r['input']],dtype=torch.float32);c=torch.tensor([pc.CLASSES.index(r['class'])]);y=torch.tensor([r['target']],dtype=torch.float32)
            pred=model(a,c)[0];baseline=old(a,c)[0];assert np.allclose(baseline.numpy(),r['predicted'],atol=1e-5)
            u=np.unique(np.array(r['input']),axis=0);center=u.mean(0);interp=pc.resample(u[np.argsort(np.arctan2(u[:,1]-center[1],u[:,0]-center[0]))])
            scores={k:float(pc.chamfer(v[None],y)[0]) for k,v in {'curve':pred,'coordinates':baseline,'interpolation':torch.tensor(interp)}.items()}
            outputs.append({'id':r['id'],'class':r['class'],'mode':r['mode'],'input':r['input'],'target':r['target'],'curve':pred.tolist(),'coordinates':baseline.tolist(),'interpolation':interp.tolist(),'errors':scores})
    def means(rr):return {k:float(np.mean([r['errors'][k] for r in rr])) for k in ['curve','coordinates','interpolation']}
    total=means(outputs);classes={c:means([r for r in outputs if r['class']==c]) for c in pc.CLASSES}
    ids=list(dict.fromkeys(r['id'] for r in outputs));delta=np.array([np.mean([r['errors']['curve']-r['errors']['coordinates'] for r in outputs if r['id']==i]) for i in ids]);boot=np.random.default_rng(pc.SEED+3).choice(delta,(2000,len(delta)),replace=True).mean(1)
    summary={'officialReproduction':False,'means':total,'classes':classes,'modes':{m:means([r for r in outputs if r['mode']==m]) for m in ['uniform8','uniform16','random16']},'bestEpoch':best_epoch,'validationHistory':history,'originalTestCount':len(ids),'variants':len(outputs),'curveMinusCoordinates95CI':np.quantile(boot,[.025,.975]).tolist(),'hypothesisSupported':total['curve']<=.9*total['coordinates'] and all(v['curve']<=v['coordinates'] for v in classes.values()),'humanRecognitionMeasured':False,'elapsedSeconds':time.time()-began}
    (OUT/'results.json').write_text(json.dumps({'summary':summary,'outputs':outputs}));(REPORT/'summary.json').write_text(json.dumps(summary,indent=2))
    cards=[]
    for c in pc.CLASSES:
        for r in [r for r in outputs if r['class']==c and r['mode']=='uniform8'][:4]:
            cards.append('<article><h2>'+c+' '+str(r['id'])+'</h2><div>'+''.join('<section><p>'+label+'</p>'+pc.svg(r[key],key=='input')+'</section>' for key,label in [('input','입력8점'),('target','정답'),('coordinates','기존 좌표 모델'),('curve','곡선 모델'),('interpolation','단순 보간')])+'</div></article>')
    page='<meta charset="utf-8"><title>점에서 곡선 복원 실험</title><style>body{font-family:system-ui;background:#eff3f6;margin:25px}article{background:white;margin:18px 0;padding:18px}article div{display:flex;flex-wrap:wrap}section{margin:8px}</style><h1>곡선 출력 모델 비교</h1><p>Cloud2Curve 아이디어 축소 실험이며 공식 재현이 아닙니다. 4개 고정 cubic 곡선/폐곡선. 세 방법 모두 동일 점 입력, 학습 모델에는 정답 클래스가 제공됩니다. 실제 도로나 사람 인식 평가가 아닙니다. 클래스별 테스트 첫4개 고정 표시.</p>'+''.join(cards)
    (ROOT/'public/eval/curve-pilot-20261029.html').write_text(page,encoding='utf-8');print(json.dumps(summary),flush=True)

if __name__=='__main__':main()
