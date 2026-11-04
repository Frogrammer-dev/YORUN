"""Expand v19 per-picture AI answers to each method and score them with the unmodified diversity scorer."""
import argparse
import importlib.util
import json
from pathlib import Path

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('diversity_score',HERE/'diversity-score.py')
scorer=importlib.util.module_from_spec(spec);spec.loader.exec_module(scorer)
METHODS={'geometry':'l','hand':'m','image':'n'}


def load(path):return json.loads(path.read_text(encoding='utf-8'))


def expand(batch,rater,method_mapping,method):
    by_use={}
    for picture in batch['mapping']:
        for use in picture['uses']:
            if use['method']==method:by_use[(use['area'],use['proposalShape'])]=picture['token']
    answers={r['token']:r for r in rater['results']}
    results=[{**answers[by_use[(row['area'],row['proposalShape'])]],'token':row['token']} for row in method_mapping['mapping']]
    return {'evaluatorAgent':rater['evaluatorAgent'],'fingerprint':method_mapping['fingerprint'],'results':results}


def primary_cases(reviews,mapping,catalog):
    aliases={c['key']:{scorer.normalize_name(n) for n in c['freeNameAliases']} for c in catalog}
    answers={r['token']:r for r in reviews[0]['results']};hits=[]
    for row in mapping['mapping']:
        answer=answers[row['token']]
        if answer['clarity']=='clear' and scorer.normalize_name(answer['name']) in aliases[row['proposalShape']]:hits.append([row['area'],row['proposalShape']])
    return hits


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--batch',type=Path,required=True);p.add_argument('--answers',type=Path,required=True)
    p.add_argument('--catalog',type=Path,required=True);p.add_argument('--public',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    args=p.parse_args();batch=load(args.batch);catalog=load(args.catalog)['catalog'];kinds={c['key']:c['kind'] for c in catalog}
    raters=[load(args.answers/f'ai-review-v19-rater{i}.json') for i in (1,2,3)]
    for rater in raters:
        if rater['fingerprint']!=batch['fingerprint']:raise ValueError('Wrong batch')
        if {r['token'] for r in rater['results']}!={m['token'] for m in batch['mapping']} or len(rater['results'])!=batch['pictures']:raise ValueError('Every picture needs one answer')
    summary={'evaluationType':'AI surrogate, not human evaluation','humanRecognitionMeasured':False,'pictures':batch['pictures'],'primaryRater':raters[0]['evaluatorAgent'],'raterClear':[sum(r['clarity']=='clear' for r in rater['results']) for rater in raters],'methods':{}}
    for method,letter in METHODS.items():
        mapping=load(args.public/f'route-study-20261103-{letter}'/'mapping.json')
        reviews=[expand(batch,rater,mapping,method) for rater in raters]
        result=scorer.aggregate(mapping,catalog,reviews)
        output=args.out/f'v19-{method}-ai-results.json'
        if output.exists():raise ValueError('Preserve existing results')
        output.write_text(json.dumps(result,indent=2,ensure_ascii=False),encoding='utf-8')
        target=[[c['area'],c['proposalShape']] for c in result['cases'] if c['targetClear']]
        primary=primary_cases(reviews,mapping,catalog)
        summary['methods'][method]={'requests':result['requests'],'clearTarget':len(target),'clearAny':sum(c['clearAny'] for c in result['cases']),
            'animalClearTarget':result['groups']['animal']['clearTarget'],'objectClearTarget':result['groups']['object']['clearTarget'],
            'primaryClearTarget':len(primary),'primaryCases':primary,'primaryAnimal':sum(kinds[k]=='animal' for _,k in primary),
            'targetClearCases':target,'strictDiversityPassed':result['diversityCriterionMet'],
            'speciesClearInTwoAreas':{k:result['groups'][k]['speciesClearInTwoAreas'] for k in result['groups']}}
    image,geometry=summary['methods']['image'],summary['methods']['geometry']
    gained=[c for c in image['primaryCases'] if c not in geometry['primaryCases']]
    animal=[c for c in gained if kinds[c[1]]=='animal']
    summary['frozenCriteria']={'primaryDifferenceImageMinusGeometry':image['primaryClearTarget']-geometry['primaryClearTarget'],'primaryAtLeast5':image['primaryClearTarget']-geometry['primaryClearTarget']>=5,
        'animalGainRequests':len(animal),'animalGainKinds':len({k for _,k in animal}),'animalAtLeast3Requests2Kinds':len(animal)>=3 and len({k for _,k in animal})>=2,
        'majorityImageAtLeast13':image['clearTarget']>=13,'strictDiversityImage':image['strictDiversityPassed'],
        'imageMinusHandMajority':image['clearTarget']-summary['methods']['hand']['clearTarget']}
    (args.out/'v19-final-counts.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))
