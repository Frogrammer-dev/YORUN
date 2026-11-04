"""Small authenticated ImageNet acquisition pilot, not a training cohort."""
import json
from pathlib import Path
from datasets import load_dataset

root=Path('eval/recognition/imagenet-contour-20261028')
(root/'images').mkdir(parents=True,exist_ok=True)
revision='49e2ee26f3810fb5a7536bbf732a7b07389a47b5'
ds=load_dataset('ILSVRC/imagenet-1k',revision=revision,split='train',streaming=True,token=True)
records=[]
for i,r in enumerate(ds.take(24)):
    name=f'train-first-{i:04d}.png'
    r['image'].convert('RGB').save(root/'images'/name)
    records.append({'id':name[:-4],'label':int(r['label']),'labelName':ds.features['label'].int2str(r['label']),'image':'images/'+name,'source':f'ILSVRC/imagenet-1k@{revision}/train row {i}','reviewed':False})
    print(i+1,records[-1]['labelName'],flush=True)
(root/'acquisition.json').write_text(json.dumps({'purpose':'acquisition and segmentation pilot, not representative training data','revision':revision,'records':records},indent=2))
