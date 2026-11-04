"""Offline cached CLIP, broad vocabulary, real-route ID ranking with rotation audit."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import time
import numpy as np
import torch
from PIL import Image, ImageDraw
from transformers import AutoModel, AutoProcessor

ROOT=Path(__file__).resolve().parents[2]


def feature(value):
    return value if torch.is_tensor(value) else value.pooler_output


def render(points, turns, offset_degrees=0):
    p=np.asarray(points,dtype=float)
    p=(p-(p.min(0)+p.max(0))/2)/np.ptp(p,axis=0).max()
    for _ in range(turns):p=np.column_stack([-p[:,1],p[:,0]])
    if offset_degrees:
        angle=math.radians(offset_degrees);c,s=math.cos(angle),math.sin(angle)
        p=p@np.array([[c,s],[-s,c]])
        p=(p-(p.min(0)+p.max(0))/2)/np.ptp(p,axis=0).max()
    im=Image.new('RGB',(896,896),'white')
    ImageDraw.Draw(im).line([(448+float(x)*896*.85,448-float(y)*896*.85) for x,y in p],fill='#111111',width=8,joint='curve')
    return im.resize((224,224),Image.Resampling.LANCZOS)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,default=ROOT/'eval/recognition/road-ranker-20261102/roads.json')
    parser.add_argument('--output',type=Path,default=ROOT/'eval/recognition/road-ranker-20261102/predictions-clip-v2.json')
    parser.add_argument('--batch-size',type=int,default=16)
    parser.add_argument('--reuse-predictions',type=Path)
    parser.add_argument('--align-proposals',action='store_true')
    args=parser.parse_args()
    if args.output.exists():raise ValueError('Output exists; use a new filename')
    torch.set_num_threads(4)
    started=time.perf_counter()
    cache=ROOT/'eval/recognition/model-cache/hub'
    checkpoint='openai/clip-vit-base-patch32'
    model=AutoModel.from_pretrained(checkpoint,cache_dir=cache,local_files_only=True,use_safetensors=False).eval()
    processor=AutoProcessor.from_pretrained(checkpoint,cache_dir=cache,local_files_only=True)
    vocab_path=ROOT/'src/lib/art/clipVocabulary.json';vocab=json.loads(vocab_path.read_text(encoding='utf-8'))
    with torch.inference_mode():
        text=processor(text=['a black line outline drawing of '+v['english']+' on a white background' for v in vocab],padding=True,return_tensors='pt')
        embeddings=torch.nn.functional.normalize(feature(model.get_text_features(**text)),dim=-1)
    raw=args.input.read_bytes();data=json.loads(raw);rows=data['results'];all_scores=[]
    if data.get('status','complete')!='complete':raise ValueError('Candidate generation is not complete')
    if not rows or len({r['id'] for r in rows})!=len(rows):raise ValueError('Candidate IDs must be nonempty and unique')
    cached={}
    reuse=None
    if args.reuse_predictions:
        reuse=json.loads(args.reuse_predictions.read_text(encoding='utf-8'))
        if reuse.get('model')!=checkpoint or reuse.get('revision')!=getattr(model.config,'_commit_hash',None) or reuse.get('vocabularySHA256')!=hashlib.sha256(vocab_path.read_bytes()).hexdigest() or reuse.get('threshold')!=.30 or reuse.get('margin')!=.003 or reuse.get('rotations')!=4:
            raise ValueError('Cached model/vocabulary/policy mismatch')
        cached={r['id']:r for r in reuse['outputs'] if not args.align_proposals or not r.get('generatorPlacement') or r.get('alignment')=='proposal-axis-v4'}
        for row in rows:
            if row['id'] in cached and any(cached[row['id']].get(key)!=value for key,value in row.items()):
                raise ValueError('Cached source geometry/metadata mismatch: '+row['id'])
    pending=[r for r in rows if r['id'] not in cached]
    views=[(r,k) for r in pending for k in range(4)]
    for start in range(0,len(views),args.batch_size):
        part=views[start:start+args.batch_size]
        images=[render(r['xy'],k,-r['generatorPlacement']['rotDeg'] if args.align_proposals and r.get('generatorPlacement') else 0) for r,k in part]
        with torch.inference_mode():
            inputs=processor(images=images,return_tensors='pt')
            scores=(torch.nn.functional.normalize(feature(model.get_image_features(**inputs)),dim=-1)@embeddings.T).numpy()
        all_scores.extend(scores.tolist())
        if start%(args.batch_size*10)==0:print(f'CLIP views {min(start+len(part),len(views))}/{len(views)}',flush=True)
    outputs=[]
    new_outputs={}
    for i,row in enumerate(pending):
        audit=[]
        for turn,values in enumerate(all_scores[i*4:i*4+4]):
            ranked=sorted(range(len(values)),key=lambda j:values[j],reverse=True)
            winner=next(j for j in ranked if not vocab[j]['excluded'])
            score=values[winner];margin=score-max(v for j,v in enumerate(values) if j!=winner)
            accepted=ranked[0]==winner and score>=.30 and margin>=.003
            offset=-row['generatorPlacement']['rotDeg'] if args.align_proposals and row.get('generatorPlacement') else 0
            audit.append({'rotation':(turn*90+offset)%360,'predictedClass':vocab[winner]['english'],'label':vocab[winner]['label'],'score':score,'margin':margin,'accepted':accepted,
                          'top5':[{'name':vocab[j]['english'],'excluded':vocab[j]['excluded'],'score':values[j]} for j in ranked[:5]]})
        passing=[a for a in audit if a['accepted']]
        best=max(passing or audit,key=lambda a:(a['score'],-a['rotation']))
        new_outputs[row['id']]={**row,**best,'accepted':bool(passing),'rotationAudit':audit,'coordinatesUnchanged':True,'humanRecognitionVerified':False,'alignment':'proposal-axis-v4' if args.align_proposals and row.get('generatorPlacement') else 'quarter-turns-v2'}
    outputs=[cached[r['id']] if r['id'] in cached else new_outputs[r['id']] for r in rows]
    payload={'outputs':outputs,'model':checkpoint,'revision':getattr(model.config,'_commit_hash',None),'inputSHA256':hashlib.sha256(raw).hexdigest(),
             'vocabularySHA256':hashlib.sha256(vocab_path.read_bytes()).hexdigest(),'method':'clip-road-proposal-aligned-v4' if args.align_proposals else 'clip-road-rotation-v2','threshold':.30,'margin':.003,
             'elapsedSeconds':time.perf_counter()-started,'humanRecognitionMeasured':False,'rotations':4,'trained':False,
             'reusedPredictions':len(rows)-len(pending),'newPredictions':len(pending),
             'reuseSHA256':hashlib.sha256(args.reuse_predictions.read_bytes()).hexdigest() if args.reuse_predictions else None,
             'reuseOriginalElapsedSeconds':reuse.get('elapsedSeconds') if reuse else None}
    args.output.write_text(json.dumps(payload,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    print(json.dumps({'candidates':len(outputs),'accepted':sum(o['accepted'] for o in outputs),'seconds':payload['elapsedSeconds']}),flush=True)


if __name__=='__main__':main()
