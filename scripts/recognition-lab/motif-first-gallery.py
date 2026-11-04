"""Render diagnostic results; labels are deliberately hidden in the first section."""
import json
from pathlib import Path
from html import escape

ROOT = Path(__file__).resolve().parents[2]
data = json.loads((ROOT/'eval/recognition/motif-first-20261028/results.json').read_text())

def svg(points, accent=None):
    if not points:
        return '<p>유효 경로 생성 실패</p>'
    xs, ys = zip(*points)
    scale = 260 / max(max(xs)-min(xs), max(ys)-min(ys), 1e-9)
    cx, cy = (max(xs)+min(xs))/2, (max(ys)+min(ys))/2
    def coords(seq):
        return ' '.join(f'{150+(x-cx)*scale:.2f},{150-(y-cy)*scale:.2f}' for x,y in seq)
    s = f'<svg viewBox="0 0 300 300"><polyline points="{coords(points)}" fill="none" stroke="#172e43" stroke-width="3"/>'
    if accent:
        s += f'<polyline points="{coords(accent)}" fill="none" stroke="#e66a15" stroke-width="5"/>'
    return s+'</svg>'

cards, details = [], []
for i,r in enumerate(data['results'],1):
    out = r['output']
    cards.append(f'<article><h2>경로 {i:02}</h2>{svg(out["xy"] if out else None)}<label>무엇처럼 보이나요? <input placeholder="모르겠음도 가능"></label></article>')
    details.append(f'<article><h2>{escape(r["id"])} · {escape(r["shapeId"])}</h2><div class="row"><section>기준 그림{svg(r["reference"])}</section><section>기존 결과{svg(r["baseline"])}</section><section>새 결과 · 주황색은 선확보 구간{svg(out["xy"] if out else None,out["motifXY"] if out else None)}</section></div><p>유효 후보 {r["validCandidates"]}/{r["attempts"]} · 실패 {escape(json.dumps(r["failures"]))}</p></article>')
html = '''<!doctype html><html lang="ko"><meta charset="utf-8"><title>핵심 구간 선확보 실험</title><style>body{font-family:system-ui;margin:30px;background:#f1f5f9;color:#172e43}article{background:white;padding:20px;margin:15px 0;border-radius:14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}svg{display:block;width:100%;max-width:350px}.row{display:flex;flex-wrap:wrap;gap:30px}.row section{flex:1;min-width:220px}input{padding:8px;width:85%}summary{cursor:pointer;font-size:22px}</style><h1>핵심 모양 구간을 먼저 확보하는 도로 생성</h1><p>6조건 중 2조건 유효. 이름 없이 실제 경로를 먼저 보세요. 아래 입력은 임시 메모이며 자동 저장되지 않습니다. 이 페이지는 진단용이며 독립 사람 평가 결과가 아닙니다.</p><div class="grid">'''+''.join(cards)+'''</div><details><summary>참고 그림·대상명·기존 결과 확인 (확인 후에는 블라인드 평가 불가)</summary><p>기존 결과와 계산 예산이 다르므로 우월성 비교가 아닙니다. 기준 그림 자체의 인식 가능성도 검증되지 않았습니다.</p>'''+''.join(details)+'</details></html>'
target=ROOT/'public/eval/motif-first-20261028.html'
target.write_text(html,encoding='utf-8')
print(target)
