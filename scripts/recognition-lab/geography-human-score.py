"""Score human answers against the frozen v19 AI answers (protocol-v20-human-validity.md, amendment 1).

Precision uses every shown picture because all AI-clear pictures are shown. Recall, kappa and the
per-method target counts use only the fixed stratum, since the supplement was picked for being AI-clear.

Each --human-review is written as EXPOSURE=PATH, where EXPOSURE is none or prior.
"""
import argparse
from collections import Counter
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('diversity_score',HERE/'diversity-score.py')
scorer=importlib.util.module_from_spec(spec);spec.loader.exec_module(scorer)
normalize=scorer.normalize_name
MIN_NAIVE=3
MIN_HUMAN_CLEAR_FOR_RECALL=5
METHODS=('geometry','hand','image')


def load(path):return json.loads(Path(path).read_text(encoding='utf-8'))


def parse_review(text):
    exposure,sep,path=text.partition('=')
    if not sep or exposure not in ('none','prior'):raise ValueError('Use none=PATH or prior=PATH')
    return {**load(path),'exposure':exposure}


def validate(mapping,reviews):
    expected={m['token'] for m in mapping['mapping']};codes=[]
    for review in reviews:
        if review['fingerprint']!=mapping['fingerprint']:raise ValueError('Answer belongs to a different study')
        if review.get('evaluatorAgent'):raise ValueError('AI judgments cannot be human answers')
        code=str(review.get('reviewerCode','')).strip()
        if not code:raise ValueError('Reviewer code required')
        codes.append(code)
        tokens=[a['token'] for a in review['answers']]
        if len(tokens)!=len(set(tokens)) or set(tokens)!=expected:raise ValueError(f'{code}: every picture needs exactly one answer')
        if any(a['clarity'] not in ('clear','weak','none') or not str(a['name']).strip() for a in review['answers']):raise ValueError(f'{code}: invalid name or clarity')
    if len(codes)!=len(set(codes)):raise ValueError('Reviewer codes must be distinct')


def majority(rows):
    """rows is one answer per rater for one picture."""
    threshold=len(rows)//2+1
    votes=Counter(r['clarity'] for r in rows)
    clarity='clear' if votes['clear']>=threshold else 'none' if votes['none']>=threshold else 'weak'
    return {'clarity':clarity,'clear':clarity=='clear','votes':dict(votes),'names':[r['name'] for r in rows if r['clarity']=='clear'],'threshold':threshold}


def alias_table(catalog):
    table={}
    for item in catalog:
        for name in item['freeNameAliases']:table.setdefault(normalize(name),set()).add(item['key'])
    return table


def clear_keys(names,aliases,threshold):
    counts=Counter()
    for name in names:
        for key in aliases.get(normalize(name),()):counts[key]+=1
    return {key for key,n in counts.items() if n>=threshold}


def clear_exact(names,threshold):
    return {name for name,n in Counter(normalize(n) for n in names).items() if n>=threshold}


def kappa(tp,fp,fn,tn):
    n=tp+fp+fn+tn
    if not n:return None
    observed=(tp+tn)/n
    chance=((tp+fp)*(tp+fn)+(fn+tn)*(fp+tn))/(n*n)
    return None if chance==1 else (observed-chance)/(1-chance)


def verdict(naive,precision,human_clear_fixed,recall):
    if naive<MIN_NAIVE:return 'pilot'
    if precision is None:raise ValueError('The screen must show AI-clear pictures')
    if precision<.5:return 'ai_proxy_unsuitable'
    if human_clear_fixed>=MIN_HUMAN_CLEAR_FOR_RECALL and recall<.3:return 'ai_proxy_unsuitable'
    if precision>=.7:return 'ai_clear_supported'
    return 'hold'


def analyse(mapping,batch,ai_raters,reviews,catalog):
    aliases=alias_table(catalog);kinds={c['key']:c['kind'] for c in catalog}
    human_by_token=[{a['token']:a for a in r['answers']} for r in reviews]
    ai_by_token=[{a['token']:a for a in r['results']} for r in ai_raters]
    ai_token_by_pixel={m['pixelSHA256']:m['token'] for m in batch['mapping']}
    pictures=[];tp=fp=fn=tn=0;ai_all=ai_all_human=0;both_named=both_same=0;unmatched=[]
    for item in mapping['mapping']:
        token=item['token']
        if item['pixelSHA256'] not in ai_token_by_pixel:raise ValueError(f'{token}: no frozen AI answer for this picture')
        ai_token=ai_token_by_pixel[item['pixelSHA256']]
        human=majority([r[token] for r in human_by_token]) if reviews else None
        ai=majority([r[ai_token] for r in ai_by_token])
        human_clear=bool(human and human['clear']);stratum=item.get('stratum','fixed')
        ai_all+=ai['clear'];ai_all_human+=ai['clear'] and human_clear
        if stratum=='fixed':
            tp+=human_clear and ai['clear'];fp+=ai['clear'] and not human_clear
            fn+=human_clear and not ai['clear'];tn+=not human_clear and not ai['clear']
        row={'token':token,'stratum':stratum,'aiToken':ai_token,'human':human,'ai':ai,'uses':item['uses']}
        if human:
            human_keys=clear_keys(human['names'],aliases,human['threshold'])
            unmatched+=[{'token':token,'name':n} for n in human['names'] if normalize(n) not in aliases]
            row['humanCatalogKeys']=sorted(human_keys)
            if human_clear and ai['clear']:
                both_named+=1
                ai_keys=clear_keys(ai['names'],aliases,ai['threshold'])
                same=bool(human_keys&ai_keys) or bool(clear_exact(human['names'],human['threshold'])&clear_exact(ai['names'],ai['threshold']))
                row['sameNameAsAI']=same;both_same+=same
        pictures.append(row)
    precision=ai_all_human/ai_all if ai_all else None
    recall=tp/(tp+fn) if tp+fn else None
    methods={m:{'requests':0,'targetClear':0,'clearAny':0,'animalTargetClear':0,'objectTargetClear':0,'targetClearCases':[]} for m in METHODS}
    for row in pictures:
        for use in row['uses'] if row['stratum']=='fixed' else ():
            bucket=methods[use['method']];bucket['requests']+=1
            if row['human'] and row['human']['clear']:
                bucket['clearAny']+=1
                if use['proposalShape'] in row.get('humanCatalogKeys',[]):
                    bucket['targetClear']+=1
                    bucket[f"{kinds[use['proposalShape']]}TargetClear"]+=1
                    bucket['targetClearCases'].append([use['area'],use['proposalShape'],row['token']])
    for method,bucket in methods.items():
        if bucket['requests']!=mapping['requests']:raise ValueError(f'{method}: expected {mapping["requests"]} fixed requests')
    return {'participants':[{'reviewerCode':r['reviewerCode'],'exposure':r['exposure'],'createdAt':r.get('createdAt'),'clear':sum(a['clarity']=='clear' for a in r['answers']),'weak':sum(a['clarity']=='weak' for a in r['answers']),'none':sum(a['clarity']=='none' for a in r['answers'])} for r in reviews],
        'pictures':len(pictures),'fixedConfusion':{'bothClear':tp,'aiOnlyClear':fp,'humanOnlyClear':fn,'neitherClear':tn},
        'aiClearAll':ai_all,'aiClearAlsoHumanClear':ai_all_human,'humanClearFixed':tp+fn,'aiMissedFixed':fn,
        'precision':precision,'recallFixed':recall,'kappaFixedReportOnly':kappa(tp,fp,fn,tn),
        'bothClearSameName':both_same,'bothClearDenominator':both_named,'unregisteredHumanClearNames':unmatched,
        'methods':methods,'perPicture':pictures}


def score(mapping,batch,ai_raters,reviews,catalog):
    if len(ai_raters)!=3:raise ValueError('Three frozen AI raters required')
    for rater in ai_raters:
        if rater['fingerprint']!=batch['fingerprint']:raise ValueError('AI answers belong to a different batch')
    validate(mapping,reviews)
    naive=[r for r in reviews if r['exposure']=='none']
    primary=analyse(mapping,batch,ai_raters,naive,catalog)
    decision=verdict(len(naive),primary['precision'],primary['humanClearFixed'],primary['recallFixed'])
    return {'fingerprint':mapping['fingerprint'],'protocol':'protocol-v20-human-validity.md','humanRecognitionMeasured':bool(reviews),
        'naiveParticipants':len(naive),'priorExposureParticipants':len(reviews)-len(naive),'decision':decision,
        'primaryNaiveOnly':primary,
        'secondaryAllParticipants':analyse(mapping,batch,ai_raters,reviews,catalog) if len(naive)!=len(reviews) else None,
        'aliasPolicy':'Frozen catalog and normalization only; unregistered names are listed, never counted as matches',
        'limitations':'Small fixed sample from shared regions; not a human accuracy claim; not comparable with the 75-request AI counts'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mapping',type=Path,required=True);p.add_argument('--batch',type=Path,required=True)
    p.add_argument('--ai-review',type=Path,action='append',required=True);p.add_argument('--catalog',type=Path,required=True)
    p.add_argument('--human-review',action='append',default=[],help='none=PATH or prior=PATH')
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    if not args.human_review:p.error('No human answers: human recognition stays unmeasured')
    if args.output.exists():raise ValueError('Use a new output path')
    result=score(load(args.mapping),load(args.batch),[load(x) for x in args.ai_review],[parse_review(x) for x in args.human_review],load(args.catalog)['catalog'])
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    primary=result['primaryNaiveOnly']
    print(json.dumps({k:result[k] for k in ('decision','naiveParticipants','priorExposureParticipants')}|{k:primary[k] for k in ('aiClearAll','aiClearAlsoHumanClear','humanClearFixed','precision','recallFixed','kappaFixedReportOnly','fixedConfusion')},ensure_ascii=False))
