// 동네 길이 먼저: 길로 둘러싸인 블록(면)을 찾고, 이웃 블록을 합쳐 만든 고리의 바깥선을 코스로 쓴다.
// 블록 합집합의 테두리는 실제 길만 따라가고, 같은 길을 되밟거나 가시가 생기지 않는다.
// 이렇게 모은 자연스러운 고리 코스가 어떤 그림을 닮았는지(이동·회전·균일 확대만 허용) 나중에 판정한다.

import type { RoadGraph } from "./graph";
import { polylineLength, resample, type ShapeDef } from "./shapes";

type XY = [number, number];

export interface LoopPlacement {
  cx: number;
  cy: number;
  scale: number;
  rotDeg: number;
}

// ───────────────────────── 교차점 그래프 + 블록(면) ─────────────────────────

export interface BlockMap {
  /** 교차점 사이 길 조각: 반쪽 간선 h = 2e(a→b), 2e+1(b→a) */
  edgeNodes: number[][];
  edgeLen: Float64Array;
  /** 반쪽 간선이 왼쪽에 둔 블록 번호 (-1: 바깥·비정상 면) */
  heFace: Int32Array;
  heNext: Int32Array;
  faces: Face[];
}

export interface Face {
  hes: number[];
  area: number;
  perim: number;
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** 블록 안쪽 표본점 (그림 안에 드는 비율 계산용) */
  samples: XY[];
}

const heFrom = (m: BlockMap, h: number) => (h & 1 ? m.edgeNodes[h >> 1][m.edgeNodes[h >> 1].length - 1] : m.edgeNodes[h >> 1][0]);
const heTo = (m: BlockMap, h: number) => (h & 1 ? m.edgeNodes[h >> 1][0] : m.edgeNodes[h >> 1][m.edgeNodes[h >> 1].length - 1]);
function heNodes(m: BlockMap, h: number): number[] {
  const n = m.edgeNodes[h >> 1];
  return h & 1 ? [...n].reverse() : n;
}

function pointInPoly(px: number, py: number, xs: ArrayLike<number>, ys: ArrayLike<number>): boolean {
  let inside = false;
  for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
    if (ys[i] > py !== ys[j] > py && px < ((xs[j] - xs[i]) * (py - ys[i])) / (ys[j] - ys[i]) + xs[i]) inside = !inside;
  }
  return inside;
}

/** 길 그래프 → 교차점 그래프 → 블록. maxFaceArea보다 큰 면(바깥 등)은 쓰지 않는다. */
export function buildBlocks(g: RoadGraph, maxFaceArea: number): BlockMap {
  const deg = (v: number) => g.adjStart[v + 1] - g.adjStart[v];
  const used = new Uint8Array(g.adjTo.length);
  const edgeNodes: number[][] = [];
  for (let j = 0; j < g.n; j++) {
    if (deg(j) === 2) continue;
    for (let k = g.adjStart[j]; k < g.adjStart[j + 1]; k++) {
      if (used[k]) continue;
      used[k] = 1;
      const nodes = [j];
      let prev = j, cur = g.adjTo[k], lastK = k;
      while (deg(cur) === 2 && cur !== j) {
        nodes.push(cur);
        const k0 = g.adjStart[cur];
        const nk = g.adjTo[k0] === prev && g.adjTo[k0 + 1] !== prev ? k0 + 1 : k0;
        if (g.adjTo[nk] === prev && nk === k0 && g.adjTo[k0 + 1] === prev) break; // 같은 두 점 사이 겹친 간선
        used[nk] = 1;
        lastK = nk;
        prev = cur;
        cur = g.adjTo[nk];
      }
      nodes.push(cur);
      // 끝 교차점에서 돌아오는 방향도 사용 처리 (같은 길 조각을 두 번 만들지 않게)
      for (let r = g.adjStart[cur]; r < g.adjStart[cur + 1]; r++)
        if (!used[r] && g.adjTo[r] === prev) {
          used[r] = 1;
          break;
        }
      void lastK;
      if (nodes.length >= 2) edgeNodes.push(nodes);
    }
  }
  const E = edgeNodes.length;
  const edgeLen = new Float64Array(E);
  for (let e = 0; e < E; e++) {
    const n = edgeNodes[e];
    let d = 0;
    for (let i = 1; i < n.length; i++) d += Math.hypot(g.x[n[i]] - g.x[n[i - 1]], g.y[n[i]] - g.y[n[i - 1]]);
    edgeLen[e] = d;
  }

  // 교차점마다 나가는 반쪽 간선을 각도(반시계) 순으로
  const out = new Map<number, Array<{ h: number; ang: number }>>();
  for (let h = 0; h < 2 * E; h++) {
    const nodes = heNodes({ edgeNodes } as BlockMap, h);
    const a = nodes[0];
    // 첫 20m 지점 방향 (아주 짧은 첫 조각에 휘둘리지 않게)
    let k = 1, acc = 0;
    while (k < nodes.length - 1 && (acc += Math.hypot(g.x[nodes[k]] - g.x[nodes[k - 1]], g.y[nodes[k]] - g.y[nodes[k - 1]])) < 20) k++;
    const ang = Math.atan2(g.y[nodes[k]] - g.y[a], g.x[nodes[k]] - g.x[a]);
    let l = out.get(a);
    if (!l) out.set(a, (l = []));
    l.push({ h, ang });
  }
  const posInOut = new Int32Array(2 * E);
  const outList = new Map<number, number[]>();
  for (const [v, l] of out) {
    l.sort((p, q) => p.ang - q.ang);
    const hs = l.map((x) => x.h);
    hs.forEach((h, i) => (posInOut[h] = i));
    outList.set(v, hs);
  }
  const m: BlockMap = { edgeNodes, edgeLen, heFace: new Int32Array(2 * E).fill(-1), heNext: new Int32Array(2 * E), faces: [] };
  // 면의 다음 반쪽 간선: 도착점에서 되돌아가는 방향의 바로 시계 방향 이웃 (가장 왼쪽으로 꺾기)
  for (let h = 0; h < 2 * E; h++) {
    const list = outList.get(heTo(m, h))!;
    const i = posInOut[h ^ 1];
    m.heNext[h] = list[(i - 1 + list.length) % list.length];
  }

  const seen = new Uint8Array(2 * E);
  for (let h0 = 0; h0 < 2 * E; h0++) {
    if (seen[h0]) continue;
    const hes: number[] = [];
    let h = h0, guard = 0;
    while (!seen[h] && guard++ < 20_000) {
      seen[h] = 1;
      hes.push(h);
      h = m.heNext[h];
    }
    if (h !== h0) continue;
    const xs: number[] = [], ys: number[] = [];
    let perim = 0;
    for (const he of hes) {
      const n = heNodes(m, he);
      for (let i = 0; i < n.length - 1; i++) {
        xs.push(g.x[n[i]]);
        ys.push(g.y[n[i]]);
      }
      perim += edgeLen[he >> 1];
    }
    let a2 = 0, cx = 0, cy = 0;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      const c = xs[j] * ys[i] - xs[i] * ys[j];
      a2 += c;
      cx += (xs[j] + xs[i]) * c;
      cy += (ys[j] + ys[i]) * c;
    }
    const area = a2 / 2;
    if (area <= 0 || area > maxFaceArea || hes.length < 2) continue;
    cx /= 3 * a2;
    cy /= 3 * a2;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const samples: XY[] = [];
    for (let i = 1; i <= 3; i++)
      for (let j = 1; j <= 3; j++) {
        const px = minX + ((maxX - minX) * i) / 4, py = minY + ((maxY - minY) * j) / 4;
        if (pointInPoly(px, py, xs, ys)) samples.push([px, py]);
      }
    if (pointInPoly(cx, cy, xs, ys)) samples.push([cx, cy]);
    if (!samples.length) samples.push([cx, cy]);
    const fi = m.faces.length;
    m.faces.push({ hes, area, perim, cx, cy, minX, minY, maxX, maxY, samples });
    for (const he of hes) m.heFace[he] = fi;
  }
  return m;
}

// ───────────────────────── 블록 합집합의 테두리 ─────────────────────────

/** 블록 묶음의 바깥 테두리를 하나의 단순한 고리로 따라간다. 구멍·한 점에서 만나는 곳이 있으면 null. */
export function traceUnion(g: RoadGraph, m: BlockMap, inSet: Uint8Array, faces: number[]): number[] | null {
  const isB = (h: number) => inSet[m.heFace[h]] === 1 && (m.heFace[h ^ 1] < 0 || inSet[m.heFace[h ^ 1]] !== 1);
  let total = 0, start = -1;
  for (const f of faces)
    for (const h of m.faces[f].hes)
      if (isB(h)) {
        total++;
        if (start < 0) start = h;
      }
  if (start < 0) return null;
  const visitedJ = new Set<number>();
  const path: number[] = [heFrom(m, start)];
  let h = start, count = 0;
  do {
    const v = heTo(m, h);
    if (visitedJ.has(v)) return null; // 같은 교차점을 두 번 지남 (8자·한 점 접촉)
    visitedJ.add(v);
    const n = heNodes(m, h);
    for (let i = 1; i < n.length; i++) path.push(n[i]);
    count++;
    let c = m.heNext[h], guard = 0;
    while (!isB(c)) {
      c = m.heNext[c ^ 1];
      if (++guard > 64) return null;
    }
    h = c;
    if (count > total) return null;
  } while (h !== start);
  if (count !== total) return null; // 구멍 등 테두리가 여러 개
  void g;
  return path;
}

// ───────────────────────── 모양 판정 (이동·회전·균일 확대) ─────────────────────────

function signedArea(p: XY[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

function procrustes(src: XY[], dst: XY[]) {
  const n = src.length;
  let ux = 0, uy = 0, ax = 0, ay = 0;
  for (let i = 0; i < n; i++) {
    ux += src[i][0];
    uy += src[i][1];
    ax += dst[i][0];
    ay += dst[i][1];
  }
  ux /= n;
  uy /= n;
  ax /= n;
  ay /= n;
  let sa = 0, sb = 0, su = 0, sd = 0;
  for (let i = 0; i < n; i++) {
    const x = src[i][0] - ux, y = src[i][1] - uy, X = dst[i][0] - ax, Y = dst[i][1] - ay;
    sa += x * X + y * Y;
    sb += x * Y - y * X;
    su += x * x + y * y;
    sd += X * X + Y * Y;
  }
  const scale = Math.hypot(sa, sb) / su;
  const rot = Math.atan2(sb, sa);
  // 잔차 = sd - (sa² + sb²)/su, 코스 크기 대비로 정규화
  const resid = Math.max(0, sd - (sa * sa + sb * sb) / su) / sd;
  const c = Math.cos(rot), s = Math.sin(rot);
  return { cx: ax - scale * (ux * c - uy * s), cy: ay - scale * (ux * s + uy * c), scale, rotDeg: (rot * 180) / Math.PI, resid };
}

const N_MATCH = 48;

/** 모양 외곽선의 비교용 표본 (반시계 방향으로 맞춤) */
export function shapeSamples(shape: ShapeDef): XY[] {
  const s = resample(shape.points, N_MATCH).slice(0, N_MATCH) as XY[];
  return signedArea(s) < 0 ? s.reverse() : s;
}

/**
 * 코스(닫힌 점열)에 모양을 가장 잘 겹치는 배치. 점 대응을 모든 출발점으로 바꿔 보며 찾고
 * 가까운 점 맞추기(ICP)로 다듬는다. resid는 0(완전히 같음)~1.
 */
/** 코스의 비교용 표본 (반시계 방향). 여러 그림과 비교할 때 한 번만 만들어 재사용한다 */
export function loopSamples(loopXY: XY[]): XY[] {
  const L = resample(loopXY, N_MATCH).slice(0, N_MATCH) as XY[];
  return signedArea(L) < 0 ? L.reverse() : L;
}

export function matchShape(
  loopXY: XY[],
  shape: ShapeDef,
  tmpl = shapeSamples(shape),
  refine = true,
  L: XY[] = loopSamples(loopXY),
): (LoopPlacement & { resid: number }) | null {
  let best: (LoopPlacement & { resid: number }) | null = null;
  const shifted: XY[] = new Array(N_MATCH);
  for (let s = 0; s < N_MATCH; s++) {
    for (let i = 0; i < N_MATCH; i++) shifted[i] = L[(i + s) % N_MATCH];
    const r = procrustes(tmpl, shifted);
    // 위아래가 있는 그림은 45°보다 많이 돌리지 않는다 (거꾸로 된 하트·고양이 방지)
    if (!shape.rotationFree && Math.abs(r.rotDeg) > 45 && !/^(square|diamond)$/.test(shape.id)) continue;
    if (!best || r.resid < best.resid) best = r;
  }
  if (!best || !refine) return best;
  // ICP: 모양 표본마다 코스에서 가장 가까운 점과 다시 맞춘다
  const dense = resample(loopXY, 160) as XY[];
  for (let it = 0; it < 4; it++) {
    const c = Math.cos((best.rotDeg * Math.PI) / 180), s = Math.sin((best.rotDeg * Math.PI) / 180);
    const corr: XY[] = tmpl.map(([x, y]) => {
      const px = best!.cx + best!.scale * (x * c - y * s), py = best!.cy + best!.scale * (x * s + y * c);
      let bd = Infinity, bp = dense[0];
      for (const q of dense) {
        const d = (q[0] - px) ** 2 + (q[1] - py) ** 2;
        if (d < bd) (bd = d), (bp = q);
      }
      return bp;
    });
    const r = procrustes(tmpl, corr);
    if (!shape.rotationFree && Math.abs(r.rotDeg) > 50 && !/^(square|diamond)$/.test(shape.id)) break;
    best = { ...r, resid: best.resid };
  }
  return best;
}

// ───────────────────────── 자연스러운 고리 모으기 ─────────────────────────

export interface NaturalLoop {
  faces: number[];
  path: number[];
  length: number;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export interface Region {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const faceInside = (f: Face, r: Region) => f.minX >= r.minX && f.maxX <= r.maxX && f.minY >= r.minY && f.maxY <= r.maxY;

/**
 * 블록 하나에서 시작해 이웃 블록을 하나씩 붙여 가며, 테두리 길이가 목표 범위에 들 때마다 고리를 기록한다.
 * 붙일 블록은 테두리가 덜 늘어나는(=모양이 덜 울퉁불퉁해지는) 것을 우선하되, 실행마다 무작위성을 달리해 다양한 고리를 얻는다.
 */
export function growLoops(g: RoadGraph, m: BlockMap, region: Region, minM: number, maxM: number, opts: { seeds: number; deadline: number; seed?: number }): NaturalLoop[] {
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
    if (Date.now() > opts.deadline) break;
    // 실행마다 성향을 다르게: 둥글게 뭉치기(k 큼) ~ 길쭉·울퉁불퉁(k 작음)
    const k = 0.3 + rand() * 3;
    const set = [seed];
    const shared = new Map<number, number>();
    onBoundary.clear();
    add(seed, shared);
    let len = m.faces[seed].perim;
    let lastSnap = 0;
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
      if (len >= minM && len <= maxM && len >= lastSnap * 1.12) {
        const p = traceUnion(g, m, inSet, set);
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

/**
 * 그림 배치 하나에 대해 '그림 안에 절반 이상 들어가는 블록'을 합쳐 테두리 고리를 만든다.
 * 동네 블록으로 그림을 칠한 것과 같아, 길만 따라가면서도 그림 윤곽을 닮는다.
 */
export function unionForPlacement(g: RoadGraph, m: BlockMap, shape: ShapeDef, p: LoopPlacement, region: Region, threshold = 0.5): NaturalLoop | null {
  const r = (p.rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const pts = shape.points.map(([x, y]) => [p.cx + p.scale * (x * c - y * s), p.cy + p.scale * (x * s + y * c)] as XY);
  const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const chosen: number[] = [];
  const inSet = new Uint8Array(m.faces.length + 1);
  for (let f = 0; f < m.faces.length; f++) {
    const F = m.faces[f];
    if (F.maxX < minX || F.minX > maxX || F.maxY < minY || F.minY > maxY) continue;
    if (!faceInside(F, region)) continue;
    let inside = 0;
    for (const [sx, sy] of F.samples) if (pointInPoly(sx, sy, xs, ys)) inside++;
    if (inside / F.samples.length >= threshold) {
      chosen.push(f);
      inSet[f] = 1;
    }
  }
  if (!chosen.length) return null;
  // 가장 넓은 이어진 덩어리만 남긴다
  const comp = new Int32Array(m.faces.length).fill(-1);
  let bestComp: number[] = [], bestArea = 0;
  for (const f0 of chosen) {
    if (comp[f0] >= 0) continue;
    const stack = [f0], cur: number[] = [];
    comp[f0] = f0;
    let area = 0;
    while (stack.length) {
      const f = stack.pop()!;
      cur.push(f);
      area += m.faces[f].area;
      for (const h of m.faces[f].hes) {
        const o = m.heFace[h ^ 1];
        if (o >= 0 && inSet[o] && comp[o] < 0) {
          comp[o] = f0;
          stack.push(o);
        }
      }
    }
    if (area > bestArea) (bestArea = area), (bestComp = cur);
  }
  inSet.fill(0);
  for (const f of bestComp) inSet[f] = 1;
  // 구멍(둘러싸인 빠진 블록)은 채운다: 테두리가 여러 개면 안쪽 블록을 더해 다시 시도
  let path = traceUnion(g, m, inSet, bestComp);
  if (!path) {
    for (let f = 0; f < m.faces.length; f++) {
      if (inSet[f]) continue;
      const F = m.faces[f];
      if (F.maxX < minX || F.minX > maxX || F.maxY < minY || F.minY > maxY) continue;
      // 모든 이웃이 묶음 안이면 구멍
      if (F.hes.every((h) => m.heFace[h ^ 1] >= 0 && inSet[m.heFace[h ^ 1]])) {
        inSet[f] = 1;
        bestComp.push(f);
      }
    }
    path = traceUnion(g, m, inSet, bestComp);
  }
  if (!path) return null;
  return { faces: bestComp, path, length: polylineLength(path.map((v) => [g.x[v], g.y[v]] as XY)) };
}
