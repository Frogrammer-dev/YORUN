// 유연한 그림 맞추기: 모양의 기준점(꼭짓점·곡선 위 점)을 근처 교차점 여러 곳 중에서 '함께' 골라
// 기준점 사이를 실제 길로 자연스럽게(곧게·덜 꺾이게) 잇는다.
// 고정된 틀에 길을 억지로 붙이면 계단·가시가 생기므로, 틀이 동네 길에 맞춰 조금 휘는 것을 허용하고
// 대신 꼭짓점 각도와 전체 모양은 유지하도록 동적 계획법(DP)으로 고른다.

import { pointSegDist, type RoadGraph } from "./graph";
import { resample, type ShapeDef } from "./shapes";

type XY = [number, number];

export interface FlexPlacement {
  cx: number;
  cy: number;
  scale: number;
  rotDeg: number;
}

/** 품질 조정값 (tests/eval-quality.test.ts 와 실제 데이터로 맞춘다) */
export const FLEX = {
  /** 기준점이 움직일 수 있는 반경 = 모양 크기 × 이 값 (최소 minRadius m) */
  radius: 0.1,
  minRadius: 45,
  /** 기준점 하나에서 살펴볼 교차점 수 */
  candidates: 6,
  /** 꺾임 1회(90°)를 몇 m 우회와 같게 볼지 */
  turnCost: 80,
  /** 모양 선분에서 벗어나는 데 대한 벌점 */
  guideWeight: 0.6,
  /** 기준점 이동 벌점 (반경 끝까지 가면 모양 크기 대비 이 비율만큼) */
  dispWeight: 0.04,
  /** 꼭짓점 각도가 틀어진 정도(라디안)당 벌점 */
  angleWeight: 0.05,
};

/** 모양의 기준점: 뚜렷한 꼭짓점은 반드시 넣고, 긴 변·곡선은 고르게 나눈다. weight는 각도 보존 중요도. */
export function keypointsOf(shape: ShapeDef, maxCount = 16): Array<{ pt: XY; weight: number }> {
  const loop = shape.points.slice(0, -1) as XY[];
  const isFeat = (p: XY) => shape.features.some((f) => Math.abs(f[0] - p[0]) < 1e-9 && Math.abs(f[1] - p[1]) < 1e-9);
  const step = shape.perimeter / maxCount;
  const out: Array<{ pt: XY; weight: number }> = [];
  if (shape.corners) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      out.push({ pt: a, weight: isFeat(a) ? 1 : 0.4 });
      const k = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let j = 1; j < k; j++) out.push({ pt: [a[0] + ((b[0] - a[0]) * j) / k, a[1] + ((b[1] - a[1]) * j) / k], weight: 0.25 });
    }
    return out;
  }
  // 곡선 모양: 고르게 나눈 뒤 특징점(하트의 오목한 곳·끝)을 가장 가까운 점과 바꾼다
  const pts = resample(shape.points, maxCount).slice(0, maxCount) as XY[];
  for (const p of pts) out.push({ pt: p, weight: 0.35 });
  for (const f of shape.features) {
    let bi = 0, bd = Infinity;
    for (let i = 0; i < out.length; i++) {
      const d = Math.hypot(out[i].pt[0] - f[0], out[i].pt[1] - f[1]);
      if (d < bd) (bd = d), (bi = i);
    }
    out[bi] = { pt: [f[0], f[1]], weight: 1 };
  }
  return out;
}

function place(p: FlexPlacement, [x, y]: XY): XY {
  const r = (p.rotDeg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [p.cx + p.scale * (x * c - y * s), p.cy + p.scale * (x * s + y * c)];
}

/** 교차점(3갈래 이상) 격자 색인. 그래프마다 한 번 만든다. */
const junctionCache = new WeakMap<RoadGraph, { cell: number; cells: Map<number, number[]> }>();
function junctions(g: RoadGraph) {
  let j = junctionCache.get(g);
  if (j) return j;
  const cell = 80;
  const cells = new Map<number, number[]>();
  for (let v = 0; v < g.n; v++) {
    if (g.adjStart[v + 1] - g.adjStart[v] < 3) continue;
    const k = (Math.floor(g.x[v] / cell) + 50_000) * 100_000 + Math.floor(g.y[v] / cell) + 50_000;
    let c = cells.get(k);
    if (!c) cells.set(k, (c = []));
    c.push(v);
  }
  j = { cell, cells };
  junctionCache.set(g, j);
  return j;
}

function nearbyJunctions(g: RoadGraph, x: number, y: number, r: number, max: number): number[] {
  const { cell, cells } = junctions(g);
  const found: Array<[number, number]> = [];
  for (let i = Math.floor((x - r) / cell); i <= Math.floor((x + r) / cell); i++)
    for (let j = Math.floor((y - r) / cell); j <= Math.floor((y + r) / cell); j++) {
      const list = cells.get((i + 50_000) * 100_000 + j + 50_000);
      if (!list) continue;
      for (const v of list) {
        const d = Math.hypot(g.x[v] - x, g.y[v] - y);
        if (d <= r) found.push([d, v]);
      }
    }
  found.sort((a, b) => a[0] - b[0]);
  return found.slice(0, max).map((f) => f[1]);
}

/** 한 출발점에서 여러 도착점까지 꺾임·안내선 벌점을 넣은 최단 경로 (한정 Dijkstra) */
class SegmentSearch {
  private dist: Float64Array;
  private prev: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private run = 0;
  private hN = new Int32Array(1024);
  private hK = new Float64Array(1024);
  private size = 0;
  constructor(private g: RoadGraph) {
    this.dist = new Float64Array(g.n);
    this.prev = new Int32Array(g.n);
    this.stamp = new Int32Array(g.n);
    this.closed = new Int32Array(g.n);
  }
  private push(v: number, k: number) {
    if (this.size >= this.hN.length) {
      const nn = new Int32Array(this.hN.length * 2), nk = new Float64Array(this.hN.length * 2);
      nn.set(this.hN);
      nk.set(this.hK);
      this.hN = nn;
      this.hK = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.hK[p] <= k) break;
      this.hN[i] = this.hN[p];
      this.hK[i] = this.hK[p];
      i = p;
    }
    this.hN[i] = v;
    this.hK[i] = k;
  }
  private pop(): number {
    const top = this.hN[0];
    const ln = this.hN[--this.size], lk = this.hK[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.hK[c + 1] < this.hK[c]) c++;
      if (this.hK[c] >= lk) break;
      this.hN[i] = this.hN[c];
      this.hK[i] = this.hK[c];
      i = c;
    }
    this.hN[i] = ln;
    this.hK[i] = lk;
    return top;
  }

  /** s에서 targets까지 비용과 경로. 닿지 못한 도착점은 null */
  search(
    s: number,
    targets: number[],
    guide: { ax: number; ay: number; bx: number; by: number; tol: number },
    maxCost: number,
  ): Array<{ cost: number; path: number[] } | null> {
    const G = this.g;
    const run = ++this.run;
    this.size = 0;
    this.dist[s] = 0;
    this.prev[s] = -1;
    this.stamp[s] = run;
    this.push(s, 0);
    let remaining = new Set(targets).size;
    const want = new Set(targets);
    while (this.size > 0 && remaining > 0) {
      const u = this.pop();
      if (this.closed[u] === run) continue;
      this.closed[u] = run;
      if (want.has(u)) remaining--;
      const du = this.dist[u];
      if (du > maxCost) break;
      const pu = this.prev[u];
      let inX = 0, inY = 0, inL = 0;
      if (pu >= 0) {
        inX = G.x[u] - G.x[pu];
        inY = G.y[u] - G.y[pu];
        inL = Math.hypot(inX, inY);
      }
      for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
        const v = G.adjTo[k];
        if (this.closed[v] === run) continue;
        let c = G.adjCost[k];
        if (inL > 0) {
          const ox = G.x[v] - G.x[u], oy = G.y[v] - G.y[u];
          const oL = Math.hypot(ox, oy);
          if (oL > 0) {
            const deg = (Math.acos(Math.max(-1, Math.min(1, (inX * ox + inY * oy) / (inL * oL)))) * 180) / Math.PI;
            if (deg > 25) c += FLEX.turnCost * Math.pow(deg / 90, 1.5);
          }
        }
        const d = pointSegDist((G.x[u] + G.x[v]) / 2, (G.y[u] + G.y[v]) / 2, guide.ax, guide.ay, guide.bx, guide.by) / guide.tol;
        c *= 1 + FLEX.guideWeight * d * d;
        const nd = du + c;
        if (this.stamp[v] !== run || nd < this.dist[v]) {
          this.stamp[v] = run;
          this.dist[v] = nd;
          this.prev[v] = u;
          this.push(v, nd);
        }
      }
    }
    return targets.map((t) => {
      if (this.closed[t] !== run) return null;
      const path: number[] = [];
      for (let v = t; v !== -1; v = this.prev[v]) path.push(v);
      return { cost: this.dist[t], path: path.reverse() };
    });
  }
}

const searchCache = new WeakMap<RoadGraph, SegmentSearch>();

function turnAngle(a: XY, b: XY, c: XY): number {
  let d = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0]);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export interface FlexResult {
  path: number[];
  /** 모양 기준점(단위 좌표)과 고른 교차점 좌표의 짝: 모양을 코스에 다시 맞출 때 쓴다 */
  pairs: Array<{ unit: XY; at: XY }>;
}

/** 배치 하나에 대해 기준점 교차점을 함께 골라 한붓 경로를 만든다. 못 이으면 null. */
export function buildFlexPath(g: RoadGraph, shape: ShapeDef, p: FlexPlacement): FlexResult | null {
  let kps = keypointsOf(shape);
  // 각도가 가장 덜 중요한 점에서 시작한다 (DP에서 시작점 각도는 반영하지 못함)
  let s0 = 0;
  for (let i = 1; i < kps.length; i++) if (kps[i].weight < kps[s0].weight) s0 = i;
  kps = [...kps.slice(s0), ...kps.slice(0, s0)];
  const K = kps.length;
  const R = Math.max(FLEX.minRadius, FLEX.radius * p.scale);
  const placed = kps.map((k) => place(p, k.pt));
  const cands: number[][] = placed.map(([x, y]) => nearbyJunctions(g, x, y, R, FLEX.candidates));
  if (cands.some((c) => c.length === 0)) return null;
  const tmplTurn = placed.map((b, i) => turnAngle(placed[(i - 1 + K) % K], b, placed[(i + 1) % K]));

  // 이웃 기준점 후보 사이 구간 비용
  const ss = searchCache.get(g) ?? new SegmentSearch(g);
  searchCache.set(g, ss);
  const seg: Array<Array<Array<{ cost: number; path: number[] } | null>>> = [];
  for (let i = 0; i < K; i++) {
    const j = (i + 1) % K;
    const [ax, ay] = placed[i], [bx, by] = placed[j];
    const len = Math.hypot(bx - ax, by - ay);
    const guide = { ax, ay, bx, by, tol: Math.max(R, 0.06 * p.scale) };
    seg.push(cands[i].map((u) => ss.search(u, cands[j], guide, 2.5 * len + 4 * R)));
  }
  const xy = (v: number): XY => [g.x[v], g.y[v]];
  const nodeCost = (i: number, v: number) => FLEX.dispWeight * (Math.hypot(g.x[v] - placed[i][0], g.y[v] - placed[i][1]) / R) ** 2;
  const segCost = (i: number, a: number, b: number) => {
    const r = seg[i][a][b];
    if (!r) return Infinity;
    const u = cands[i][a], v = cands[(i + 1) % K][b];
    return (r.cost - Math.hypot(g.x[u] - g.x[v], g.y[u] - g.y[v])) / p.scale;
  };
  const angCost = (i: number, a: XY, b: XY, c: XY) => {
    if (a[0] === b[0] && a[1] === b[1]) return 0;
    if (b[0] === c[0] && b[1] === c[1]) return 0;
    let d = Math.abs(turnAngle(a, b, c) - tmplTurn[i]);
    if (d > Math.PI) d = 2 * Math.PI - d;
    return FLEX.angleWeight * kps[i].weight * d;
  };

  // DP: 상태 = (이전 기준점 후보, 현재 기준점 후보)
  let best = Infinity;
  let bestChoice: number[] | null = null;
  for (let a0 = 0; a0 < cands[0].length; a0++) {
    // dp[i]: Map key (prevIdx * M + curIdx) → cost, back pointer
    const M = FLEX.candidates;
    let dp = new Float64Array(M * M).fill(Infinity);
    const back: Int8Array[] = [];
    for (let c = 0; c < cands[1].length; c++) dp[0 * M + c] = nodeCost(0, cands[0][a0]) + segCost(0, a0, c) + nodeCost(1, cands[1][c]);
    // i: 현재 기준점(1..K-2), 다음 기준점 i+1
    for (let i = 1; i < K - 1; i++) {
      const nd = new Float64Array(M * M).fill(Infinity);
      const bk = new Int8Array(M * M).fill(-1);
      const prevCount = i === 1 ? 1 : cands[i - 1].length;
      for (let pi = 0; pi < prevCount; pi++) {
        const pv = i === 1 ? cands[0][a0] : cands[i - 1][pi];
        for (let ci = 0; ci < cands[i].length; ci++) {
          const cur = dp[pi * M + ci];
          if (cur === Infinity) continue;
          const cv = cands[i][ci];
          for (let ni = 0; ni < cands[i + 1].length; ni++) {
            const sc = segCost(i, ci, ni);
            if (sc === Infinity) continue;
            const nv = cands[i + 1][ni];
            const v = cur + sc + nodeCost(i + 1, nv) + angCost(i, xy(pv), xy(cv), xy(nv));
            if (v < nd[ci * M + ni]) {
              nd[ci * M + ni] = v;
              bk[ci * M + ni] = pi;
            }
          }
        }
      }
      back.push(bk);
      dp = nd;
    }
    // 닫기: 마지막 기준점 → 시작점
    const lastPrevCount = K - 2 === 0 ? 1 : cands[K - 2].length;
    for (let pi = 0; pi < lastPrevCount; pi++) {
      for (let ci = 0; ci < cands[K - 1].length; ci++) {
        const cur = dp[pi * M + ci];
        if (cur === Infinity) continue;
        const sc = segCost(K - 1, ci, a0);
        if (sc === Infinity) continue;
        const pv = K - 2 === 0 ? cands[0][a0] : cands[K - 2][pi];
        const total = cur + sc + angCost(K - 1, xy(pv), xy(cands[K - 1][ci]), xy(cands[0][a0]));
        if (total < best) {
          best = total;
          // 되짚기
          const choice = new Array<number>(K);
          choice[0] = a0;
          choice[K - 1] = ci;
          let p_ = pi;
          for (let i = K - 2; i >= 1; i--) {
            choice[i] = p_;
            p_ = back[i - 1][p_ * M + choice[i + 1]];
          }
          bestChoice = choice;
        }
      }
    }
  }
  if (!bestChoice) return null;
  const path: number[] = [];
  for (let i = 0; i < K; i++) {
    const r = seg[i][bestChoice[i]][bestChoice[(i + 1) % K]]!;
    for (let k = path.length ? 1 : 0; k < r.path.length; k++) path.push(r.path[k]);
  }
  const pairs = kps.map((k, i) => ({ unit: k.pt, at: xy(cands[i][bestChoice![i]]) }));
  return { path, pairs };
}

/** 모양을 고른 교차점에 가장 잘 맞도록 다시 놓는다 (이동·회전·균일 확대만: 모양 자체는 바꾸지 않는다). */
export function refitPlacement(pairs: Array<{ unit: XY; at: XY }>): FlexPlacement {
  const n = pairs.length;
  let ux = 0, uy = 0, ax = 0, ay = 0;
  for (const { unit, at } of pairs) {
    ux += unit[0];
    uy += unit[1];
    ax += at[0];
    ay += at[1];
  }
  ux /= n;
  uy /= n;
  ax /= n;
  ay /= n;
  let sa = 0, sb = 0, su = 0;
  for (const { unit, at } of pairs) {
    const x = unit[0] - ux, y = unit[1] - uy, X = at[0] - ax, Y = at[1] - ay;
    sa += x * X + y * Y;
    sb += x * Y - y * X;
    su += x * x + y * y;
  }
  const scale = Math.hypot(sa, sb) / su;
  const rot = Math.atan2(sb, sa);
  const c = Math.cos(rot), s = Math.sin(rot);
  // 단위 좌표 원점(모양 중심)이 놓일 곳
  const cx = ax - scale * (ux * c - uy * s), cy = ay - scale * (ux * s + uy * c);
  return { cx, cy, scale, rotDeg: (rot * 180) / Math.PI };
}
