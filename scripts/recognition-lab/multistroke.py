"""Multi-stroke residual restoration with observed stroke grouping/order; no labels as input."""
import argparse,copy,hashlib,json,time,urllib.request
from pathlib import Path
import numpy as np
import torch
from torch import nn
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'eval/recognition/multistroke-20261029'
REPORT=ROOT/'reports/multistroke-20261029'
NAMES=['apple','fish','bird']

def resample(p,n=32):
    p=np.asarray(p,dtype='float32');d=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    keep=np.r_[True,np.diff(d)>1e-8];p,d=p[keep],d[keep]
    if len(p)==1:return np.repeat(p,n,axis=0)
    t=np.linspace(0,d[-1],n)
    return np.stack([np.interp(t,d,p[:,j]) for j in range(2)],1).astype('float32')

def sparse(p,stride):
    keep={0,len(p)-1};a=p[1:-1]-p[:-2];b=p[2:]-p[1:-1]
    den=np.linalg.norm(a,axis=1)*np.linalg.norm(b,axis=1)
    angles=np.degrees(np.arccos(np.clip((a*b).sum(1)/np.maximum(den,1e-12),-1,1)))
    keep.update((np.where((angles>=40)&(den>1e-9))[0]+1).tolist());keep.update(range(0,len(p),stride))
    return p[sorted(keep)]

def acquire():
    OUT.mkdir(parents=True,exist_ok=True)
    prior=json.loads((ROOT/'eval/recognition/point-contour-20261028/manifest.json').read_text())
    excluded={str(r['id']) for r in prior['records']};rows=[];seen=set();stats={}
    for name in NAMES:
        path=OUT/f'{name}.json'
        if path.exists():pack=json.loads(path.read_text())
        else:
            records=[];scanned=0;reject={}
            url=f'https://storage.googleapis.com/quickdraw_dataset/full/simplified/{name}.ndjson'
            with urllib.request.urlopen(url,timeout=60) as response:
                for line in response:
                    scanned+=1
                    if scanned>10000:break
                    r=json.loads(line);reason=None
                    if str(r['key_id']) in excluded:reason='previous_pilot'
                    elif not r.get('recognized'):reason='game_not_recognized'
                    elif len(r['drawing'])<2:reason='single_stroke'
                    elif any(len(s)<2 or not s[0] or len(s[0])!=len(s[1]) for s in r['drawing']):reason='invalid_stroke'
                    if reason:reject[reason]=reject.get(reason,0)+1;continue
                    records.append({'id':str(r['key_id']),'strokes':[np.array(s[:2],dtype=float).T.tolist() for s in r['drawing']]})
                    if len(records)==300:break
            pack={'url':url,'scanned':scanned,'rejections':reject,'records':records};path.write_text(json.dumps(pack))
        stats[name]={k:v for k,v in pack.items() if k!='records'};stats[name]['acceptedRaw']=len(pack['records']);stats[name]['sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        for r in pack['records']:
            allp=np.concatenate(r['strokes']);extent=np.ptp(allp,axis=0).max()
            if extent<=0:continue
            center=(allp.min(0)+allp.max(0))/2
            strokes=[((np.array(s)-center)/extent*np.array([1,-1])).astype('float32') for s in r['strokes']]
            signature=hashlib.sha256(json.dumps([s.tolist() for s in strokes],separators=(',',':')).encode()).hexdigest()
            if signature in seen:continue
            seen.add(signature);fraction=int(signature[:8],16)/2**32
            rows.append({'id':r['id'],'class':name,'hash':signature,'split':'train' if fraction<.7 else 'val' if fraction<.85 else 'test','strokes':[s.tolist() for s in strokes]})
        print('acquired',name,len(pack['records']),flush=True)
    assert len({r['id'] for r in rows})==len(rows)
    assert not excluded.intersection(r['id'] for r in rows)
    manifest={'license':'CC BY4.0','sources':stats,'records':rows}
    (OUT/'dataset.json').write_text(json.dumps(manifest));return manifest

class Model(nn.Module):
    def __init__(self):
        super().__init__();self.encoder=nn.Sequential(nn.Linear(2,32),nn.ReLU(),nn.Linear(32,32),nn.ReLU());self.decoder=nn.Sequential(nn.Linear(128,128),nn.ReLU(),nn.Linear(128,64))
        nn.init.zeros_(self.decoder[-1].weight);nn.init.zeros_(self.decoder[-1].bias)
    def forward(self,base,context,mask):
        h=self.encoder(context);mean=(h*mask[:,:,None]).sum(1)/mask.sum(1,keepdim=True);maximum=h.masked_fill(~mask[:,:,None],-1e9).max(1).values
        residual=self.decoder(torch.cat([base.flatten(1),mean,maximum],1)).reshape(-1,32,2)
        gate=torch.ones_like(residual);gate[:,0]=0;gate[:,-1]=0
        point_stroke=(base.amax(1)-base.amin(1)).amax(1)<1e-8
        gate[point_stroke]=0
        return base+residual*gate

def items(rows):
    result=[]
    for r in rows:
        targets=[resample(s) for s in r['strokes']]
        for mode,stride in [('mild',4),('sparse',8)]:
            observed=[sparse(p,stride) for p in targets];context=np.concatenate(observed)
            for j,(p,obs) in enumerate(zip(targets,observed)):
                result.append({'id':r['id'],'class':r['class'],'split':r['split'],'mode':mode,'stroke':j,'target':p,'input':obs,'base':resample(obs),'context':context})
    return result

def batch(rr):
    size=max(len(r['context']) for r in rr);context=np.zeros((len(rr),size,2),dtype='float32');mask=np.zeros((len(rr),size),bool)
    for i,r in enumerate(rr):context[i,:len(r['context'])]=r['context'];mask[i,:len(r['context'])]=True
    return torch.tensor(np.stack([r['base'] for r in rr])),torch.tensor(context),torch.tensor(mask),torch.tensor(np.stack([r['target'] for r in rr]))

def evaluate(model,rr):
    predictions=[];errors=[]
    with torch.no_grad():
        for start in range(0,len(rr),128):
            a,c,m,y=batch(rr[start:start+128]);p=model(a,c,m);d=torch.cdist(p,y);errors.extend(((d.min(1).values.mean(1)+d.min(2).values.mean(1))/2).tolist());predictions.extend(p.tolist())
    groups={}
    for r,e in zip(rr,errors):groups.setdefault((r['id'],r['mode']),[]).append(e)
    return float(np.mean([np.mean(v) for v in groups.values()])),predictions,errors

def svg(strokes,dots=False):
    body=''
    for s in strokes:
        p=[(100+170*x,100-170*y) for x,y in s]
        if dots or len(s)==1:body+=''.join(f'<circle cx="{x}" cy="{y}" r="2"/>' for x,y in p)
        else:body+='<polyline fill="none" stroke="#16314a" stroke-width="2" points="'+' '.join(f'{x},{y}' for x,y in p)+'"/>'
    return '<svg width="200" height="200" viewBox="0 0 200 200">'+body+'</svg>'

def main():
    began=time.time();torch.set_num_threads(4);REPORT.mkdir(parents=True,exist_ok=True)
    manifest=acquire();rows=manifest['records'];allitems=items(rows);splits={s:[r for r in allitems if r['split']==s] for s in ['train','val','test']}
    # Open resampling never inserts a closing edge. Point strokes stay points.
    assert np.allclose(resample([[0,0],[1,0]])[[0,-1]],[[0,0],[1,0]])
    assert np.allclose(resample([[.2,.3]]),[.2,.3])
    probe=Model();nn.init.normal_(probe.decoder[-1].weight)
    point=torch.full((1,32,2),.2);context=torch.tensor([[[.2,.2],[0.,0.]]]);mask=torch.tensor([[True,False]])
    assert torch.equal(probe(point,context,mask),point)
    assert torch.allclose(probe(point,context,mask),probe(point,context[:,:1],mask[:,:1]))
    assert all(np.allclose(r['base'][[0,-1]],r['target'][[0,-1]]) for r in allitems)
    summaries=[];saved=[]
    for seed in [17,29]:
        torch.manual_seed(seed);rng=np.random.default_rng(seed);model=Model();opt=torch.optim.Adam(model.parameters(),lr=.001)
        baseline,pred0,err0=evaluate(model,splits['test']);best=float('inf');history=[]
        for epoch in range(30):
            model.train();order=rng.permutation(len(splits['train']))
            for start in range(0,len(order),128):
                a,c,m,y=batch([splits['train'][i] for i in order[start:start+128]]);p=model(a,c,m);loss=((p-y)**2).mean();opt.zero_grad();loss.backward();opt.step()
            model.eval();val,_,_=evaluate(model,splits['val']);history.append(val)
            if val<best:best=val;state=copy.deepcopy(model.state_dict());best_epoch=epoch+1
            if (epoch+1)%10==0:print(seed,'epoch',epoch+1,'val',val,flush=True)
        model.load_state_dict(state);score,preds,errs=evaluate(model,splits['test']);torch.save({'state_dict':state,'seed':seed,'bestEpoch':best_epoch,'labelsAsInput':False,'requiresStrokeGroupingAndOrder':True},OUT/f'model-{seed}.pt')
        classmetrics={}
        for name in NAMES:
            groups={}
            for r,a,b in zip(splits['test'],err0,errs):
                if r['class']==name:groups.setdefault((r['id'],r['mode']),[]).append([a,b])
            v=np.mean([np.mean(a,axis=0) for a in groups.values()],axis=0);classmetrics[name]={'baseline':float(v[0]),'model':float(v[1])}
        modes={}
        for mode in ['mild','sparse']:
            groups={}
            for r,a,b in zip(splits['test'],err0,errs):
                if r['mode']==mode:groups.setdefault(r['id'],[]).append([a,b])
            v=np.mean([np.mean(a,axis=0) for a in groups.values()],axis=0);modes[mode]={'baseline':float(v[0]),'model':float(v[1])}
        endpoint=max(float(np.max(np.abs(np.array(p)[[0,-1]]-r['target'][[0,-1]]))) for p,r in zip(preds,splits['test']));assert endpoint<1e-6
        short=[i for i,r in enumerate(splits['test']) if np.linalg.norm(np.diff(r['target'],axis=0),axis=1).sum()<.15]
        shortmetric={'strokeVariants':len(short),'baseline':float(np.mean([err0[i] for i in short])) if short else None,'model':float(np.mean([errs[i] for i in short])) if short else None}
        summaries.append({'seed':seed,'baseline':baseline,'model':score,'bestEpoch':best_epoch,'classes':classmetrics,'modes':modes,'shortStrokeDiagnostic':shortmetric,'endpointErrorMax':endpoint,'validationHistory':history,'supported':score<=baseline*.9 and all(v['model']<=v['baseline'] for v in classmetrics.values())})
        if seed==17:
            for r,p in zip(splits['test'],preds):saved.append({k:(v.tolist() if isinstance(v,np.ndarray) else v) for k,v in dict(r,predicted=p).items() if k!='context'})
    summary={'drawingCounts':{s:sum(r['split']==s for r in rows) for s in splits},'drawingTotal':len(rows),'strokeCounts':{s:len(v)//2 for s,v in splits.items()},'runs':summaries,'hypothesisSupported':all(r['supported'] for r in summaries),'labelsAsInput':False,'humanRecognitionMeasured':False,'realRoadTested':False,'elapsedSeconds':time.time()-began}
    (REPORT/'summary.json').write_text(json.dumps(summary,indent=2));(OUT/'results.json').write_text(json.dumps({'summary':summary,'outputs':saved}))
    cards=[]
    for name in NAMES:
        ids=[r['id'] for r in rows if r['split']=='test' and r['class']==name][:4]
        for rid in ids:
            rr=[r for r in saved if r['id']==rid and r['mode']=='sparse'];original=next(r['strokes'] for r in rows if r['id']==rid)
            panels=[('원본 획',original,False),('관측점',[r['input'] for r in rr],True),('보간',[r['base'] for r in rr],False),('학습 출력',[r['predicted'] for r in rr],False)]
            cards.append(f'<article><h2>{name} · {rid} · {len(rr)}획</h2><div>'+''.join('<section><p>'+label+'</p>'+svg(s,d)+'</section>' for label,s,d in panels)+'</div></article>')
    (ROOT/'public/eval/multistroke-20261029.html').write_text('<meta charset="utf-8"><title>여러 획 복원</title><style>body{font-family:system-ui;background:#eef3f6;margin:24px}article{background:white;padding:16px;margin:18px 0}article div{display:flex;flex-wrap:wrap}</style><h1>내부선을 포함한 여러 획 복원</h1><p>Quick Draw, seed17 테스트 첫4개/범주. 정답 이름은 모델 입력에 없음. 획 구분·순서는 주어지며 실제 도로 분할을 해결한 모델이 아닙니다. 획 사이를 연결하거나 열린 획을 닫지 않습니다. 사람 인식 평가는 별도입니다.</p>'+''.join(cards),encoding='utf-8')
    print(json.dumps(summary),flush=True)

if __name__=='__main__':main()
