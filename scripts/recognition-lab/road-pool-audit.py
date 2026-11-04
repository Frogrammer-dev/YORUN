"""Model-neutral development sample: best generator rank per fixed area/intent.

This is a sampled AI diagnostic, not a complete-pool oracle or human evaluation.
"""
import argparse
import hashlib
import importlib.util
import json
import random
from pathlib import Path
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('review',Path(__file__).with_name('road-ranker-review.py'))
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input',type=Path,default=ROOT/'eval/recognition/road-ranker-20261102/v9-proposals.json')
    p.add_argument('--out',type=Path,default=ROOT/'public/eval/road-pool-audit-v10')
    args=p.parse_args()
    if (args.out/'mapping.json').exists():raise ValueError('Use a new audit folder')
    raw=args.input.read_bytes();data=json.loads(raw);rows=data['results'];selected=[];slots=[]
    for case in data['counts']:
        area,intent=case['area'],case['proposalShape']
        pool=[r for r in rows if r['area']==area and r.get('proposalShape')==intent]
        row=min(pool,key=lambda r:(r['proposalPoolRank'],r['id'])) if pool else None
        slots.append({'area':area,'intent':intent,'id':row['id'] if row else None})
        if row:selected.append({**row,'_rotation':-row['generatorPlacement']['rotDeg'],'auditKind':'generator'})
    for area in dict.fromkeys(r['area'] for r in rows):
        selected.extend({**r,'_rotation':0,'auditKind':'baseline'} for r in [r for r in rows if r['area']==area and r.get('baselineId')][:2])
    random.Random(2026110210).shuffle(selected)
    args.out.mkdir(parents=True,exist_ok=True);mapping=[];pages=[]
    for start in range(0,len(selected),21):
        part=selected[start:start+21];image=Image.new('RGB',(900,((len(part)+2)//3)*330),'white');draw=ImageDraw.Draw(image)
        for j,row in enumerate(part):
            token=f'R{start+j+1:03d}';points=review.display_points(row);xs,ys=zip(*points)
            extent=max(max(xs)-min(xs),max(ys)-min(ys),1);cx,cy=(max(xs)+min(xs))/2,(max(ys)+min(ys))/2
            left,top=(j%3)*300,(j//3)*330
            draw.text((left+12,top+8),token,fill='#172f45')
            draw.line([(left+150+(x-cx)*260/extent,top+175-(y-cy)*260/extent) for x,y in points],fill='#172f45',width=3)
            mapping.append({'token':token,'id':row['id'],'area':row['area'],'kind':row['auditKind'],'intent':row.get('proposalShape'),'rotation':row['_rotation']})
        filename=f'blind-{start//21+1}.png';image.save(args.out/filename);pages.append({'file':filename,'SHA256':hashlib.sha256((args.out/filename).read_bytes()).hexdigest()})
    result={'inputSHA256':hashlib.sha256(raw).hexdigest(),'sampledOnly':True,'completePoolOracle':False,'humanRecognitionMeasured':False,'selection':'one minimum proposalPoolRank per fixed area/intent, plus original baseline two per area; no CLIP/head/AI scores','slots':slots,'mapping':mapping,'pages':pages}
    (args.out/'mapping.json').write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'sampled':len(selected),'generatorRequests':len(slots),'missing':sum(s['id'] is None for s in slots),'pages':len(pages)}))
