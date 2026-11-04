"""Score the fixed25-kind sample without turning a different animal into the target."""
import argparse
from collections import Counter
import json
from pathlib import Path
import unicodedata


def normalize_name(value):
    return ''.join(c for c in unicodedata.normalize('NFKC',value).casefold() if c.isalnum())


def aggregate(mapping,catalog,reviews,human=False):
    if len(reviews)<3 or (not human and len(reviews)!=3):raise ValueError('Three AI raters or at least three human responses required')
    identity='reviewerCode' if human else 'evaluatorAgent'
    ids=[str(r.get(identity,'')).strip() for r in reviews]
    if any(not r for r in ids) or len(set(ids))!=len(ids):raise ValueError('Rater identities/codes must be nonempty and distinct')
    if human and any(r.get('evaluatorAgent') for r in reviews):raise ValueError('AI judgments cannot be treated as human answers')
    expected={r['token'] for r in mapping['mapping']};raters=[]
    for review in reviews:
        if review['fingerprint']!=mapping['fingerprint']:raise ValueError('Review belongs to a different frozen study')
        raw=review.get('results',review.get('answers',[]));by_token={r['token']:r for r in raw}
        if len(raw)!=len(by_token) or set(by_token)!=expected:raise ValueError('Every displayed image needs exactly one free-name answer')
        if any(r['clarity'] not in ('clear','weak','none') or not str(r['name']).strip() for r in raw):raise ValueError('Invalid name or clarity')
        raters.append(by_token)
    items={r['key']:r for r in catalog};aliases={}
    for item in catalog:
        for name in item['freeNameAliases']:aliases.setdefault(normalize_name(name),set()).add(item['key'])
    by_id={r['id']:r for r in mapping['mapping']};threshold=len(reviews)//2+1;cases=[]
    for slot in mapping['slots']:
        kind=items[slot['proposalShape']]['kind'];entry=by_id.get(slot['id']) if slot['id'] else None
        if entry is None:
            cases.append({**slot,'kind':kind,'token':None,'clarity':'not_measured_no_route','clearAny':False,'targetClear':False,'ratings':[],'missingRoute':True})
            continue
        token=entry['token'];rows=[r[token] for r in raters];clarities=Counter(r['clarity'] for r in rows);names=Counter(r['name'] for r in rows)
        matched=Counter()
        for row in rows:
            if row['clarity']=='clear':
                for key in aliases.get(normalize_name(row['name']),set()):matched[key]+=1
        clarity='clear' if clarities['clear']>=threshold else 'none' if clarities['none']>=threshold else 'weak'
        cases.append({**slot,'kind':kind,'token':token,'clarity':clarity,'clearAny':clarity=='clear',
            'targetClear':matched[slot['proposalShape']]>=threshold,'clearTargetVotes':matched[slot['proposalShape']],
            'otherKnownClearInterpretations':[key for key,n in matched.items() if n>=threshold and key!=slot['proposalShape']],
            'freeNames':dict(names),'clarityVotes':dict(clarities),'ratings':rows,'missingRoute':False})
    if len({(r['area'],r['proposalShape']) for r in cases})!=len(cases):raise ValueError('Duplicate request slot')
    species=[]
    for key,item in items.items():
        rows=[r for r in cases if r['proposalShape']==key]
        species.append({'key':key,'name':item['shape']['name'],'kind':item['kind'],'requests':len(rows),
            'validRoadRequests':sum(not r['missingRoute'] for r in rows),'clearAnyRequests':sum(r['clearAny'] for r in rows),
            'clearTargetRequests':sum(r['targetClear'] for r in rows),'weakRequests':sum(r['clarity']=='weak' for r in rows),
            'targetClearAreas':[r['area'] for r in rows if r['targetClear']],
            'headSupported':item['headSupported'],'clipSupported':item['clipSupported']})
    groups={}
    for kind in ('animal','object'):
        rows=[r for r in cases if r['kind']==kind]
        groups[kind]={'requests':len(rows),'validRoadRequests':sum(not r['missingRoute'] for r in rows),
            'clearAny':sum(r['clearAny'] for r in rows),'clearTarget':sum(r['targetClear'] for r in rows),
            'weak':sum(r['clarity']=='weak' for r in rows),'none':sum(r['clarity']=='none' for r in rows),
            'speciesClearInTwoAreas':[s['key'] for s in species if s['kind']==kind and len(s['targetClearAreas'])>=2]}
    passed=all(len(groups[k]['speciesClearInTwoAreas'])>=3 for k in groups)
    return {'fingerprint':mapping['fingerprint'],'evaluationType':'user-supplied human responses' if human else 'AI surrogate, not human evaluation',
        'raters':ids,'majorityThreshold':threshold,'requests':len(cases),'displayedImages':len(expected),
        'groups':groups,'species':species,'cases':cases,'diversityCriterionMet':passed,
        'humanRecognitionMeasured':human,'raterIdentityVerified':False,'sampledGeneratorCandidatesOnly':True,'completePoolOracle':False,
        'aliasPolicy':'Frozen catalog; NFKC/casefold and punctuation/whitespace removal only; no post-hoc synonyms',
        'limitations':'Model-neutral first generated candidate per request; shared regions and related shapes; no independence or pool-wide upper bound implied.'}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--mapping',type=Path,required=True);p.add_argument('--catalog',type=Path,required=True)
    p.add_argument('--ai-review',type=Path,action='append',default=[]);p.add_argument('--human-review',type=Path,action='append',default=[])
    p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    if bool(args.ai_review)==bool(args.human_review):p.error('Choose AI reviews or human reviews, never both')
    if args.output.exists():raise ValueError('Use a new output path')
    data=json.loads(args.mapping.read_text(encoding='utf-8'))
    import hashlib
    catalog_bytes=args.catalog.read_bytes()
    if hashlib.sha256(catalog_bytes).hexdigest()!=data.get('catalogSHA256'):
        raise ValueError('Catalog differs from the frozen review catalog')
    catalog=json.loads(catalog_bytes)['catalog']
    reviews=[json.loads(path.read_text(encoding='utf-8')) for path in (args.human_review or args.ai_review)]
    result=aggregate(data,catalog,reviews,bool(args.human_review))
    args.output.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps({k:result[k] for k in ('requests','displayedImages','groups','diversityCriterionMet','humanRecognitionMeasured')},ensure_ascii=True))
