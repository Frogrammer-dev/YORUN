import type { Budget } from '@/lib/route/budget';
import type { RoadGraph } from '@/lib/route/graph';
import { traceUnion, type BlockMap, type Face, type NaturalLoop } from '@/lib/route/loops';
import { polylineLength } from '@/lib/route/shapes';
import type { Region } from '@/lib/route/fit';
type XY=[number,number];
const faceInside=(f:Face,r:Region)=>f.minX>=r.minX&&f.maxX<=r.maxX&&f.minY>=r.minY&&f.maxY<=r.maxY;
const heFrom=(m:BlockMap,h:number)=>(h&1?m.edgeNodes[h>>1][m.edgeNodes[h>>1].length-1]:m.edgeNodes[h>>1][0]);
const heTo=(m:BlockMap,h:number)=>(h&1?m.edgeNodes[h>>1][0]:m.edgeNodes[h>>1][m.edgeNodes[h>>1].length-1]);
function rng(seed:number){let s=seed>>>0||1;return()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return(s>>>0)/4294967296;};}
export function growLoopsObserved(g: RoadGraph, m: BlockMap, region: Region, minM: number, maxM: number, opts: { seeds: number; budget: Budget; fraction: number; seed?: number }, observer:(seed:number,step:number,len:number,faces:number[])=>void, traceObserver:(success:boolean)=>void): NaturalLoop[] {
  const rand = rng(opts.seed ?? 12345);
  const okFaces = m.faces.map((f) => faceInside(f, region) && f.perim < maxM);
  const ids = m.faces.map((_, i) => i).filter((i) => okFaces[i]);
  // 씨앗 블록: 영역 전체에 고르게 (무작위 순서)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const seeds = ids.slice(0, opts.seeds);
  const inSet = new Uint8Array(m.faces.length + 1);
  /** 지금 묶음 테두리에서 출발하는 반쪽 간선 수 (교차점별) — 한 점에서만 닿는 블록을 거르는 데 쓴다 */
  const onBoundary = new Map<number, number>();
  const bump = (v: number, d: number) => {
    const c = (onBoundary.get(v) ?? 0) + d;
    if (c) onBoundary.set(v, c);
    else onBoundary.delete(v);
  };
  /**
   * 블록 f를 붙여도 테두리가 하나의 단순한 고리로 남는가:
   * 묶음과 맞닿은 부분이 한 줄로 이어져 있고(구멍 없음), 새로 테두리가 될 부분이 기존 테두리에 점으로 닿지 않아야 한다.
   */
  const canAdd = (f: number) => {
    const hes = m.faces[f].hes;
    const s = hes.map((h) => m.heFace[h ^ 1] >= 0 && inSet[m.heFace[h ^ 1]] === 1);
    let runs = 0;
    for (let i = 0; i < s.length; i++) if (s[i] && !s[(i - 1 + s.length) % s.length]) runs++;
    if (runs !== 1) return false;
    for (let i = 0; i < s.length; i++) {
      // 맞닿지 않은 구간 안쪽의 교차점 (구간 끝점은 기존 테두리 위가 정상)
      if (!s[i] && !s[(i + 1) % s.length] && onBoundary.has(heTo(m, hes[i]))) return false;
    }
    return true;
  };
  const add = (f: number, shared: Map<number, number>) => {
    inSet[f] = 1;
    shared.delete(f);
    for (const h of m.faces[f].hes) {
      const o = m.heFace[h ^ 1];
      if (o >= 0 && inSet[o]) bump(heFrom(m, h ^ 1), -1); // 맞닿은 길은 더 이상 테두리가 아님
      else {
        bump(heFrom(m, h), 1);
        if (o >= 0 && okFaces[o]) shared.set(o, (shared.get(o) ?? 0) + m.edgeLen[h >> 1]);
      }
    }
  };
  const out: NaturalLoop[] = [];
  for (const seed of seeds) {
    if (!opts.budget.ok(opts.fraction)) break;
    opts.budget.spend();
    // 실행마다 성향을 다르게: 둥글게 뭉치기(k 큼) ~ 길쭉·울퉁불퉁(k 작음)
    const k = 0.3 + rand() * 3;
    const set = [seed];
    const shared = new Map<number, number>();
    onBoundary.clear();
    add(seed, shared);
    let len = m.faces[seed].perim;
    let lastSnap = 0;
    observer(seed,-1,len,set); // OBSERVER
    for (let step = 0; step < 600 && len < maxM * 1.05; step++) {
      if (!shared.size) break;
      const cands = [...shared].map(([f, sh]) => {
        const delta = m.faces[f].perim - 2 * sh;
        return { f, delta, score: delta / m.faces[f].perim - rand() / k };
      });
      cands.sort((a, b) => a.score - b.score);
      const pick = cands.slice(0, 6).find((o) => canAdd(o.f));
      if (!pick) break;
      add(pick.f, shared);
      set.push(pick.f);
      len += pick.delta;
      observer(seed,step,len,set); // OBSERVER
      if (len >= minM && len <= maxM && len >= lastSnap * 1.12) {
        const p = traceUnion(g, m, inSet, set);
        traceObserver(!!p); // OBSERVER
        if (p) {
          out.push({ faces: [...set], path: p, length: polylineLength(p.map((v) => [g.x[v], g.y[v]] as XY)) });
          lastSnap = len;
        }
      }
    }
    for (const f of set) inSet[f] = 0;
  }
  return out;
}
