"""Deterministic multi-scale turn features; semantic importance is not guaranteed."""
import numpy as np

def select(points, budget=16, threshold_degrees=40):
    p=np.asarray(points,dtype=float)
    if np.allclose(p[0],p[-1]):p=p[:-1]
    n=len(p)
    if n<5 or budget<3:raise ValueError('Insufficient points or budget')
    # Input must have approximately uniform arc spacing; do not smooth coordinates.
    angles=[]
    for step in (1,2):
        incoming=p-np.roll(p,step,axis=0); outgoing=np.roll(p,-step,axis=0)-p
        denom=np.linalg.norm(incoming,axis=1)*np.linalg.norm(outgoing,axis=1)
        angles.append(np.degrees(np.arccos(np.clip((incoming*outgoing).sum(1)/np.maximum(denom,1e-12),-1,1))))
    score=np.minimum(*angles)
    mandatory=[]
    for i in np.argsort(-score,kind='stable'):
        if score[i]<threshold_degrees:break
        if all(min((int(i)-j)%n,(j-int(i))%n)>2 for j in mandatory):mandatory.append(int(i))
    # Never silently remove detected corners to satisfy a fixed point budget.
    if len(mandatory)>budget:
        return {'status':'feature_overflow','required':len(mandatory),'indices':sorted(mandatory)}
    chosen=mandatory.copy() or [int(np.argmax(p[:,0]))]
    while len(chosen)<min(budget,n):
        distances=np.linalg.norm(p[:,None,:]-p[chosen][None,:,:],axis=-1).min(1)
        distances[chosen]=-1
        chosen.append(int(np.argmax(distances)))
    return {'status':'ok','mandatory':sorted(mandatory),'indices':sorted(chosen)}

if __name__=='__main__':
    square=np.array([[0,0],[1,0],[1,1],[0,1]])
    p=np.concatenate([square[i]+np.arange(16)[:,None]/16*(square[(i+1)%4]-square[i]) for i in range(4)])
    r=select(p,8)
    assert set([0,16,32,48]).issubset(r['indices'])
    assert len(r['indices'])==8
    assert select(p,3)['status']=='feature_overflow'
    shifted=np.roll(p,5,axis=0);s=select(shifted,8)
    assert set((np.array(r['mandatory'])+5)%64)==set(s['mandatory'])
    print('PASS: square corners retained, budget respected, overflow explicit, cyclic shift consistent')
