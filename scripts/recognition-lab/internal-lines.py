"""Outer contour + multiscale interior line diagnostic, no semantic model."""
import base64,json,hashlib
from pathlib import Path
import cv2
import numpy as np
from PIL import Image,ImageDraw,ImageOps
from skimage.morphology import skeletonize

def trace(binary):
    pixels=set(map(tuple,np.argwhere(binary)))
    adj={p:[] for p in pixels}
    for y,x in pixels:
        for dy in [-1,0,1]:
            for dx in [-1,0,1]:
                q=(y+dy,x+dx)
                if not (dx or dy) or q not in pixels:continue
                # Avoid artificial triangles when orthogonal connectivity exists.
                if dx and dy and ((y,x+dx) in pixels or (y+dy,x) in pixels):continue
                adj[(y,x)].append(q)
        adj[(y,x)].sort()
    special={p for p in pixels if len(adj[p])!=2};used=set();paths=[]
    def key(a,b):return tuple(sorted([a,b]))
    def walk(a,b):
        path=[a,b];used.add(key(a,b));prev,current=a,b
        while current not in special:
            choices=[q for q in adj[current] if key(current,q) not in used]
            if not choices:break
            nxt=choices[0];used.add(key(current,nxt));path.append(nxt);prev,current=current,nxt
            if current==a:break
        paths.append(path)
    for a in sorted(special):
        for b in adj[a]:
            if key(a,b) not in used:walk(a,b)
    for a in sorted(pixels):
        for b in adj[a]:
            if key(a,b) not in used:walk(a,b)
    assert len(used)==sum(map(len,adj.values()))//2
    return {'nodes':[{'pixel':[int(p[1]),int(p[0])],'degree':len(adj[p])} for p in sorted(special)],'strokes':[[[int(x),int(y)] for y,x in path] for path in paths],'edgeCount':len(used),'isolatedPixels':sum(len(v)==0 for v in adj.values())}

def main():
    root=Path('eval/recognition/imagenet-contour-20261028');out=root/'internal-lines-v1';out.mkdir(exist_ok=True)
    records=json.loads((root/'acquisition.json').read_text())['records'];results=[];cards=[];tiles=[]
    for i,r in enumerate(records):
        im=Image.open(root/r['image']).convert('RGB');im.thumbnail((384,384));rgb=np.array(im);h,w=rgb.shape[:2]
        maskpath=root/f'validation-u2netp-v1/{i+1:02d}-mask.png';mask=np.array(Image.open(maskpath))
        assert mask.shape==(h,w)
        gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY);inside=cv2.erode(mask,np.ones((7,7),np.uint8))>127
        edges=[cv2.Canny(cv2.GaussianBlur(gray,(0,0),sigma),50,120)>0 for sigma in [1,2,3]]
        raw=edges[0]&inside;stable=raw.copy()
        for e in edges[1:]:stable&=cv2.dilate(e.astype('uint8'),np.ones((5,5),np.uint8))>0
        n,labels,stats,_=cv2.connectedComponentsWithStats(stable.astype('uint8'),8)
        kept=np.zeros_like(stable)
        for j in range(1,n):
            if stats[j,cv2.CC_STAT_AREA]>=max(h,w)*.03:kept|=labels==j
        skeleton=skeletonize(kept);graph=trace(skeleton)
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        outer=np.zeros_like(mask);cv2.drawContours(outer,contours,-1,255,1)
        graph['outerStrokes']=[p.reshape(-1,2).tolist() for p in contours]
        graph['size']=[w,h];graph['id']=r['id'];graph['maskSHA256']=hashlib.sha256(maskpath.read_bytes()).hexdigest()
        (out/f'{i+1:02d}-graph.json').write_text(json.dumps(graph))
        variants=[outer>0,(outer>0)|raw,(outer>0)|skeleton]
        tile=Image.new('RGB',(960,250),'white');draw=ImageDraw.Draw(tile)
        tile.paste(ImageOps.contain(im,(230,210)),(0,25))
        for k,v in enumerate(variants):
            panel=Image.fromarray(np.where(v,0,255).astype('uint8'));tile.paste(ImageOps.contain(panel,(230,210)),((k+1)*240,25))
        draw.text((3,3),str(i+1)+' '+r['labelName'][:100],fill='black')
        tile.save(out/f'{i+1:02d}.png');tiles.append(tile)
        cards.append('<img width="960" src="data:image/png;base64,'+base64.b64encode((out/f'{i+1:02d}.png').read_bytes()).decode()+'">')
        results.append({'id':r['id'],'rawInteriorPixels':int(raw.sum()),'stableInteriorPixels':int(skeleton.sum()),'strokeCount':len(graph['strokes']),'junctions':sum(n['degree']>2 for n in graph['nodes']),'graphEdges':graph['edgeCount']})
    for page in range(4):
        montage=Image.new('RGB',(960,1500),'white')
        for j,tile in enumerate(tiles[page*6:page*6+6]):montage.paste(tile,(0,j*250))
        montage.save(out/f'montage-{page+1}.jpg')
    summary={'total':len(results),'withInternalLines':sum(r['stableInteriorPixels']>0 for r in results),'rawPixels':sum(r['rawInteriorPixels'] for r in results),'stablePixels':sum(r['stableInteriorPixels'] for r in results),'humanRecognitionMeasured':False,'trained':False,'roadIntegrated':False}
    (out/'results.json').write_text(json.dumps({'summary':summary,'results':results},indent=2))
    report=Path('reports/internal-lines-20261028');report.mkdir(exist_ok=True);(report/'summary.json').write_text(json.dumps(summary,indent=2))
    Path('public/eval/internal-lines-20261028.html').write_text('<meta charset="utf-8"><h1>외곽 + 내부 선 비교</h1><p>왼쪽부터 사진 / 외곽만 / 내부 경계 전체 / 여러 크기에서 유지되는 내부 선. 의미적으로 중요한 선을 확정한 결과가 아닙니다. 배경 분리 오류는 그대로 남아 있습니다.</p>'+''.join(cards),encoding='utf-8')
    print(json.dumps(summary))

if __name__=='__main__':
    t=np.zeros((7,7),dtype=bool);t[1:6,3]=True;t[3,1:6]=True;g=trace(t)
    assert g['edgeCount']==8 and len(g['strokes'])==4 and sum(n['degree']==4 for n in g['nodes'])==1
    ring=np.zeros((7,7),dtype=bool);ring[1,1:6]=ring[5,1:6]=True;ring[1:6,1]=ring[1:6,5]=True
    g=trace(ring);assert len(g['strokes'])==1 and g['strokes'][0][0]==g['strokes'][0][-1]
    print('PASS: branch connectivity and isolated cycle tracing');main()
