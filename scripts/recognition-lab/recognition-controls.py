"""Frozen template/held-out-sketch diagnostic; these are NOT actual road results."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import random
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2]
PRIMARY='01a19aed-73d8-7662-81ef-5d6ec2287589'
def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
review=module('diversity_review','diversity-review.py')
scoring=module('diversity_scoring','diversity-score.py')
def sha(raw):return hashlib.sha256(raw).hexdigest()
def read(p):return json.loads(p.read_text(encoding='utf-8'))
def write(p,d):
    with p.open('x',encoding='utf-8') as stream:json.dump(d,stream,ensure_ascii=False,indent=2,allow_nan=False)


def draw_strokes(strokes):
    points=[p for s in strokes for p in s]
    if not points or any(len(p)!=2 or any(not isinstance(v,(int,float)) or not math.isfinite(v) for v in p) for p in points):raise ValueError('Invalid strokes')
    xs,ys=zip(*points);extent=max(max(xs)-min(xs),max(ys)-min(ys))
    if extent<=0:raise ValueError('Degenerate input')
    cx,cy=(max(xs)+min(xs))/2,(max(ys)+min(ys))/2
    im=Image.new('RGB',(300,300),'white');d=ImageDraw.Draw(im)
    for stroke in strokes:
        xy=[(150+(x-cx)*260/extent,150-(y-cy)*260/extent) for x,y in stroke]
        if len(xy)>1:d.line(xy,fill='#172f45',width=3)
        elif xy:
            x,y=xy[0];d.ellipse((x-1,y-1,x+1,y+1),fill='#172f45')
    return im


def export(catalog_path,dataset_path,protocol_path,out):
    if out.exists():raise ValueError('Use an entirely new diagnostic folder')
    catalog=read(catalog_path)['catalog'];dataset=read(dataset_path)
    if len(catalog)!=25 or len({c['key'] for c in catalog})!=25:raise ValueError('Keep all25 target kinds')
    classes=dataset['classes'];objects={c['name'] for c in classes if c['object']}
    tests=[r for r in dataset['records'] if r['split']=='test'];items=[];missing=[]
    def take(name,count):
        ordered=sorted((r for r in tests if r['className']==name),key=lambda r:(sha(('v15-control-v1|'+r['groupSHA256']+'|'+r['id']).encode()),r['id']))
        rows=[];seen=set()
        for row in ordered:
            if row['groupSHA256'] in seen:continue
            rows.append(row);seen.add(row['groupSHA256'])
            if len(rows)==count:break
        if len(rows)!=count:raise ValueError('Insufficient frozen test examples: '+name)
        return rows
    for c in catalog:
        items.append({'group':'template','target':c['key'],'kind':c['kind'],'strokes':[c['shape']['points']],'sourceId':None})
        matches=[name for name in c['aliases'] if name in objects]
        if not matches:
            missing.append({'target':c['key'],'group':'sketch','planned':2,'reason':'unsupported source class'});continue
        for row in take(matches[0],2):
            items.append({'group':'sketch','target':c['key'],'kind':c['kind'],'strokes':row['strokes'],'sourceId':row['id'],
                          'className':row['className'],'sourceGroup':row['groupSHA256'],'sourceRecognized':row['sourceRecognized']})
    generic=[c['name'] for c in classes if not c['object']]
    if len(generic)!=8:raise ValueError('Eight fixed generic competition classes required')
    for name in generic:
        for row in take(name,2):items.append({'group':'generic','target':None,'kind':'competition','strokes':row['strokes'],
            'sourceId':row['id'],'className':name,'sourceGroup':row['groupSHA256'],'sourceRecognized':row['sourceRecognized']})
    if len(items)!=89 or sum(x['planned'] for x in missing)!=2 or missing[0]['target']!='rocket':raise ValueError('Frozen89-image scope changed')
    ids=[x['sourceId'] for x in items if x['sourceId']]
    if len(set(ids))!=len(ids):raise ValueError('Repeated source example')
    groups=[x['sourceGroup'] for x in items if x['sourceId']]
    if len(set(groups))!=len(groups):raise ValueError('Repeated source geometry group across classes')
    random.Random(2026110315).shuffle(items);out.mkdir(parents=True)
    pages=[];mapping=[];cards=[]
    for start in range(0,len(items),15):
        part=items[start:start+15];canvas=Image.new('RGB',(900,((len(part)+2)//3)*330),'white');d=ImageDraw.Draw(canvas)
        for j,item in enumerate(part):
            token=f'Q{start+j+1:03d}';image=draw_strokes(item['strokes']);image.save(out/(token+'.png'))
            x,y=(j%3)*300,(j//3)*330;canvas.paste(image,(x,y+30));d.text((x+12,y+8),token,fill='#172f45')
            mapping.append({k:v for k,v in item.items() if k!='strokes'}|{'token':token,'imageSHA256':sha((out/(token+'.png')).read_bytes()),'strokeCount':len(item['strokes'])})
            cards.append(f'<article data-token="{token}"><h2>{token}</h2><img src="{token}.png" width="300" height="300" alt="이름 없는 선 그림"><label>무엇처럼 보였나요?<input required autocomplete="off"></label><label>명확도<select required><option value="">선택</option><option value="clear">명확한 사물</option><option value="weak">약한 연상</option><option value="none">없음 / 일반 도형</option></select></label></article>')
        page=out/f'page-{start//15+1}.png';canvas.save(page);pages.append({'file':page.name,'SHA256':sha(page.read_bytes())})
    manifest={'catalogSHA256':sha(catalog_path.read_bytes()),'datasetSHA256':sha(dataset_path.read_bytes()),'protocolSHA256':sha(protocol_path.read_bytes()),
        'rendererSHA256':sha(Path(__file__).read_bytes()),'mapping':mapping,'missing':missing,'pages':pages,'plannedSketches':50,'observedSketches':48,
        'humanRecognitionMeasured':False,'actualRoadsIncluded':False,'rule':'All strokes;300px/3px/260px extent;fixed original orientation;test-group-ID hash first2;seed2026110315'}
    manifest['fingerprint']=sha(json.dumps(manifest,sort_keys=True).encode());write(out/'mapping.json',manifest)
    page=review.anonymous_page(cards,manifest['fingerprint']).replace('실제 경로 자유 명명','선 그림 자유 명명').replace('이 길은 무엇처럼 보이나요?','이 선은 무엇처럼 보이나요?').replace('모든 경로의','모든 그림의')
    (out/'blind.html').write_text(page,encoding='utf-8')
    return manifest


def aggregate(manifest,catalog,reviews):
    if len(reviews)!=3:raise ValueError('Exactly three AI reviews required')
    reviews=sorted(reviews,key=lambda r:(r.get('evaluatorAgent')!=PRIMARY,str(r.get('evaluatorAgent'))))
    identities=[r.get('evaluatorAgent') for r in reviews]
    if not all(identities) or len(set(identities))!=3:raise ValueError('Distinct AI identities required')
    if identities[0]!=PRIMARY:raise ValueError('The preregistered primary AI rater is required')
    expected={x['token'] for x in manifest['mapping']};raters=[]
    for review in reviews:
        if review['fingerprint']!=manifest['fingerprint']:raise ValueError('Wrong diagnostic fingerprint')
        answers=review.get('results',[]);rows={a['token']:a for a in answers}
        if len(rows)!=len(answers) or set(rows)!=expected:raise ValueError('Every displayed image needs one rating')
        if any(a['clarity'] not in ('clear','weak','none') or not str(a['name']).strip() for a in answers):raise ValueError('Invalid answer')
        raters.append(rows)
    aliases={c['key']:{scoring.normalize_name(s) for s in c['freeNameAliases']} for c in catalog}
    cases=[]
    for item in manifest['mapping']:
        answers=[r[item['token']] for r in raters]
        votes=sum(a['clarity']=='clear' and scoring.normalize_name(a['name']) in aliases.get(item['target'],set()) for a in answers)
        cases.append({**item,'targetClear':votes>=2,'clearVotes':votes,'clearAny':sum(a['clarity']=='clear' for a in answers)>=2,'ratings':answers})
    groups={group:{'observations':sum(c['group']==group for c in cases),'targetClear':sum(c['targetClear'] for c in cases if c['group']==group),
                   'clearAny':sum(c['clearAny'] for c in cases if c['group']==group)} for group in ['template','sketch','generic']}
    t,s=groups['template']['targetClear'],groups['sketch']['targetClear']
    branch='road mapping/selection diagnostic priority' if t>=18 and s>=36 else 'single-outline ambiguity diagnostic priority' if s>=36 else 'insufficient diagnostic evidence; inspect ambiguity and rater variation'
    per_rater=[]
    for index,identity in enumerate(identities):
        hits=lambda group,kind=None:sum(c['group']==group and (kind is None or c.get('kind')==kind)
            and c['ratings'][index]['clarity']=='clear' and scoring.normalize_name(c['ratings'][index]['name']) in aliases.get(c['target'],set()) for c in cases)
        per_rater.append({'evaluatorAgent':identity,'templateTargetClear':hits('template'),'sketchTargetClear':hits('sketch'),
            'animalTemplateTargetClear':hits('template','animal'),'animalSketchTargetClear':hits('sketch','animal'),
            'genericClearAny':sum(c['group']=='generic' and c['ratings'][index]['clarity']=='clear' for c in cases)})
    primary=per_rater[0]
    primary['templateDiagnosticMet']=primary['templateTargetClear']>=18 and primary['animalTemplateTargetClear']>=8
    primary['sketchDiagnosticMet']=primary['sketchTargetClear']>=36 and primary['animalSketchTargetClear']>=16
    matched={c['target'] for c in cases if c['group']=='sketch'}
    paired={group:sum(sum(c['targetClear'] for c in cases if c['group']==group and c['target']==key)
                /sum(c['group']==group and c['target']==key for c in cases) for key in matched)/len(matched)
            for group in ('template','sketch')} if matched else {}
    return {'fingerprint':manifest['fingerprint'],'evaluationType':'AI diagnostic;not actual-road or human achievement','raters':identities,'groups':groups,'cases':cases,
        'perRater':per_rater,'primary':primary,'matchedTargetKinds':len(matched),'matchedKindMacroTargetClear':paired,
        'missingSketchSources':manifest['missing'],'plannedSketches':50,'observedSketches':48,'diagnosticBranch':branch,
        'humanRecognitionMeasured':False,'actualRoadRecognitionMeasured':False,'priorRoadNumeratorChanged':False}


def verify_files(mapping_path,catalog_path):
    value=read(mapping_path);frozen={k:v for k,v in value.items() if k!='fingerprint'}
    if sha(json.dumps(frozen,sort_keys=True).encode())!=value['fingerprint']:raise ValueError('Manifest changed')
    if sha(catalog_path.read_bytes())!=value['catalogSHA256']:raise ValueError('Frozen catalog changed')
    for page in value['pages']:
        if sha((mapping_path.parent/page['file']).read_bytes())!=page['SHA256']:raise ValueError('Review page changed')
    for item in value['mapping']:
        if sha((mapping_path.parent/(item['token']+'.png')).read_bytes())!=item['imageSHA256']:raise ValueError('Individual review image changed')
    return value


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);sub=p.add_subparsers(dest='command',required=True)
    e=sub.add_parser('export');e.add_argument('--catalog',type=Path,required=True);e.add_argument('--dataset',type=Path,required=True);e.add_argument('--protocol',type=Path,required=True);e.add_argument('--out',type=Path,required=True)
    e=sub.add_parser('score');e.add_argument('--mapping',type=Path,required=True);e.add_argument('--catalog',type=Path,required=True);e.add_argument('--review',type=Path,action='append',required=True);e.add_argument('--out',type=Path,required=True)
    args=p.parse_args()
    if args.command=='export':
        value=export(args.catalog,args.dataset,args.protocol,args.out);print(json.dumps({'images':len(value['mapping']),'pages':len(value['pages']),'fingerprint':value['fingerprint']}))
    else:
        value=verify_files(args.mapping,args.catalog)
        result=aggregate(value,read(args.catalog)['catalog'],[read(x) for x in args.review]);write(args.out,result);print(json.dumps(result['groups']))
