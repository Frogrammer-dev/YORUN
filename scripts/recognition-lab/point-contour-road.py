"""Infer without retraining; existing-path points are a diagnostic, not discovery."""
import importlib.util, json
from pathlib import Path
import numpy as np
import torch

spec=importlib.util.spec_from_file_location('pilot',Path(__file__).with_name('point-contour.py'))
pilot=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)
root=pilot.ROOT
manifest=json.loads((root/'manifest.json').read_text())
train_ids={r['id'] for r in manifest['records'] if r['split']=='train'}
pool={}
for name in pilot.CLASSES:
    pool[name]=[pilot.canonical(r['points']) for r in json.loads((root/f'{name}.selected.json').read_text()) if r['key_id'] in train_ids]
model=pilot.Model()
model.load_state_dict(torch.load(root/'model.pt',weights_only=True)['state_dict']);model.eval()
outputs=[]
with torch.no_grad():
    for r in json.loads((root/'road-inputs.json').read_text()):
        x=np.asarray(r['input'],dtype='float32')
        predicted=model(torch.tensor(x[None]),torch.tensor([pilot.CLASSES.index(r['class'])]))[0].numpy()
        candidates=pool[r['class']]
        distances=[np.linalg.norm(x[:,None,:]-p[None,:,:],axis=-1).min(1).mean() for p in candidates]
        outputs.append({**r,'predicted':predicted.tolist(),'retrieved':candidates[int(np.argmin(distances))].tolist()})
(root/'road-proposals.json').write_text(json.dumps(outputs))
print('Inferred',len(outputs),'existing road cases; no training or test tuning')
