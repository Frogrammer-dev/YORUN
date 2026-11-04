"""Import authorized ImageNet photos + reviewed foreground masks, not bbox edges.
Manifest JSON array: id, label, image, mask, source, reviewed (true).
Paths are relative to manifest. Masks: foreground >127, background <=127.
No download, segmentation-model inference, or training is implied by this tool.
"""
import argparse
import hashlib
import json
import importlib.util
from pathlib import Path
import numpy as np
from PIL import Image

_spec=importlib.util.spec_from_file_location('feature_points',Path(__file__).with_name('feature-points.py'))
_features=importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_features)
_adaptive_spec=importlib.util.spec_from_file_location('adaptive_points',Path(__file__).with_name('adaptive-points.py'))
_adaptive=importlib.util.module_from_spec(_adaptive_spec)
_adaptive_spec.loader.exec_module(_adaptive)


def outline(mask):
    # Directed pixel boundary edges; keep the largest closed exterior.
    edges = {}
    h, w = mask.shape
    for y, x in np.argwhere(mask):
        x, y = int(x), int(y)
        candidates = []
        if y == 0 or not mask[y-1, x]: candidates.append(((x,y),(x+1,y)))
        if x == w-1 or not mask[y, x+1]: candidates.append(((x+1,y),(x+1,y+1)))
        if y == h-1 or not mask[y+1, x]: candidates.append(((x+1,y+1),(x,y+1)))
        if x == 0 or not mask[y, x-1]: candidates.append(((x,y+1),(x,y)))
        for a,b in candidates:
            if a in edges: raise ValueError('Ambiguous touching components: review mask')
            edges[a] = b
    loops = []
    while edges:
        start = next(iter(edges)); p = [start]; current = start
        while True:
            if current not in edges: raise ValueError('Open mask boundary')
            current = edges.pop(current)
            if current == start: break
            p.append(current)
        loops.append(np.asarray(p, dtype=float))
    if not loops: raise ValueError('Empty foreground')
    def area(p): return abs(np.sum(p[:,0]*np.roll(p[:,1],-1)-p[:,1]*np.roll(p[:,0],-1)))/2
    return max(loops,key=area), len(loops)


def normalize(p, count=64):
    p=p.copy(); p[:,1]*=-1
    span=np.ptp(p,axis=0).max()
    if span<=0: raise ValueError('Degenerate contour')
    p=(p-(p.max(0)+p.min(0))/2)/span
    if np.sum(p[:,0]*np.roll(p[:,1],-1)-p[:,1]*np.roll(p[:,0],-1))<0:p=p[::-1]
    p=np.roll(p,-int(np.argmax(p[:,0])),axis=0)
    p=np.concatenate([p,p[:1]])
    t=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    sample=np.linspace(0,t[-1],count,endpoint=False)
    return np.stack([np.interp(sample,t,p[:,k]) for k in range(2)],axis=1).tolist()


def run(manifest, output):
    records=json.loads(manifest.read_text(encoding='utf-8'))
    accepted=[]; rejected=[]; seen=set()
    for r in records:
        try:
            if r.get('reviewed') is not True: raise ValueError('Mask quality not reviewed')
            for key in ['id','label','source','image','mask']:
                if not r.get(key): raise ValueError('Missing '+key)
            photo=manifest.parent/r['image']; maskpath=manifest.parent/r['mask']
            sha=hashlib.sha256(photo.read_bytes()).hexdigest()
            if sha in seen: raise ValueError('Duplicate source photo')
            with Image.open(photo) as im: size=im.size
            with Image.open(maskpath) as im:
                if im.size!=size: raise ValueError('Mask/photo dimensions differ')
                mask=np.asarray(im.convert('L'))>127
            if mask[0].any() or mask[-1].any() or mask[:,0].any() or mask[:,-1].any():raise ValueError('Foreground touches frame: possible truncation')
            p,loops=outline(mask)
            if loops!=1: raise ValueError('Multiple components or holes: manual review required')
            bucket=int(hashlib.sha256(('20261028:'+sha).encode()).hexdigest()[:8],16)%100
            dense=normalize(p,256)
            selection=_features.select(dense,16)
            adaptive=_adaptive.select(dense)
            accepted.append({'id':r['id'],'label':r['label'],'source':r['source'],'imageSHA256':sha,'maskSHA256':hashlib.sha256(maskpath.read_bytes()).hexdigest(),'split':'train' if bucket<70 else 'val' if bucket<85 else 'test','points':normalize(p),'densePoints':dense,'featureSelection':selection,'featureInput':[dense[i] for i in selection['indices']],'uniformInput':dense[::16]})
            seen.add(sha)
            accepted[-1]['adaptiveSelection']=adaptive
            accepted[-1]['adaptiveInput']=[dense[i] for i in adaptive['indices']]
        except (ValueError,OSError,KeyError) as e: rejected.append({'id':r.get('id'),'reason':str(e)})
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps({'dataset':'ImageNet user-supplied reviewed masks','trained':False,'accepted':accepted,'rejected':rejected},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'accepted':len(accepted),'rejected':len(rejected),'trained':False}))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('manifest',type=Path);parser.add_argument('output',type=Path)
    args=parser.parse_args();run(args.manifest,args.output)
