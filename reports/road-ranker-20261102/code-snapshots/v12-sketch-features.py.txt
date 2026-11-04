"""Official Quick Draw examples and offline CLIP features; no road judgments as labels."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import urllib.parse
import urllib.request
import numpy as np
from PIL import Image, ImageDraw

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'eval/recognition/road-ranker-20261102/v10-dataset'
CLASSES=[{'name':key,'word':word,'object':True} for key,word in [
    ('house','house'),('tree','tree'),('car','car'),('coffee_cup','coffee cup'),('airplane','airplane'),
    ('t-shirt','t-shirt'),('pants','pants'),('hammer','hammer'),('wine_bottle','wine bottle'),('key','key'),('chair','chair')]]+[
    {'name':word,'word':word,'object':False} for word in ['square','circle','triangle','hexagon','octagon','line','zigzag','map']]


def digest(data):return hashlib.sha256(data).hexdigest()


def dump(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,indent=2,ensure_ascii=False,allow_nan=False),encoding='utf-8')


def normalized_strokes(drawing):
    if not isinstance(drawing,list) or not drawing or len(drawing)>128:raise ValueError('invalid strokes')
    strokes=[]
    for stroke in drawing:
        if not isinstance(stroke,list) or len(stroke)<2 or len(stroke[0])!=len(stroke[1]) or not stroke[0]:raise ValueError('invalid XY')
        p=np.asarray(stroke[:2],dtype=float).T
        if p.ndim!=2 or p.shape[1]!=2 or not np.isfinite(p).all():raise ValueError('nonfinite XY')
        strokes.append(p)
    allp=np.concatenate(strokes)
    if len(allp)>20000:raise ValueError('oversize drawing')
    extent=np.ptp(allp,axis=0).max()
    if extent<=1e-8:raise ValueError('zero extent')
    center=(allp.min(0)+allp.max(0))/2
    return [((p-center)/extent*np.array([1,-1])).tolist() for p in strokes]


def geometry_hash(strokes):
    """Group exact rotations, stroke reversal and stroke permutation together."""
    variants=[];points=[np.asarray(s,dtype=float) for s in strokes]
    for _ in range(4):
        parts=[]
        for p in points:
            forward=json.dumps(np.round(p,6).tolist(),separators=(',',':'))
            reverse=json.dumps(np.round(p[::-1],6).tolist(),separators=(',',':'))
            parts.append(min(forward,reverse))
        variants.append(digest('|'.join(sorted(parts)).encode()))
        points=[np.column_stack([-p[:,1],p[:,0]]) for p in points]
    return min(variants)


def split(group):
    # The canonical group is the minimum of four hashes; hash again for uniform splits.
    fraction=int(digest(('split-v10:'+group).encode())[:8],16)/2**32
    return 'train' if fraction<.70 else 'val' if fraction<.85 else 'test'


def acquire(args):
    out=args.out
    classes=json.loads(args.classes_json.read_text(encoding='utf-8')) if getattr(args,'classes_json',None) else CLASSES
    if not classes or len({c['name'] for c in classes})!=len(classes):raise ValueError('Unique nonempty class definitions required')
    if (out/'dataset.json').exists():raise ValueError('Dataset exists; preserve it and choose a new folder')
    out.mkdir(parents=True,exist_ok=True)
    old=json.loads((ROOT/'eval/recognition/point-contour-20261028/manifest.json').read_text(encoding='utf-8'))
    prior_ids={str(r['id']) for r in old['records']}
    seen_ids=set();seen_groups=set();records=[];sources=[]
    for c,definition in enumerate(classes):
        url='https://storage.googleapis.com/quickdraw_dataset/full/simplified/'+urllib.parse.quote(definition['word'],safe='')+'.ndjson'
        cache=out/(definition['name']+'.json')
        if cache.exists():
            pack=json.loads(cache.read_text(encoding='utf-8'))
            if pack['url']!=url or pack['limit']!=72:raise ValueError('Cached acquisition rules mismatch')
            rows=pack['records']
            if any(r['id'] in seen_ids or r['groupSHA256'] in seen_groups for r in rows):raise ValueError('Cached geometry is no longer disjoint')
        else:
            rows=[];scanned=0;bytes_read=0;rejected={};local_ids=set();local_groups=set()
            with urllib.request.urlopen(url,timeout=30) as response:
                for line in response:
                    scanned+=1;bytes_read+=len(line)
                    if scanned>10000 or bytes_read>8_000_000:break
                    r=json.loads(line);reason=None
                    if not r.get('recognized'):reason='game_not_recognized'
                    elif str(r['key_id']) in prior_ids:reason='prior_id'
                    elif r.get('word')!=definition['word']:raise ValueError('Source category mismatch')
                    if reason is None:
                        try:strokes=normalized_strokes(r['drawing']);group=geometry_hash(strokes)
                        except (ValueError,TypeError,KeyError):reason='invalid_geometry'
                    if reason is None and (str(r['key_id']) in seen_ids|local_ids or group in seen_groups|local_groups):reason='duplicate'
                    if reason:
                        rejected[reason]=rejected.get(reason,0)+1;continue
                    row={'id':str(r['key_id']),'classIndex':c,'className':definition['name'],'groupSHA256':group,'split':split(group),'strokes':strokes,'sourceRecognized':True}
                    rows.append(row);local_ids.add(row['id']);local_groups.add(group)
                    if len(rows)==72:break
            if len(rows)!=72:raise ValueError(f'Insufficient frozen records for {definition["name"]}: {len(rows)}')
            pack={'url':url,'limit':72,'scanned':scanned,'bytesRead':bytes_read,'rejected':rejected,'records':rows}
            dump(cache,pack)
        final_rows=[]
        for r in rows:
            if r['classIndex']!=c or r['className']!=definition['name'] or geometry_hash(r['strokes'])!=r['groupSHA256']:raise ValueError('Invalid cached provenance')
            # Raw acquisition caches precede the authoritative final split manifest.
            r={**r,'split':split(r['groupSHA256'])};final_rows.append(r)
            records.append(r);seen_ids.add(r['id']);seen_groups.add(r['groupSHA256'])
        rows=final_rows
        counts={s:sum(r['split']==s for r in rows) for s in ['train','val','test']}
        if min(counts.values())<3:raise ValueError('Inadequate fixed split; change requires a new protocol')
        sources.append({**definition,'url':url,'cacheSHA256':digest(cache.read_bytes()),'counts':counts,'scanned':pack['scanned'],'rejected':pack['rejected']})
        print(json.dumps({'acquired':definition['name'],'count':len(rows),'splits':counts}),flush=True)
    assert len(records)==72*len(classes)==len(seen_ids)==len(seen_groups)
    assert not seen_ids&prior_ids
    protocol=getattr(args,'protocol',None) or ROOT/'reports/road-ranker-20261102/protocol-v10.md'
    report=getattr(args,'data_report',None) or ROOT/'reports/road-ranker-20261102/sketch-data-v10.json'
    dataset={'classes':classes,'records':records,'sources':sources,'license':'CC BY 4.0','source':'https://github.com/googlecreativelab/quickdraw-dataset',
             'recognizedMeaning':'game model recognized; NOT a human road-recognition label','protocolSHA256':digest(protocol.read_bytes()),'acquisitionCodeSHA256':digest(Path(__file__).read_bytes()),'roadJudgmentsUsed':False}
    dump(out/'dataset.json',dataset)
    dump(report,{'classes':classes,'sources':sources,'records':len(records),'datasetSHA256':digest((out/'dataset.json').read_bytes()),'roadJudgmentsUsed':False})


def render(strokes,turn,offset=0):
    points=[np.asarray(s,dtype=float) for s in strokes]
    allp=np.concatenate(points);extent=np.ptp(allp,axis=0).max();center=(allp.min(0)+allp.max(0))/2
    if extent<=0 or not np.isfinite(allp).all():raise ValueError('Invalid rendering input')
    points=[(p-center)/extent for p in points]
    for _ in range(turn):points=[np.column_stack([-p[:,1],p[:,0]]) for p in points]
    if offset:
        angle=math.radians(offset);c,s=math.cos(angle),math.sin(angle)
        points=[p@np.array([[c,s],[-s,c]]) for p in points]
        allp=np.concatenate(points);center=(allp.min(0)+allp.max(0))/2;extent=np.ptp(allp,axis=0).max()
        points=[(p-center)/extent for p in points]
    im=Image.new('RGB',(896,896),'white');draw=ImageDraw.Draw(im)
    for p in points:
        xy=[(448+float(x)*896*.85,448-float(y)*896*.85) for x,y in p]
        if len(xy)==1:draw.ellipse((xy[0][0]-4,xy[0][1]-4,xy[0][0]+4,xy[0][1]+4),fill='#111111')
        else:draw.line(xy,fill='#111111',width=8,joint='curve')
    return im.resize((224,224),Image.Resampling.LANCZOS)


def save_npz(path,**arrays):
    temporary=path.with_suffix('.running.npz')
    with temporary.open('wb') as stream:np.savez_compressed(stream,**arrays)
    temporary.replace(path)


def features(args):
    import torch
    from transformers import AutoModel,AutoProcessor
    torch.set_num_threads(4)
    out=args.out;started=time.perf_counter();cache=ROOT/'eval/recognition/model-cache/hub';checkpoint='openai/clip-vit-base-patch32'
    model=AutoModel.from_pretrained(checkpoint,cache_dir=cache,local_files_only=True,use_safetensors=False).eval()
    processor=AutoProcessor.from_pretrained(checkpoint,cache_dir=cache,local_files_only=True)
    def feature(value):return value if torch.is_tensor(value) else value.pooler_output
    def extract(rows,road):
        parts=[];views=[(r,k) for r in rows for k in range(4)]
        for start in range(0,len(views),args.batch_size):
            batch=views[start:start+args.batch_size]
            images=[render([r['xy']] if road else r['strokes'],k,-r['generatorPlacement']['rotDeg'] if road and r.get('generatorPlacement') else 0) for r,k in batch]
            with torch.inference_mode():
                x=processor(images=images,return_tensors='pt')
                z=torch.nn.functional.normalize(feature(model.get_image_features(**x)),dim=-1).numpy()
            parts.append(z)
            if start%(args.batch_size*20)==0:print(json.dumps({'stage':'roads' if road else 'sketches','views':min(start+len(batch),len(views)),'total':len(views)}),flush=True)
        per_view=np.concatenate(parts).reshape(len(rows),4,-1).astype('float32')
        mean=per_view.mean(1);mean/=np.maximum(np.linalg.norm(mean,axis=1,keepdims=True),1e-12)
        return per_view,mean
    meta={'checkpoint':checkpoint,'revision':getattr(model.config,'_commit_hash',None),'rendererCodeSHA256':digest(Path(__file__).read_bytes()),'rotations':4,'torch':torch.__version__,'roadJudgmentsUsed':False}
    if args.stage in ('all','sketches'):
        path=out/'features.npz'
        if path.exists():raise ValueError('Sketch features exist; use --stage roads or a new folder')
        raw=(out/'dataset.json').read_bytes();dataset=json.loads(raw)
        per_view,mean=extract(dataset['records'],False)
        vocab=json.loads((ROOT/'src/lib/art/clipVocabulary.json').read_text(encoding='utf-8'))
        with torch.inference_mode():
            inputs=processor(text=['a black line outline drawing of '+v['english']+' on a white background' for v in vocab],padding=True,return_tensors='pt')
            text=torch.nn.functional.normalize(feature(model.get_text_features(**inputs)),dim=-1).numpy()
        save_npz(path,features=per_view,mean=mean,textFeatures=text,textClasses=np.asarray([v['english'] for v in vocab]),textExcluded=np.asarray([v['excluded'] for v in vocab]))
        dump(out/'features-metadata.json',{**meta,'datasetSHA256':digest(raw),'featuresSHA256':digest(path.read_bytes()),'elapsedSeconds':time.perf_counter()-started})
    if args.stage in ('all','roads'):
        path=out/'road-features.npz'
        if path.exists():raise ValueError('Road features exist; use a new folder')
        raw=args.roads.read_bytes();data=json.loads(raw)
        if data.get('status')!='complete':raise ValueError('Road generation incomplete')
        per_view,mean=extract(data['results'],True)
        save_npz(path,features=per_view,mean=mean)
        (out/'roads.json').write_bytes(raw)
        dump(out/'road-features-metadata.json',{**meta,'roadsSHA256':digest(raw),'featuresSHA256':digest(path.read_bytes()),'elapsedSeconds':time.perf_counter()-started})


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=OUT)
    parser.add_argument('--classes-json',type=Path)
    parser.add_argument('--protocol',type=Path)
    parser.add_argument('--data-report',type=Path)
    sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('acquire')
    f=sub.add_parser('features');f.add_argument('--stage',choices=('all','sketches','roads'),default='all');f.add_argument('--batch-size',type=int,default=32)
    f.add_argument('--roads',type=Path,default=ROOT/'eval/recognition/road-ranker-20261102/v9-proposals.json')
    args=parser.parse_args()
    acquire(args) if args.command=='acquire' else features(args)
