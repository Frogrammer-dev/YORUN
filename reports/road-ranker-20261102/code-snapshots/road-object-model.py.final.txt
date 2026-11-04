"""Run the frozen real-road proposal + visual-agreement model and blind export.

Input: already validated real graph paths from a proposal generator.
Output: unchanged road routes, conservative semantic selection, blind review, GPX.
The model is experimental; neither its scores nor its labels are human truth.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[2]
SCRIPTS=Path(__file__).resolve().parent


def run(script, *args):
    subprocess.run([sys.executable,str(SCRIPTS/script),*map(str,args)],cwd=ROOT,check=True)


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--public-out',type=Path,required=True)
    parser.add_argument('--reuse-predictions',type=Path)
    parser.add_argument('--extended-templates',action='store_true')
    args=parser.parse_args()
    raw=args.input.read_bytes();data=json.loads(raw)
    if data.get('status','complete')!='complete':raise ValueError('Source generation is incomplete')
    if any((args.out/name).exists() for name in ['clip.json','predictions.json','run.json']):
        raise ValueError('Use a new output folder to preserve previous runs')
    if (args.public_out/'mapping.json').exists():raise ValueError('Use a new review folder')
    args.out.mkdir(parents=True,exist_ok=True)
    began=time.perf_counter()
    extra=['--reuse-predictions',args.reuse_predictions] if args.reuse_predictions else []
    run('road-clip-ranker.py','--input',args.input,'--output',args.out/'clip.json','--align-proposals',*extra)
    gate_extra=['--extended-templates'] if args.extended_templates else []
    run('road-semantic-gate.py','--input',args.out/'clip.json','--output',args.out/'predictions.json',*gate_extra)
    run('road-ranker-review.py','--roads',args.input,'--predictions',args.out/'predictions.json','--out',args.public_out,'--use-rotation')
    predictions=json.loads((args.out/'predictions.json').read_text(encoding='utf-8'))
    mapping=json.loads((args.public_out/'mapping.json').read_text(encoding='utf-8'))
    summary={'inputSHA256':hashlib.sha256(raw).hexdigest(),'candidates':len(data['results']),
             'accepted':sum(r['accepted'] for r in predictions['outputs']),
             'recommendationSlots':sum(r['method']=='model' for r in mapping['slots']),
             'abstentions':sum(r['method']=='model' and r['id'] is None for r in mapping['slots']),
             'elapsedSeconds':time.perf_counter()-began,'reviewFingerprint':mapping['fingerprint'],
             'method':predictions['method'],'humanRecognitionMeasured':False,
             'newWeightsTrained':False,'appDefaultChanged':False,
             'coordinatePolicy':'Original validated graph path/latlon only. Rotation affects model/rendering input only.',
             'codeSHA256':{name:hashlib.sha256((SCRIPTS/name).read_bytes()).hexdigest() for name in ['road-object-model.py','road-clip-ranker.py','road-semantic-gate.py','road-ranker-review.py']}}
    (args.out/'run.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=True),flush=True)
