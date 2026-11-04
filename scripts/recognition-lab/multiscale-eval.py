"""Frozen-route scale-space diagnostic, not a recognition accuracy benchmark."""
import base64
import hashlib
import io
import json
from pathlib import Path
from html import escape
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'eval/recognition/road-motif-20261028/results.json'
OUT=ROOT/'eval/recognition/multiscale-20261028'
REPORT=ROOT/'reports/multiscale-20261028'
SIGMAS=[0,2,5,10]

def render(points):
    p=np.array(points,dtype=float)
    extent=np.ptp(p,axis=0)
    p=(p-(p.max(axis=0)+p.min(axis=0))/2)*216/max(extent.max(),1e-9)
    p[:,0]+=128;p[:,1]=128-p[:,1]
    # Supersampling reduces pixel-grid artifacts without modifying route geometry.
    image=Image.new('L',(1024,1024),255)
    ImageDraw.Draw(image).line([tuple(v*4) for v in p],fill=0,width=12)
    return image.resize((256,256),Image.Resampling.LANCZOS)

def blur(image,sigma):
    return image.filter(ImageFilter.GaussianBlur(sigma)) if sigma else image.copy()

def similarity(a,b):
    x=1-np.asarray(a,dtype=float).ravel()/255
    y=1-np.asarray(b,dtype=float).ravel()/255
    return float(np.dot(x,y)/max(np.linalg.norm(x)*np.linalg.norm(y),1e-12))

def embed(image):
    buffer=io.BytesIO();image.save(buffer,format='PNG')
    return 'data:image/png;base64,'+base64.b64encode(buffer.getvalue()).decode()

def main():
    OUT.mkdir(parents=True,exist_ok=True);REPORT.mkdir(parents=True,exist_ok=True)
    raw=SOURCE.read_bytes();source=json.loads(raw);rows=source['results']
    assert len(rows)==18
    results=[];cards=[];keys=[]
    order=sorted(range(len(rows)),key=lambda i:(i*7)%19)
    montage=Image.new('RGB',(1024,18*288),'white');draw=ImageDraw.Draw(montage)
    for rank,index in enumerate(order,1):
        r=rows[index];o=r['output'];rid=f'R{rank:02d}'
        result={'code':rid,'id':r['id'],'method':r['method'],'shapeId':r['shapeId'],'valid':bool(o)}
        if not o:
            cards.append(f'<article><h2>{rid}</h2><p>유효 경로 생성 실패 · 평가 분모에 포함</p></article>')
            draw.text((10,(rank-1)*288+10),f'{rid}: NO VALID ROUTE',fill='black')
            results.append(result);continue
        a=render(o['xy']);b=render(o['outline']);scores=[];pictures=[]
        for j,sigma in enumerate(SIGMAS):
            ai=blur(a,sigma);bi=blur(b,sigma)
            score=similarity(ai,bi);assert -1e-9<=score<=1+1e-9
            assert abs(similarity(ai,ai)-1)<1e-8
            scores.append(score)
            pictures.append(f'<section><p>{["원본","약한 흐림","중간 흐림","강한 흐림"][j]}</p><img width="256" height="256" src="{embed(ai)}" alt="{rid} 흐림 단계 {j}"></section>')
            montage.paste(ai,(j*256,(rank-1)*288+28));draw.text((j*256+8,(rank-1)*288+8),f'{rid} sigma={sigma}',fill='black')
        result.update(scores=scores,conservativeScore=min(scores[:3]))
        results.append(result)
        cards.append(f'<article data-code="{rid}"><h2>{rid}</h2><div class="row">'+''.join(pictures)+f'</div><label>원본에서 떠오르는 것 <input data-field="original" placeholder="모르겠음도 가능"></label><label>흐린 그림에서 떠오르는 것 <input data-field="blurred"></label><label>변화 <select data-field="change"><option value="">미응답</option><option>더 알아보기 쉬움</option><option>차이 없음</option><option>더 어려움</option></select></label></article>')
        keys.append(f'<article><h3>{rid} · {escape(r["id"])} · {r["shapeId"]} · {r["method"]}</h3><p>그림 비교 점수: '+', '.join(f'{v:.3f}' for v in scores)+f' · 보수 점수 {min(scores[:3]):.3f}</p><img width="256" src="{embed(b)}" alt="배치된 참고 선 그림"></article>')
    valid=[r for r in results if r['valid']]
    summary={'sourceSha256':hashlib.sha256(raw).hexdigest(),'conditions':6,'methodOutputs':18,'validOutputs':len(valid),'sigmas':SIGMAS,'meanScoresBySigma':np.mean([r['scores'] for r in valid],axis=0).tolist(),'humanRecognitionMeasured':False,'newRoutesGenerated':False,'appIntegrated':False}
    winners=[]
    for cid in dict.fromkeys(r['id'] for r in results):
        group=[r for r in valid if r['id']==cid]
        winners.append({'id':cid,'originalWinner':max(group,key=lambda r:r['scores'][0])['method'],'multiscaleWinner':max(group,key=lambda r:r['conservativeScore'])['method'],'strongBlurWinner':max(group,key=lambda r:r['scores'][3])['method']})
    summary['rankingDiagnostic']=winners
    (OUT/'results.json').write_text(json.dumps({'summary':summary,'results':results},indent=2),encoding='utf-8')
    (REPORT/'summary.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
    montage.save(OUT/'montage.png')
    # Compact all 17 valid rows for visual inspection.
    montage.resize((768,3888)).save(OUT/'montage-small.png')
    html='''<!doctype html><html lang="ko"><meta charset="utf-8"><title>흐릿하게 보는 경로 실험</title><style>body{font-family:system-ui;background:#edf3f8;color:#17334b;margin:24px}article{background:white;padding:18px;border-radius:12px;margin:18px 0}.row{display:flex;flex-wrap:wrap;gap:12px}section p{text-align:center}img{max-width:100%}label{display:inline-block;margin:12px}input,select,button{padding:10px}summary{cursor:pointer;font-size:22px}header{max-width:1000px}</style><header><h1>같은 경로를 흐릿하게 보면?</h1><p>원본 → 약한 흐림 → 중간 흐림 → 강한 흐림 순서입니다. 실제 도로 좌표는 그대로입니다. 흐림 때문에 선이 옅어지는 효과도 포함되며, 대비를 임의로 높이지 않았습니다.</p><p>17개 경로와 생성 실패1개. 같은 대상의 여러 방법을 반복하므로 독립 블라인드 평가가 아닌 탐색용입니다. 먼저 이름 없이 보세요. 답변은 서버로 전송되지 않습니다. 기록하려면 아래 JSON 저장을 누르세요.</p><button id="export">내 평가 JSON 저장</button></header>'''+''.join(cards)+'''<details><summary>대상명·참고 그림·보조 점수 보기</summary><p>점수는 흐린 선 그림끼리의 겹침 정도이며 인식 확률이 아닙니다. 이름을 확인한 뒤의 답변은 사전 자유 명명과 구분해야 합니다.</p>'''+''.join(keys)+'''</details><script>let revealed=false;document.querySelector('details').addEventListener('toggle',e=>{if(e.target.open)revealed=true});document.getElementById('export').onclick=()=>{const answers=[...document.querySelectorAll('[data-code]')].map(el=>({code:el.dataset.code,...Object.fromEntries([...el.querySelectorAll('[data-field]')].map(x=>[x.dataset.field,x.value]))}));const data={experiment:'multiscale-20261028',referenceRevealedBeforeExport:revealed,independentBlindTrial:false,answers};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));a.download='multiscale-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};</script></html>'''
    (ROOT/'public/eval/multiscale-20261028.html').write_text(html,encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False))

if __name__=='__main__':main()
