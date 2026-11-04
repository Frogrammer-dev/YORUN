"""CPU pilot: unordered partial points -> labelled closed contour.
Run from repo root with model-env Python. Data: Google Quick Draw, CC BY 4.0.
"""
import copy, hashlib, json, time, urllib.request
from pathlib import Path
import numpy as np
import torch
from torch import nn

ROOT = Path('eval/recognition/point-contour-20261028')
ROOT.mkdir(parents=True, exist_ok=True)
SEED = 20261028
CLASSES = ['apple', 'fish', 'bird']
torch.set_num_threads(4)
torch.manual_seed(SEED)
rng = np.random.default_rng(SEED)

def resample(p, n=64):
    p = np.asarray(p, dtype=np.float64)
    p = np.concatenate([p, p[:1]]) if not np.allclose(p[0], p[-1]) else p
    d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(p, axis=0), axis=1))]
    keep = np.r_[True, np.diff(d) > 1e-9]
    d, p = d[keep], p[keep]
    t = np.linspace(0, d[-1], n, endpoint=False)
    return np.stack([np.interp(t, d, p[:, j]) for j in range(2)], 1).astype('float32')

def canonical(p):
    p = np.asarray(p, dtype='float32')
    p[:, 1] *= -1
    p = (p - (p.max(0) + p.min(0))/2) / np.ptp(p, axis=0).max()
    if np.sum(p[:, 0]*np.roll(p[:, 1], -1)-p[:, 1]*np.roll(p[:, 0], -1)) < 0:
        p = p[::-1]
    p = np.roll(p, -int(np.argmax(p[:, 0])), axis=0)
    return resample(p)

def acquire():
    rows, manifest, seen = [], [], set()
    for c, name in enumerate(CLASSES):
        url = f'https://storage.googleapis.com/quickdraw_dataset/full/simplified/{name}.ndjson'
        cache = ROOT / f'{name}.selected.json'
        if cache.exists():
            selected = json.loads(cache.read_text())
        else:
            selected = []
            with urllib.request.urlopen(url, timeout=60) as response:
                for i, line in enumerate(response):
                    if i >= 10000: break
                    r = json.loads(line)
                    if not r.get('recognized') or len(r['drawing']) != 1: continue
                    p = np.array(r['drawing'][0][:2]).T
                    extent = np.ptp(p, axis=0).max()
                    if len(p) < 8 or extent == 0: continue
                    gap = float(np.linalg.norm(p[0]-p[-1])/extent)
                    if gap > .15: continue
                    selected.append({'key_id':r['key_id'], 'points':p.tolist(), 'closureGap':gap})
                    if len(selected) == 240: break
            cache.write_text(json.dumps(selected))
        accepted = []
        for r in selected:
            p = canonical(r['points'])
            h = hashlib.sha256(p.tobytes()).hexdigest()
            if h in seen: continue
            seen.add(h)
            accepted.append({'class':c, 'id':r['key_id'], 'p':p, 'hash':h, 'closureGap':r['closureGap']})
        order = rng.permutation(len(accepted))
        for k, idx in enumerate(order):
            r = accepted[idx]
            r['split'] = 'train' if k < int(.7*len(order)) else 'val' if k < int(.85*len(order)) else 'test'
            rows.append(r)
        manifest.append({'class':name, 'url':url, 'count':len(accepted), 'cacheSHA256':hashlib.sha256(cache.read_bytes()).hexdigest()})
        print(name, len(accepted), flush=True)
    assert all(sum(r['class']==c and r['split']=='test' for r in rows)>5 for c in range(3))
    (ROOT/'manifest.json').write_text(json.dumps({'seed':SEED, 'license':'CC BY 4.0', 'source':'https://github.com/googlecreativelab/quickdraw-dataset', 'sources':manifest, 'records':[{k:v for k,v in r.items() if k!='p'} for r in rows]}, indent=2))
    return rows

def partial(p, mode, random):
    if mode == 'random16': idx = random.choice(64, 16, replace=False)
    else:
        count = 8 if mode == 'uniform8' else 16
        idx = (np.arange(count)*(64//count)+int(random.integers(64)))%64
    x = p[idx].copy()
    # Duplicate eight points to retain a fixed tensor size; mean/max stay unchanged.
    if len(x)==8: x = np.tile(x, (2,1))
    return x[random.permutation(16)]

class Model(nn.Module):
    def __init__(self):
        super().__init__()
        self.encoder = nn.Sequential(nn.Linear(2,64),nn.ReLU(),nn.Linear(64,128),nn.ReLU())
        self.decoder = nn.Sequential(nn.Linear(259,256),nn.ReLU(),nn.Linear(256,128))
    def forward(self,x,c):
        f=self.encoder(x)
        return self.decoder(torch.cat([f.max(1).values,f.mean(1),torch.nn.functional.one_hot(c,3).float()],1)).reshape(-1,64,2)

def chamfer(a,b):
    d=torch.cdist(a,b)
    return (d.min(1).values.mean(1)+d.min(2).values.mean(1))/2

def build(rows, split, seed):
    random=np.random.default_rng(seed)
    return [(r,mode,partial(r['p'],mode,random)) for r in rows if r['split']==split for mode in ['uniform8','uniform16','random16']]

def batch(items):
    return (torch.tensor(np.stack([x for r,m,x in items])),torch.tensor([r['class'] for r,m,x in items]),torch.tensor(np.stack([r['p'] for r,m,x in items])))

def svg(p, dots=False):
    xy=[(float(x)*170+100,100-float(y)*170) for x,y in p]
    if dots: body=''.join(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="2.3"/>' for x,y in xy)
    else: body='<polygon points="'+' '.join(f'{x:.2f},{y:.2f}' for x,y in xy)+'" fill="none" stroke="black" stroke-width="2"/>'
    return '<svg viewBox="0 0 200 200" width="180" height="180">'+body+'</svg>'

def main():
    started=time.time()
    rows=acquire()
    model=Model()
    # Invariance check ensures point order cannot encode the missing outline order.
    x=torch.rand(2,16,2); c=torch.tensor([0,1])
    assert torch.allclose(model(x,c),model(x.flip(1),c),atol=1e-6)
    opt=torch.optim.Adam(model.parameters(),lr=.001)
    val=batch(build(rows,'val',SEED+1)); best=float('inf'); history=[]
    for epoch in range(60):
        items=build(rows,'train',SEED+100+epoch)
        order=rng.permutation(len(items)); model.train()
        for start in range(0,len(order),64):
            a,b,y=batch([items[i] for i in order[start:start+64]])
            pred=model(a,b)
            loss=((pred-y)**2).mean()+.2*chamfer(pred,y).mean()
            opt.zero_grad(); loss.backward(); opt.step()
        model.eval()
        with torch.no_grad(): score=float(chamfer(model(val[0],val[1]),val[2]).mean())
        history.append(score)
        if score<best: best=score; state=copy.deepcopy(model.state_dict()); best_epoch=epoch+1
        if (epoch+1)%10==0: print('epoch',epoch+1,'validation',score,flush=True)
    model.load_state_dict(state)
    torch.save({'state_dict':state,'classes':CLASSES,'bestEpoch':best_epoch,'normalization':'max extent 1, center bbox, y up','points':64},ROOT/'model.pt')
    train=[r for r in rows if r['split']=='train']; outputs=[]; cards=[]
    with torch.no_grad():
        for r,mode,a in build(rows,'test',SEED+2):
            pred=model(torch.tensor(a[None]),torch.tensor([r['class']]))[0].numpy()
            pool=[s for s in train if s['class']==r['class']]
            dist=[np.linalg.norm(a[:,None,:]-s['p'][None,:,:],axis=-1).min(1).mean() for s in pool]
            nearest=pool[int(np.argmin(dist))]
            u=np.unique(a,axis=0); center=u.mean(0)
            interp=resample(u[np.argsort(np.arctan2(u[:,1]-center[1],u[:,0]-center[0]))])
            shapes={'model':pred,'retrieval':nearest['p'],'angularInterpolation':interp}
            scores={k:float(chamfer(torch.tensor(v[None]),torch.tensor(r['p'][None]))[0]) for k,v in shapes.items()}
            outputs.append({'id':r['id'],'class':CLASSES[r['class']],'mode':mode,'errors':scores,'input':a.tolist(),'target':r['p'].tolist(),'predicted':pred.tolist(),'retrieved':nearest['p'].tolist(),'retrievalId':nearest['id']})
            if mode=='uniform8': cards.append('<tr><td>'+CLASSES[r['class']]+' '+str(r['id'])+'</td>'+''.join('<td>'+svg(v,d)+'</td>' for v,d in [(a,True),(r['p'],False),(pred,False),(nearest['p'],False)])+'</tr>')
    def stats(items): return {k:float(np.mean([r['errors'][k] for r in items])) for k in outputs[0]['errors']}
    total=stats(outputs); classes={n:stats([r for r in outputs if r['class']==n]) for n in CLASSES}
    ids=sorted(set(r['id'] for r in outputs)); delta=np.array([np.mean([r['errors']['model']-r['errors']['retrieval'] for r in outputs if r['id']==i]) for i in ids])
    boot=np.random.default_rng(SEED+3).choice(delta,(2000,len(delta)),replace=True).mean(1)
    summary={'means':total,'classes':classes,'modes':{m:stats([r for r in outputs if r['mode']==m]) for m in ['uniform8','uniform16','random16']},'originalTestCount':len(ids),'evaluatedVariants':len(outputs),'bestEpoch':best_epoch,'validationHistory':history,'modelMinusRetrieval95CI':np.quantile(boot,[.025,.975]).tolist(),'h1Supported':bool(total['model']<=.9*total['retrieval'] and all(s['model']<=s['retrieval'] for s in classes.values())),'humanRecognitionMeasured':False,'roadGeneralizationMeasured':False,'elapsedSeconds':time.time()-started}
    (ROOT/'results.json').write_text(json.dumps({'summary':summary,'outputs':outputs}))
    report=Path('reports/point-contour-20261028');report.mkdir(exist_ok=True)
    (report/'summary.json').write_text(json.dumps(summary,indent=2))
    page=Path('public/eval/point-contour-20261028.html');page.parent.mkdir(exist_ok=True)
    page.write_text('<meta charset="utf-8"><title>점→윤곽 복원 진단</title><style>body{font-family:sans-serif}td{border:1px solid #ddd}svg{background:white}</style><h1>점→윤곽 복원: 최종 평가 원본</h1><p>진단 화면이며 블라인드 사람 평가가 아닙니다. 실제 도로 경로가 아닙니다.</p><table><tr><th>종류/ID</th><th>입력 8점</th><th>정답</th><th>학습 모델</th><th>학습 그림 검색</th></tr>'+''.join(cards)+'</table>',encoding='utf-8')
    print(json.dumps(summary),flush=True)

if __name__=='__main__': main()
