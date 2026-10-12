"""App inference: local cached official CLIP; stdin/out JSON, no image uploads."""
import json, sys
from pathlib import Path
import torch
from PIL import Image, ImageDraw
from transformers import AutoModel, AutoProcessor

torch.set_num_threads(4)
root=Path(__file__).resolve().parents[1]
vocab=json.loads((root/'src/lib/art/clipVocabulary.json').read_text(encoding='utf-8'))
checkpoint='openai/clip-vit-base-patch32'
model=AutoModel.from_pretrained(checkpoint,local_files_only=True,use_safetensors=False).eval()
processor=AutoProcessor.from_pretrained(checkpoint,local_files_only=True)
def features(out): return out if torch.is_tensor(out) else out.pooler_output
with torch.inference_mode():
    text=processor(text=['a black line outline drawing of '+v['english']+' on a white background' for v in vocab],padding=True,return_tensors='pt')
    embeddings=torch.nn.functional.normalize(features(model.get_text_features(**text)),dim=-1)

payload=json.load(sys.stdin)
results=[]
for start in range(0,len(payload['lines']),8):
    images=[]
    for line in payload['lines'][start:start+8]:
        image=Image.new('RGB',(896,896),'white')
        points=[(448+x*896*.85,448-y*896*.85) for x,y in line]
        ImageDraw.Draw(image).line(points,fill='#111111',width=8,joint='curve')
        images.append(image.resize((224,224),Image.Resampling.LANCZOS))
    with torch.inference_mode():
        inputs=processor(images=images,return_tensors='pt')
        scores=(torch.nn.functional.normalize(features(model.get_image_features(**inputs)),dim=-1)@embeddings.T).tolist()
    for values in scores:
        ranked=sorted(range(len(values)),key=lambda i:values[i],reverse=True)
        winner=next(i for i in ranked if not vocab[i]['excluded'])
        competitor=max(values[i] for i in ranked if i!=winner)
        # Uncalibrated conservative pilot gate, including excluded generic shapes
        # as competitors. Never promote a skipped winner to a confident object.
        margin=values[winner]-competitor
        accepted=ranked[0]==winner and values[winner]>=.30 and margin>=.003
        results.append({'name':vocab[winner]['english'],'label':vocab[winner]['label'],'prob':values[winner],'margin':margin,'accepted':accepted,'model':'clip'})
json.dump({'results':results,'policy':'clip-margin-v1-uncalibrated'},sys.stdout,ensure_ascii=True)
