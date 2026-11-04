"""Post-evaluation examples, not a blinded study or a representative success rate."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('review',Path(__file__).with_name('road-ranker-review.py'))
review=importlib.util.module_from_spec(spec);spec.loader.exec_module(review)


def main():
    samples=[('대전','road-ranker-20261102-v7','R07','daejeon-dunsan'),('울산','road-ranker-20261102-v8','R10','ulsan-samsan')]
    im=Image.new('RGB',(1000,940),'#f0f4f7');d=ImageDraw.Draw(im)
    font=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',23)
    small=ImageFont.truetype('C:/Windows/Fonts/malgun.ttf',16)
    d.text((26,15),'실제 도로 경로: 이전 선택과 모델 선택 예시',fill='#183048',font=font)
    provenance=[]
    for row,(city,study,token,area) in enumerate(samples):
        folder=ROOT/'public/eval'/study;mapping=json.loads((folder/'mapping.json').read_text(encoding='utf-8'))
        chosen=next(r for r in mapping['mapping'] if r['token']==token)
        base_slot=next(s for s in mapping['slots'] if s['area']==area and s['method']=='baseline' and s['slot']==1)
        base=next(r for r in mapping['mapping'] if r['id']==base_slot['id'])
        for col,item in enumerate([base,chosen]):
            r=item['prediction'];points=review.display_points({**r,'_rotation':item.get('viewRotation',0)})
            xs,ys=zip(*points);extent=max(max(xs)-min(xs),max(ys)-min(ys),1);cx,cy=(max(xs)+min(xs))/2,(max(ys)+min(ys))/2
            left,top=20+col*490,65+row*410
            d.rounded_rectangle((left,top,left+470,top+390),radius=16,fill='white')
            label=f'{city} · '+('이전 선택' if col==0 else f'새 경로 {r["meters"]/1000:.2f}km')
            d.text((left+18,top+14),label,fill='#183048',font=font)
            d.line([(left+235+(x-cx)*300/extent,top+215-(y-cy)*300/extent) for x,y in points],fill='#183048' if col==0 else '#146957',width=3)
        provenance.append({'study':mapping['fingerprint'],'selectedToken':token,'selectedId':chosen['id'],'baselineId':base['id'],'displayRotation':chosen.get('viewRotation',0),'meters':chosen['prediction']['meters']})
    d.text((26,905),'평가 후 고른 예시 · AI 검토 3명 중 2명 명확 판정 · 실제 사람 인식률은 미측정',fill='#526575',font=small)
    out=ROOT/'public/eval/road-object-examples-20261102';out.mkdir(parents=True,exist_ok=True)
    im.save(out/'comparison.png')
    (out/'examples.json').write_text(json.dumps({'examples':provenance,'postEvaluationSelection':True,'representativeRate':False,'humanRecognitionMeasured':False,'imageSHA256':hashlib.sha256((out/'comparison.png').read_bytes()).hexdigest()},indent=2,ensure_ascii=False),encoding='utf-8')
    print(out/'comparison.png')


if __name__=='__main__':main()
