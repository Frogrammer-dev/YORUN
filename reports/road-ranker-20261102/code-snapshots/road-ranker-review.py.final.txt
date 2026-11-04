"""Export untouched real road candidates for blinded free naming and GPX review."""
import argparse
import hashlib
import html
import json
import math
from pathlib import Path
import random
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[2]


def svg(points):
    xs, ys = zip(*points)
    extent = max(max(xs)-min(xs), max(ys)-min(ys), 1)
    cx, cy = (max(xs)+min(xs))/2, (max(ys)+min(ys))/2
    path = ' '.join(f'{150+(x-cx)*260/extent:.3f},{150-(y-cy)*260/extent:.3f}' for x,y in points)
    return f'<svg viewBox="0 0 300 300" role="img" aria-label="경로 선 그림"><rect width="300" height="300" fill="white"/><polyline points="{path}" fill="none" stroke="#172f45" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'


def gpx(candidate):
    points = ''.join(f'<trkpt lat="{lat:.9f}" lon="{lon:.9f}"/>' for lat,lon in candidate['latlon'])
    return '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="road-ranker" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>'+escape(candidate['id'])+'</name><trkseg>'+points+'</trkseg></trk></gpx>'


def display_points(row):
    points=row['xy']
    rotation=row.get('_rotation',0)%360
    if rotation%90==0:
        for _ in range(int(rotation//90)):
            points=[[-y,x] for x,y in points]
    else:
        angle=math.radians(rotation);c,s=math.cos(angle),math.sin(angle)
        points=[[c*x-s*y,s*x+c*y] for x,y in points]
    return points


def geometry_key(row):
    if 'path' in row:
        edges=tuple(sorted({tuple(sorted((a,b))) for a,b in zip(row['path'],row['path'][1:])}))
    else:
        # Legacy exports with only coordinates still get rotation/start independent grouping.
        edges=tuple(sorted({tuple(sorted((tuple(a),tuple(b)))) for a,b in zip(row['latlon'],row['latlon'][1:])}))
    return row['area'],row.get('roadHash'),edges


STYLE = '''body{font:16px system-ui,sans-serif;color:#183048;background:#edf2f5;max-width:1100px;margin:30px auto;padding:0 18px}h1{font-size:28px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}article{background:#fff;border-radius:14px;padding:18px}svg{width:100%;display:block}input,select{box-sizing:border-box;width:100%;padding:10px;margin:8px 0;border:1px solid #a6b6c1;border-radius:6px;font:inherit}button,a.button{display:inline-block;background:#183e59;color:#fff;padding:12px 18px;border:0;border-radius:8px;margin:16px 8px 16px 0;cursor:pointer}small{color:#526575}.note{padding:16px;background:white;border-radius:10px}'''


def export(roads_file, prediction_file, outdir, top_k=2, use_rotation=False):
    if (outdir/'mapping.json').exists():
        raise ValueError('Use a new review folder; frozen studies cannot be overwritten')
    raw = roads_file.read_bytes()
    pool = json.loads(raw)
    predictions = json.loads(prediction_file.read_text(encoding='utf-8'))
    outputs = predictions.get('outputs', predictions.get('results', []))
    lookup = {r['id']:r for r in pool['results']}
    pred = {r['id']:r for r in outputs}
    if len(pred) != len(outputs) or set(pred) != set(lookup):
        raise ValueError('Predictions must include every road ID exactly once')
    selections, slots = {}, []
    for area in dict.fromkeys(r['area'] for r in pool['results']):
        rows = [r for r in pool['results'] if r['area']==area]
        baseline = [r for r in rows if r.get('baselineId')][:top_k]
        ordered = sorted((r for r in rows if pred[r['id']]['accepted']), key=lambda r:(-pred[r['id']]['score'],r['id']))
        ranked=[];seen_geometry=set()
        for row in ordered:
            identity=geometry_key(row)
            if identity in seen_geometry:continue
            seen_geometry.add(identity);ranked.append(row)
            if len(ranked)==top_k:break
        for method, chosen in [('baseline',baseline),('model',ranked)]:
            for i in range(top_k):
                row = chosen[i] if i<len(chosen) else None
                rotation=float(pred[row['id']].get('rotation',0)) if row and method=='model' and use_rotation else 0
                if not math.isfinite(rotation):raise ValueError('Nonfinite display rotation')
                rotation=rotation%360
                view_key=f'{row["id"]}@{rotation:.12g}' if row else None
                slots.append({'area':area,'method':method,'slot':i+1,'id':row['id'] if row else None,'viewKey':view_key,'viewRotation':rotation})
                if row:selections[view_key]={**row,'_rotation':rotation,'_viewKey':view_key}
    selected = list(selections.values())
    random.Random(20261102).shuffle(selected)
    fingerprint = hashlib.sha256(raw+prediction_file.read_bytes()+json.dumps(slots,sort_keys=True).encode()).hexdigest()
    outdir.mkdir(parents=True,exist_ok=True)
    cards=[]; mapping=[]
    for i,row in enumerate(selected,1):
        token=f'R{i:02d}'
        mapping.append({'token':token,'id':row['id'],'viewKey':row['_viewKey'],'viewRotation':row['_rotation'],'prediction':pred[row['id']]})
        cards.append(f'<article data-token="{token}"><h2>{token}</h2>{svg(display_points(row))}<label>처음 무엇처럼 보였나요?<input name="name" placeholder="사물 이름 또는 아무것도 없음" required></label><label>얼마나 분명했나요?<select name="clarity" required><option value="">선택</option><option value="clear">명확한 사물</option><option value="weak">약한 연상</option><option value="none">없음 / 일반 도형</option></select></label></article>')
        (outdir/f'{token}.gpx').write_text(gpx(row),encoding='utf-8')
    from PIL import Image, ImageDraw
    montage=Image.new('RGB',(900,max(1,(len(selected)+2)//3)*330),'white')
    draw=ImageDraw.Draw(montage)
    for i,row in enumerate(selected):
        points=display_points(row);xs,ys=zip(*points)
        extent=max(max(xs)-min(xs),max(ys)-min(ys),1)
        cx,cy=(max(xs)+min(xs))/2,(max(ys)+min(ys))/2
        left,top=(i%3)*300,(i//3)*330
        draw.text((left+12,top+8),f'R{i+1:02d}',fill='#172f45')
        draw.line([(left+150+(x-cx)*260/extent,top+175-(y-cy)*260/extent) for x,y in points],fill='#172f45',width=3)
    montage.save(outdir/'blind.png')
    renderer_hash=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    image_hash=hashlib.sha256((outdir/'blind.png').read_bytes()).hexdigest()
    fingerprint=hashlib.sha256((fingerprint+renderer_hash+image_hash).encode()).hexdigest()
    # No identities, scores, method labels, or target references are embedded in blind HTML.
    script = '''<script>
const fingerprint=FINGERPRINT;const cards=[...document.querySelectorAll('article')];const reviewer=document.querySelector('#reviewer');
const answers=()=>cards.map(a=>({token:a.dataset.token,name:a.querySelector('input').value.trim(),clarity:a.querySelector('select').value}));
const key=()=>reviewer.value.trim()?'road-review-'+fingerprint+'-'+reviewer.value.trim():null;
const storageNote=()=>{document.querySelector('#storage-note').textContent='이 브라우저에서는 임시 저장을 사용할 수 없습니다. 화면을 닫기 전에 답변 파일을 저장해 주세요.'};
const save=()=>{if(key())try{localStorage.setItem(key(),JSON.stringify(answers()))}catch{storageNote()}};
for(const a of cards)for(const el of a.querySelectorAll('input,select'))el.addEventListener('input',save);
document.querySelector('#fresh').onclick=()=>{reviewer.value='';for(const a of cards)for(const el of a.querySelectorAll('input,select'))el.value='';reviewer.focus()};
document.querySelector('#restore').onclick=()=>{if(!key()){alert('평가자 코드를 먼저 입력해 주세요.');return}let rows=[];try{rows=JSON.parse(localStorage.getItem(key())||'[]')}catch{storageNote();return}if(!rows.length){alert('이 코드로 저장된 중간 답변이 없습니다.');return}for(const a of cards){const row=rows.find(r=>r.token===a.dataset.token);a.querySelector('input').value=row?.name||'';a.querySelector('select').value=row?.clarity||''}};
document.querySelector('#download').onclick=()=>{if(!key()){alert('본명 대신 평가자 코드를 입력해 주세요.');return}if(cards.some(a=>!a.querySelector('input').value.trim()||!a.querySelector('select').value)){alert('모든 경로에 자유 이름과 명확도를 기록해 주세요.');return}save();const blob=new Blob([JSON.stringify({fingerprint,reviewerCode:reviewer.value.trim(),createdAt:new Date().toISOString(),answers:answers()},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='road-review-'+reviewer.value.trim().replace(/[^a-zA-Z0-9_-]/g,'_')+'.json';a.click();URL.revokeObjectURL(a.href)};
</script>'''.replace('FINGERPRINT',json.dumps(fingerprint))
    page='<!doctype html><html lang="ko"><meta charset="utf-8"><title>실제 경로 자유 명명</title><style>'+STYLE+'</style><h1>이 길은 무엇처럼 보이나요?</h1><p class="note">실제 도로로 연결된 경로입니다. 떠오르는 사물이 없으면 ‘아무것도 없음’이라고 적어 주세요. 네모·다각형만 보이면 명확도를 ‘없음 / 일반 도형’으로 선택하세요. 이름과 참고 그림 없이 첫인상을 기록합니다. 다른 사람의 답변을 보지 말고 각자 평가해 주세요.</p><label>평가자 코드 (본명 제외)<input id="reviewer" placeholder="예: P01" autocomplete="off"></label><button id="fresh">새 평가자 시작</button><button id="restore">내 중간 답변 불러오기</button><main>'+''.join(cards)+'</main><button id="download">답변 파일 저장</button><p><small id="storage-note">답변은 평가자 코드별로 이 브라우저에만 임시 저장됩니다. 다음 사람에게는 새 평가자 시작으로 빈 화면을 보여 주세요.</small></p>'+script+'</html>'
    (outdir/'blind.html').write_text(page,encoding='utf-8')
    detail=[]
    for item in mapping:
        row={**lookup[item['id']],'_rotation':item['viewRotation']};p=pred[item['id']]
        label=p.get('predictedClass',p.get('label','unknown'))
        detail.append(f'<article><h2>{item["token"]} · {html.escape(str(label))}</h2>{svg(display_points(row))}<p>{row["meters"]/1000:.2f}km · 반복 {row["repeatRatio"]*100:.1f}% · 표시 회전 {item["viewRotation"]}°</p><p>모델 선택 점수 {p["score"]:.4f} (사람 인식 확률 아님)</p><a href="{item["token"]}.gpx">실제 도로 GPX 저장</a></article>')
    (outdir/'diagnostic.html').write_text('<!doctype html><html lang="ko"><meta charset="utf-8"><title>도로 후보 모델 진단</title><style>'+STYLE+'</style><h1>모델 선택 결과 진단</h1><p>자유 명명 평가를 마친 뒤 확인하세요. 모델 이름은 검증된 정답이 아닙니다.</p><main>'+''.join(detail)+'</main></html>',encoding='utf-8')
    manifest={'fingerprint':fingerprint,'rendererSHA256':renderer_hash,'blindImageSHA256':image_hash,'geometrySelectionPolicy':'one selected hypothesis per exact undirected edge set, namespaced by area/source','roadHash':hashlib.sha256(raw).hexdigest(),'predictionHash':hashlib.sha256(prediction_file.read_bytes()).hexdigest(),'humanRecognitionMeasured':False,'slots':slots,'mapping':mapping,'uniqueBlindCandidates':len(selected),'methodsDenominator':len(set(r['area'] for r in slots))*top_k}
    (outdir/'mapping.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--roads',type=Path,default=ROOT/'eval/recognition/road-ranker-20261102/roads.json')
    parser.add_argument('--predictions',type=Path,required=True)
    parser.add_argument('--out',type=Path,default=ROOT/'public/eval/road-ranker-20261102')
    parser.add_argument('--use-rotation',action='store_true')
    args=parser.parse_args()
    manifest=export(args.roads,args.predictions,args.out,use_rotation=args.use_rotation)
    print(json.dumps({'blindCandidates':manifest['uniqueBlindCandidates'],'denominator':manifest['methodsDenominator'],'fingerprint':manifest['fingerprint']}))
