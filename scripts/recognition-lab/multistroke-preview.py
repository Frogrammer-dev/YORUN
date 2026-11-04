"""Inspect fixed examples without rerunning training."""
import json
from pathlib import Path
from PIL import Image,ImageDraw
ROOT=Path(__file__).resolve().parents[2]
out=ROOT/'eval/recognition/multistroke-20261029'
rows=json.loads((out/'dataset.json').read_text())['records']
results=json.loads((out/'results.json').read_text())['outputs']
selected=[]
for name in ['apple','fish','bird']:
    selected.extend([r for r in rows if r['class']==name and r['split']=='test'][:2])
im=Image.new('RGB',(800,6*225),'white');d=ImageDraw.Draw(im)
for i,r in enumerate(selected):
    rr=[x for x in results if x['id']==r['id'] and x['mode']=='sparse']
    groups=[r['strokes'],[x['input'] for x in rr],[x['base'] for x in rr],[x['predicted'] for x in rr]]
    for j,strokes in enumerate(groups):
        d.text((j*200+5,i*225+4),f'{r["class"]}: '+['raw','observed','interpolated','learned'][j],fill='black')
        for s in strokes:
            p=[(j*200+100+170*x,i*225+120-170*y) for x,y in s]
            if j==1 or len(p)==1:
                for x,y in p:d.ellipse((x-2,y-2,x+2,y+2),fill='#173a57')
            else:d.line(p,fill='#173a57',width=2)
im.save(out/'preview.png')
print(out/'preview.png')
