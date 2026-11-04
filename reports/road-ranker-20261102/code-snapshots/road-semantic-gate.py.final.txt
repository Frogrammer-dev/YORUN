"""Frozen proposal/CLIP semantic-agreement gate. No route geometry changes."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

ALIASES={'house':{'house'},'tree':{'tree'},'car':{'car'},'airplane':{'airplane'},'mug':{'coffee_cup','cup'},'rocket':{'rocket'}}
TOOL_ALIASES={'tshirt':{'t-shirt'},'pants':{'pants'},'hammer':{'hammer'},'bottle':{'wine_bottle'},'key':{'key'},'chair':{'chair'}}


def gate_record(row, extended=False):
    out=copy.deepcopy(row)
    intent=row.get('proposalShape')
    aliases={**ALIASES,**TOOL_ALIASES} if extended else ALIASES
    matches=[view for view in row.get('rotationAudit',[]) if view['accepted'] and view['predictedClass'] in aliases.get(intent,set())]
    best=max(matches,key=lambda r:(r['score'],-r['rotation'])) if matches else None
    if best:
        similarity=row['generatorSimilarity']
        if not math.isfinite(similarity) or not 0<=similarity<=100:raise ValueError('Invalid generator similarity')
        out.update(best)
        out['cosine']=best['score']
        out['score']=best['score']*similarity/100
    else:
        out['cosine']=row['score']
        out['score']=0.
    out['accepted']=bool(best)
    out['semanticAgreement']=bool(best)
    out['rankingScore']=out['score']
    out['reason']='generator intent and full-vocabulary CLIP winner agree' if best else 'no supported proposal-view agreement'
    out['coordinatesUnchanged']=True
    return out


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--extended-templates',action='store_true')
    args=parser.parse_args()
    if args.output.exists():raise ValueError('Refusing to overwrite an existing experiment')
    raw=args.input.read_bytes();data=json.loads(raw)
    if data['method']!='clip-road-proposal-aligned-v4':raise ValueError('Expected v4 aligned CLIP predictions')
    outputs=[gate_record(row,args.extended_templates) for row in data['outputs']]
    aliases={**ALIASES,**TOOL_ALIASES} if args.extended_templates else ALIASES
    result={**data,'outputs':outputs,'method':'proposal-clip-agreement-v7' if args.extended_templates else 'proposal-clip-agreement-v5','sourcePredictionSHA256':hashlib.sha256(raw).hexdigest(),
            'gateCodeSHA256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'aliases':{k:sorted(v) for k,v in aliases.items()},
            'rankingFormula':'cosine * generatorSimilarity / 100; not a human probability','trained':False}
    args.output.write_text(json.dumps(result,ensure_ascii=False,allow_nan=False),encoding='utf-8')
    print(json.dumps({'candidates':len(outputs),'accepted':sum(r['accepted'] for r in outputs),'byArea':{area:sum(r['accepted'] for r in outputs if r['area']==area) for area in dict.fromkeys(r['area'] for r in outputs)}}))
