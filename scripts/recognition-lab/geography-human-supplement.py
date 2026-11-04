"""Build the v20 human screen: the fixed v19 pictures plus every remaining AI-majority-clear picture.

The stratum is written only to the mapping outside public/, never to the screen.
"""
import argparse
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('geography_review',HERE/'geography-review.py')
geo=importlib.util.module_from_spec(spec);spec.loader.exec_module(geo)


def load(path):return json.loads(Path(path).read_text(encoding='utf-8'))


def ai_clear_pixels(batch,raters):
    answers=[{r['token']:r for r in rater['results']} for rater in raters]
    return {m['pixelSHA256'] for m in batch['mapping'] if sum(a[m['token']]['clarity']=='clear' for a in answers)>=2}


def select(fixed,clear,batch_pixels):
    """Return pixel -> stratum. Every fixed picture stays; a supplement picture must exist in the AI batch."""
    fixed_pixels={m['pixelSHA256'] for m in fixed['mapping']}
    if not fixed_pixels<=batch_pixels:raise ValueError('A fixed picture has no frozen AI answer')
    return {**{p:'aiClearSupplement' for p in clear-fixed_pixels},**{p:'fixed' for p in fixed_pixels}}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--v19',type=Path,required=True);p.add_argument('--answers',type=Path,required=True)
    p.add_argument('--screen',type=Path,required=True);p.add_argument('--mapping',type=Path,required=True)
    args=p.parse_args()
    if args.screen.exists() or args.mapping.exists():raise ValueError('Preserve existing outputs')
    fixed=load(args.v19/'human-mapping.json');batch=load(args.v19/'review-ai'/'mapping.json')
    raters=[load(args.answers/f'ai-review-v19-rater{i}.json') for i in (1,2,3)]
    if {r['fingerprint'] for r in raters}!={batch['fingerprint']}:raise ValueError('AI answers belong to a different batch')
    strata=select(fixed,ai_clear_pixels(batch,raters),{m['pixelSHA256'] for m in batch['mapping']})
    pictures=geo.collect(args.v19/'retrieval')
    if not set(strata)<=set(pictures):raise ValueError('Rendered pixels differ from the frozen pictures')
    uses={m['pixelSHA256']:m['uses'] for m in fixed['mapping']}
    pixels=sorted(strata,key=lambda x:geo.order('v20-human-order',x))
    token=lambda i:f'H{i+1:03d}'
    cards=[geo.CARD.format(t=token(i),s=geo.review.svg(pictures[x]['points'])) for i,x in enumerate(pixels)]
    mapping=[{'token':token(i),'pixelSHA256':x,'stratum':strata[x],'uses':uses.get(x,[])} for i,x in enumerate(pixels)]
    fingerprint=geo.sha(json.dumps(mapping,sort_keys=True).encode())
    args.screen.mkdir(parents=True);(args.screen/'blind.html').write_text(geo.base.anonymous_page(cards,fingerprint),encoding='utf-8')
    args.mapping.parent.mkdir(parents=True,exist_ok=True)
    args.mapping.write_text(json.dumps({'fingerprint':fingerprint,'requests':fixed['requests'],'pictures':len(mapping),'mapping':mapping},indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({'fingerprint':fingerprint,'pictures':len(mapping),'fixed':sum(m['stratum']=='fixed' for m in mapping),'supplement':sum(m['stratum']!='fixed' for m in mapping)}))
