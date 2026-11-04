"""Preserve all v1 features; add points until ordered segment error is small."""
import importlib.util
from pathlib import Path
import numpy as np

s=importlib.util.spec_from_file_location('features',Path(__file__).with_name('feature-points.py'))
features=importlib.util.module_from_spec(s);s.loader.exec_module(features)

def segment_dist(p,a,b):
    v=b-a;t=np.clip(((p-a)*v).sum(-1)/max(float(v@v),1e-15),0,1)
    return np.linalg.norm(p-(a+t[...,None]*v),axis=-1)

def select(points,tolerance=.01):
    p=np.asarray(points,dtype=float)
    if np.allclose(p[0],p[-1]):p=p[:-1]
    if len(p)<5 or not np.isfinite(p).all() or tolerance<=0:raise ValueError('Invalid contour/tolerance')
    n=len(p);r=features.select(p,n)
    mandatory=r['mandatory'];chosen=set(mandatory)
    chosen.update([int(np.argmax(p[:,0])),int(np.argmin(p[:,0])),int(np.argmax(p[:,1])),int(np.argmin(p[:,1]))])
    while True:
        indices=sorted(chosen);worst=-1.;candidate=None
        for i,a in enumerate(indices):
            b=indices[(i+1)%len(indices)]
            between=np.arange(a+1,b if b>a else b+n)%n
            if not len(between):continue
            d=segment_dist(p[between],p[a],p[b]);j=int(np.argmax(d))
            if d[j]>worst:worst=float(d[j]);candidate=int(between[j])
        if worst<=tolerance or candidate is None:break
        chosen.add(candidate)
    assert set(mandatory)<=chosen
    return {'indices':sorted(chosen),'mandatory':mandatory,'count':len(chosen),'maxOrderedError':max(0,worst),'tolerance':tolerance}

if __name__=='__main__':
    t=np.arange(256)*2*np.pi/256;p=np.stack([.5*np.cos(t),.5*np.sin(t)],1)
    a=select(p,.01);b=select(p,.003)
    assert a['maxOrderedError']<=.01 and b['maxOrderedError']<=.003 and b['count']>=a['count']
    star=np.stack([(0.4+.1*np.cos(20*t))*np.cos(t),(0.4+.1*np.cos(20*t))*np.sin(t)],1)
    r=select(star);assert r['count']>16 and set(r['mandatory'])<=set(r['indices'])
    print('PASS: adaptive tolerance, no 16-point cap, mandatory points retained')
