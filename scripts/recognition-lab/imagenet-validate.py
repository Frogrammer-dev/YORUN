"""Frozen 24-image segmentation and point-selection diagnostic; no training."""
import base64, importlib.util, json, hashlib, argparse
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageOps,ImageDraw

def module(name,file):
    s=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
contours=module('contours','imagenet-contours.py')
features=module('features','feature-points.py')
root=Path('eval/recognition/imagenet-contour-20261028')
parser=argparse.ArgumentParser();parser.add_argument('--method',choices=['grabcut','u2netp'],default='grabcut');args=parser.parse_args()
out=root/('validation-v1' if args.method=='grabcut' else 'validation-u2netp-v1');out.mkdir(exist_ok=True)
rows=json.loads((root/'acquisition.json').read_text())['records']
cv2.setNumThreads(2)
if args.method=='u2netp':
    import os
    os.environ['U2NET_HOME']=str((root/'models').resolve())
    os.environ['REMBG_HOME']=str((root/'models').resolve())
    os.environ['OMP_NUM_THREADS']='2'
    from rembg import new_session,remove
    session=new_session('u2netp',providers=['CPUExecutionProvider'])

def distance(p,q):
    a=q;v=np.roll(q,-1,axis=0)-q
    t=np.clip(((p[:,None,:]-a[None,:,:])*v[None,:,:]).sum(2)/np.maximum((v*v).sum(1),1e-12),0,1)
    d=np.linalg.norm(p[:,None,:]-(a[None,:,:]+t[:,:,None]*v[None,:,:]),axis=2).min(1)
    return {'mean':float(d.mean()),'max':float(d.max())}

results=[];cards=[];tiles=[]
for i,r in enumerate(rows):
    cv2.setRNGSeed(20261028)
    im=Image.open(root/r['image']).convert('RGB');im.thumbnail((384,384))
    rgb=np.array(im);h,w=rgb.shape[:2];mask=np.zeros((h,w),np.uint8)
    margin=max(1,int(min(h,w)*.05))
    if args.method=='grabcut':
        cv2.grabCut(cv2.cvtColor(rgb,cv2.COLOR_RGB2BGR),mask,(margin,margin,w-2*margin,h-2*margin),np.zeros((1,65)),np.zeros((1,65)),5,cv2.GC_INIT_WITH_RECT)
        binary=((mask==1)|(mask==3)).astype('uint8')
    else:
        binary=(np.asarray(remove(im,session=session,only_mask=True))>127).astype('uint8')
    count,labels,stats,_=cv2.connectedComponentsWithStats(binary,8)
    foreground=int(binary.sum());largest=int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))+1 if count>1 else 0
    component=(labels==largest).astype('uint8') if largest else np.zeros_like(binary)
    fraction=foreground/(w*h);coverage=float(component.sum()/max(1,foreground))
    found,_=cv2.findContours(component,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_NONE)
    result={'id':r['id'],'label':r['labelName'],'foregroundFraction':fraction,'largestComponentFraction':coverage,'sourceSHA256':hashlib.sha256((root/r['image']).read_bytes()).hexdigest(),'reviewed':False,'reasons':[]}
    if fraction<.01 or fraction>.9:result['reasons'].append('foreground_area')
    if coverage<.8:result['reasons'].append('fragmented')
    p=None;selected=None
    if found and len(max(found,key=cv2.contourArea))>=8:
        raw=max(found,key=cv2.contourArea).reshape(-1,2)
        p=np.array(contours.normalize(raw,256)); selected=features.select(p,16)
        result['selection']=selected
        if selected['status']!='ok':result['reasons'].append('feature_overflow')
        else:
            result['uniform']=distance(p,p[::16]);result['feature']=distance(p,p[selected['indices']])
            result['densePoints']=p.tolist()
    else:result['reasons'].append('missing_contour')
    result['autoValid']=not result['reasons'];results.append(result)
    Image.fromarray(binary*255).save(out/f'{i+1:02d}-mask.png')
    tile=Image.new('RGB',(800,220),'white');d=ImageDraw.Draw(tile)
    tile.paste(ImageOps.contain(im,(190,180)),(0,25))
    overlay=rgb.copy();overlay[binary==0]=(overlay[binary==0]*.2).astype('uint8')
    tile.paste(ImageOps.contain(Image.fromarray(overlay),(190,180)),(200,25))
    for col,idx in [(2,list(range(0,256,16))),(3,selected['indices'] if selected else [])]:
        if p is None:continue
        pts=[(float(x)*160+col*200+100,120-float(y)*160) for x,y in p]
        d.line(pts+[pts[0]],fill='#ccc',width=1)
        sub=[pts[j] for j in idx]
        if sub:d.line(sub+[sub[0]],fill='black',width=2)
        for j in idx:
            x,y=pts[j];d.ellipse((x-2,y-2,x+2,y+2),fill='red')
    d.text((2,2),str(i+1)+' '+r['labelName'][:70],fill='black')
    d.text((2,205),'AUTO '+('PASS' if result['autoValid'] else ','.join(result['reasons'])),fill='black')
    tile.save(out/f'{i+1:02d}.png');tiles.append(tile)
    encoded=base64.b64encode((out/f'{i+1:02d}.png').read_bytes()).decode()
    cards.append('<article><img width="800" src="data:image/png;base64,'+encoded+'"></article>')
    print(i+1,result['autoValid'],result['reasons'],flush=True)

valid=[r for r in results if r['autoValid']]
summary={'method':args.method,'total':len(rows),'autoValid':len(valid),'visualReviewCompleted':False,'trained':False,'pointMeans':{k:float(np.mean([r[k]['mean'] for r in valid])) for k in ['uniform','feature']} if valid else {},'semanticRecognitionMeasured':False}
(out/'results.json').write_text(json.dumps({'summary':summary,'results':results},indent=2))
for page in range(4):
    montage=Image.new('RGB',(800,1320),'white')
    for j,tile in enumerate(tiles[page*6:page*6+6]):montage.paste(tile,(0,j*220))
    montage.save(out/f'montage-{page+1}.jpg')
Path(f'public/eval/imagenet-validation-{args.method}-20261028.html').write_text('<meta charset="utf-8"><title>ImageNet 전처리 검증</title><h1>ImageNet 24장 전처리 진단: '+args.method+'</h1><p>왼쪽부터 원본 / 추정 전경 / 균일16점 / 특징보존점. overflow는16점 초과 진단이며 동등 비교에서 제외. 빨강은 선택점. AUTO PASS는 사물 분리 성공이 아닙니다. 복원 모델 학습·사람 인식 평가는 미실시.</p>'+''.join(cards),encoding='utf-8')
print(json.dumps(summary))
