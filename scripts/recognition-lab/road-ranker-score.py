"""Join frozen anonymous free-naming answers with their selection slots."""
import argparse
from collections import Counter
import json
from pathlib import Path


def score(mapping, review):
    if mapping['fingerprint']!=review['fingerprint']:
        raise ValueError('Review belongs to a different frozen study')
    rows=review.get('results',review.get('answers',[]))
    lookup={r['token']:r for r in rows}
    if len(rows)!=len(lookup) or set(lookup)!={r['token'] for r in mapping['mapping']}:
        raise ValueError('Every anonymous image must have exactly one answer')
    if any(r.get('clarity') not in ('clear','weak','none') or not str(r.get('name','')).strip() for r in rows):
        raise ValueError('Missing free name or invalid clarity')
    tokens={r.get('viewKey',r['id']):r['token'] for r in mapping['mapping']}
    methods={}
    slots=[]
    for slot in mapping['slots']:
        key=slot.get('viewKey',slot['id'])
        token=tokens[key] if key else None
        answer=lookup[token] if token else {'name':None,'clarity':'none'}
        result={**slot,'token':token,'name':answer['name'],'clarity':answer['clarity'],'abstained':token is None}
        slots.append(result)
        method=methods.setdefault(slot['method'],{'denominator':0,'clear':0,'weak':0,'none':0,'abstentions':0,'areas':{}})
        method['denominator']+=1;method[answer['clarity']]+=1;method['abstentions']+=token is None
        area=method['areas'].setdefault(slot['area'],{'denominator':0,'clear':0})
        area['denominator']+=1;area['clear']+=answer['clarity']=='clear'
    for method in methods.values():method['clearRate']=method['clear']/method['denominator']
    delta=methods['model']['clear']-methods['baseline']['clear']
    return {'fingerprint':mapping['fingerprint'],'evaluationType':review.get('evaluationType','individual human response; not a multi-rater study'),
            'methods':methods,'clearCountDelta':delta,'aiSurrogateCriterionMet':delta>=2 if review.get('evaluationType','').startswith('AI') else None,
            'slots':slots,'humanMajorityRecognitionMeasured':False,'targetNameAgreementAssessed':False}


def score_majority(mapping,reviews):
    if len(reviews)!=3:raise ValueError('The reliability plan requires exactly three AI reviews')
    individual=[score(mapping,r) for r in reviews]
    raters=[r.get('evaluatorAgent') for r in reviews]
    if any(not r for r in raters) or len(set(raters))!=3:raise ValueError('Three distinct evaluator IDs are required')
    answers=[];votes=[]
    for item in mapping['mapping']:
        token=item['token'];rows=[next(row for row in r['results'] if row['token']==token) for r in reviews]
        counts=Counter(r['clarity'] for r in rows);names=Counter(r['name'] for r in rows)
        clear_names=Counter(r['name'] for r in rows if r['clarity']=='clear')
        clarity='clear' if counts['clear']>=2 else 'none' if counts['none']>=2 else 'weak'
        name=names.most_common(1)[0][0]
        answers.append({'token':token,'name':name,'clarity':clarity})
        votes.append({'token':token,'clarityVotes':dict(counts),'names':dict(names),'exactSameNameClearVotes':max(clear_names.values(),default=0)})
    combined={'fingerprint':mapping['fingerprint'],'evaluationType':'AI surrogate majority, not human evaluation','results':answers}
    return {'fingerprint':mapping['fingerprint'],'raters':raters,'individual':individual,'majority':score(mapping,combined),'votes':votes,
            'originalSingleRaterCriterionPreserved':True,'humanRecognitionMeasured':False,'limitations':'Related AI models; correlated errors possible; developer-selected repeated regions.'}


def score_human_majority(mapping,reviews):
    """Aggregate explicitly supplied human answers; never relabel AI judgments as human."""
    if len(reviews)<3:raise ValueError('At least three independent human responses are required')
    codes=[str(r.get('reviewerCode','')).strip() for r in reviews]
    if any(not c for c in codes) or len(set(codes))!=len(codes):raise ValueError('Human reviewer codes must be nonempty and distinct')
    if any(r.get('evaluatorAgent') or 'ai' in str(r.get('evaluationType','')).lower() for r in reviews):
        raise ValueError('AI judgments cannot be imported as human responses')
    individual=[score(mapping,r) for r in reviews]
    threshold=len(reviews)//2+1;answers=[];votes=[]
    for item in mapping['mapping']:
        token=item['token']
        rows=[next(row for row in r.get('answers',r.get('results',[])) if row['token']==token) for r in reviews]
        counts=Counter(r['clarity'] for r in rows);names=Counter(r['name'].strip() for r in rows)
        clear_names=Counter(r['name'].strip() for r in rows if r['clarity']=='clear')
        clarity='clear' if counts['clear']>=threshold else 'none' if counts['none']>=threshold else 'weak'
        answers.append({'token':token,'name':names.most_common(1)[0][0],'clarity':clarity})
        votes.append({'token':token,'clarityVotes':dict(counts),'names':dict(names),'exactSameNameClearVotes':max(clear_names.values(),default=0)})
    aggregate=score(mapping,{'fingerprint':mapping['fingerprint'],'evaluationType':'user-supplied independent human responses','answers':answers})
    aggregate['humanMajorityRecognitionMeasured']=True
    for method in aggregate['methods'].values():
        method['requestCount']=len(method['areas'])
        method['requestsWithClear']=sum(a['clear']>0 for a in method['areas'].values())
        method['requestSuccessRate']=method['requestsWithClear']/method['requestCount'] if method['requestCount'] else 0
    return {'fingerprint':mapping['fingerprint'],'reviewerCodes':codes,'reviewerCount':len(reviews),'majorityThreshold':threshold,
            'individual':individual,'majority':aggregate,'votes':votes,'humanRecognitionMeasured':True,
            'reviewerIdentityVerified':False,'responseSource':'Explicit --human-review inputs supplied by the caller, not generated judgments',
            'limitations':'Codes do not authenticate people or prove independent participation; retain collection records.'}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mapping',type=Path,required=True)
    parser.add_argument('--review',type=Path)
    parser.add_argument('--additional-review',type=Path,action='append',default=[])
    parser.add_argument('--human-review',type=Path,action='append',default=[])
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    mapping=json.loads(args.mapping.read_text(encoding='utf-8'))
    if args.human_review:
        if args.review or args.additional_review:parser.error('Do not mix human and AI/single-review inputs')
        result=score_human_majority(mapping,[json.loads(p.read_text(encoding='utf-8')) for p in args.human_review])
    else:
        if not args.review:parser.error('--review or at least three --human-review inputs are required')
        reviews=[json.loads(path.read_text(encoding='utf-8')) for path in [args.review,*args.additional_review]]
        result=score_majority(mapping,reviews) if len(reviews)>1 else score(mapping,reviews[0])
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    compact=result['majority'] if 'majority' in result else result
    print(json.dumps({k:v for k,v in compact.items() if k!='slots'},ensure_ascii=True))
