"""v19 review export: per-method study pages, a deduplicated AI batch and the fixed human screen.

Reuses the frozen v18 review renderer. Mappings for the anonymous AI and human sets stay outside
public/ so the name, area and method are not one click away from the screen.
"""
import argparse
import hashlib
import importlib.util
import io
import json
from pathlib import Path
from PIL import Image,ImageDraw

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('diversity_review',HERE/'diversity-review.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
review=base.review
AREAS={'chuncheon-center':'춘천 중심부','changwon-center':'창원 중심부','busan-yeongdo':'부산 영도'}
METHODS={'geometry':'l','hand':'m','image':'n'}
CARD='<article data-token="{t}"><h2>{t}</h2>{s}<label>무엇처럼 보였나요?<input name="name" placeholder="사물 이름 또는 없음" required></label><label>명확도<select name="clarity" required><option value="">선택</option><option value="clear">명확한 사물</option><option value="weak">약한 연상</option><option value="none">없음 / 일반 도형</option></select></label></article>'


def sha(data):return hashlib.sha256(data).hexdigest()


def order(prefix,value):return sha(f'{prefix}|{value}'.encode())


def draw_route(draw,points,left,top):
    xs,ys=zip(*points);extent=max(max(xs)-min(xs),max(ys)-min(ys),1);cx,cy=(max(xs)+min(xs))/2,(max(ys)+min(ys))/2
    draw.line([(left+150+(x-cx)*260/extent,top+175-(y-cy)*260/extent) for x,y in points],fill='#172f45',width=3)


def pixel_hash(points):
    image=Image.new('RGB',(300,330),'white');draw_route(ImageDraw.Draw(image),points,0,0)
    buffer=io.BytesIO();image.save(buffer,'PNG');return sha(buffer.getvalue())


def collect(retrieval):
    """One entry per distinct picture, with every method/request it stands for."""
    pictures={}
    for method in METHODS:
        data=json.loads((retrieval/f'{method}.json').read_text(encoding='utf-8'))
        rows={r['id']:r for r in data['results']}
        for slot in data['reviewSlots']:
            if slot['id'] is None:continue
            row=rows[slot['id']];rotation=data['selectedDisplayRotations'][row['id']]
            points=review.display_points({**row,'_rotation':rotation});key=pixel_hash(points)
            entry=pictures.setdefault(key,{'pixelSHA256':key,'points':points,'uses':[]})
            entry['uses'].append({'method':method,'area':slot['area'],'proposalShape':slot['proposalShape'],'category':slot['category'],'id':row['id'],'rotation':rotation})
    return pictures


def public_mapping(entries,token):
    return [{'token':token(i),**{k:v for k,v in e.items() if k!='points'}} for i,e in enumerate(entries)]


def export_ai(pictures,out):
    pages=out/'pages';pages.mkdir(parents=True)
    entries=sorted(pictures.values(),key=lambda e:order('v19-ai',e['pixelSHA256']));token=lambda i:f'K{i+1:03d}';sheets=[]
    for start in range(0,len(entries),15):
        part=entries[start:start+15];image=Image.new('RGB',(900,((len(part)+2)//3)*330),'white');draw=ImageDraw.Draw(image)
        for i,entry in enumerate(part):
            left,top=(i%3)*300,(i//3)*330
            draw.text((left+12,top+8),token(start+i),fill='#172f45');draw_route(draw,entry['points'],left,top)
        name=f'page-{start//15+1}.png';image.save(pages/name);sheets.append({'file':name,'SHA256':sha((pages/name).read_bytes())})
    mapping=public_mapping(entries,token)
    fingerprint=sha(json.dumps({'mapping':mapping,'pages':sheets},sort_keys=True).encode())
    (out/'mapping.json').write_text(json.dumps({'fingerprint':fingerprint,'pictures':len(entries),'pages':sheets,'mapping':mapping},indent=2,ensure_ascii=False),encoding='utf-8')
    return {'pictures':len(entries),'pages':len(sheets),'fingerprint':fingerprint}


def export_human(pictures,lock,screen,mapping_file):
    requests={(r['area'],r['key']) for r in lock['humanRequests']}
    if len(requests)!=12:raise ValueError('Expected12 frozen human requests')
    entries=[e for e in pictures.values() if any((u['area'],u['proposalShape']) in requests for u in e['uses'])]
    entries=sorted(entries,key=lambda e:order('v19-human-order',e['pixelSHA256']));token=lambda i:f'H{i+1:03d}'
    cards=[CARD.format(t=token(i),s=review.svg(e['points'])) for i,e in enumerate(entries)]
    mapping=[]
    for item in public_mapping(entries,token):
        item['uses']=[u for u in item['uses'] if (u['area'],u['proposalShape']) in requests];mapping.append(item)
    fingerprint=sha(json.dumps(mapping,sort_keys=True).encode())
    screen.mkdir(parents=True);(screen/'blind.html').write_text(base.anonymous_page(cards,fingerprint),encoding='utf-8')
    mapping_file.write_text(json.dumps({'fingerprint':fingerprint,'requests':12,'pictures':len(entries),'mapping':mapping},indent=2,ensure_ascii=False),encoding='utf-8')
    return {'requests':12,'pictures':len(entries),'fingerprint':fingerprint}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for key in ('v19','catalog','public'):p.add_argument('--'+key,type=Path,required=True)
    args=p.parse_args();base.AREAS=AREAS
    outputs=[args.v19/'review-ai',args.v19/'human-mapping.json',args.public/'route-study-20261103-v19-human']+[args.public/f'route-study-20261103-{v}' for v in METHODS.values()]
    if any(path.exists() for path in outputs):raise ValueError('Preserve existing review outputs')
    summary={}
    for method,letter in METHODS.items():
        result=base.export(args.v19/'retrieval'/f'{method}.json',args.catalog,args.public/f'route-study-20261103-{letter}')
        summary[method]={'folder':letter,'requests':result['requests'],'missing':result['missing'],'fingerprint':result['fingerprint']}
    pictures=collect(args.v19/'retrieval')
    summary['ai']=export_ai(pictures,args.v19/'review-ai')
    lock=json.loads((args.v19/'input-lock.json').read_text(encoding='utf-8'))
    summary['human']=export_human(pictures,lock,args.public/'route-study-20261103-v19-human',args.v19/'human-mapping.json')
    (args.v19/'review-summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=True))
