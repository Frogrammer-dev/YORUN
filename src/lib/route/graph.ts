// 보행 도로 그래프 (명세 15.1): OSM 노드를 공유하는 길만 연결한다.
// 교량·터널처럼 지도에서 겹쳐 보여도 노드를 공유하지 않으면 연결로 취급하지 않는다.
// 좌표는 영역 중심 기준 지역 평면(미터)으로 투영한다.

export interface Origin {
  lat0: number;
  lon0: number;
  cos0: number;
}

const R = 6_371_000;
const RAD = Math.PI / 180;

export function makeOrigin(lat0: number, lon0: number): Origin {
  return { lat0, lon0, cos0: Math.cos(lat0 * RAD) };
}
export function project(o: Origin, lat: number, lon: number): [number, number] {
  return [R * o.cos0 * (lon - o.lon0) * RAD, R * (lat - o.lat0) * RAD];
}
export function unproject(o: Origin, x: number, y: number): [number, number] {
  return [o.lat0 + y / R / RAD, o.lon0 + x / (R * o.cos0) / RAD];
}

export interface RoadGraph {
  origin: Origin;
  n: number;
  x: Float64Array;
  y: Float64Array;
  lat: Float64Array;
  lon: Float64Array;
  /** CSR 인접 리스트 */
  adjStart: Int32Array;
  adjTo: Int32Array;
  adjLen: Float32Array;
  /** 길 성격 비트 (EDGE_*) */
  adjFlags: Uint8Array;
  /** 길이 × 도로 종류 가중치 (큰길·계단 회피) */
  adjCost: Float32Array;
  edgeCount: number;
  dataTimestamp: string | null;
  nodeIndex: SpatialIndex;
  edgeIndex: EdgeIndex;
}

export interface RawEdge {
  a: number;
  b: number;
  factor: number;
  /** 길 성격 비트 (EDGE_*) */
  flags?: number;
}

/** 노드·간선 목록 → 가장 큰 연결 요소만 남긴 CSR 그래프 */
export function buildGraph(
  origin: Origin,
  lats: number[],
  lons: number[],
  edges: RawEdge[],
  dataTimestamp: string | null,
): RoadGraph {
  const n0 = lats.length;
  // 연결 요소 (union-find)
  const parent = new Int32Array(n0).map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (const e of edges) {
    const ra = find(e.a), rb = find(e.b);
    if (ra !== rb) parent[ra] = rb;
  }
  const size = new Map<number, number>();
  for (const e of edges) {
    const r = find(e.a);
    size.set(r, (size.get(r) ?? 0) + 1);
  }
  let best = -1, bestSize = 0;
  for (const [r, s] of size) if (s > bestSize) (best = r), (bestSize = s);

  const remap = new Int32Array(n0).fill(-1);
  const keepLat: number[] = [], keepLon: number[] = [];
  const kept = edges.filter((e) => best >= 0 && find(e.a) === best);
  for (const e of kept) {
    for (const v of [e.a, e.b]) {
      if (remap[v] < 0) {
        remap[v] = keepLat.length;
        keepLat.push(lats[v]);
        keepLon.push(lons[v]);
      }
    }
  }
  const n = keepLat.length;
  const x = new Float64Array(n), y = new Float64Array(n);
  for (let i = 0; i < n; i++) [x[i], y[i]] = project(origin, keepLat[i], keepLon[i]);

  const deg = new Int32Array(n + 1);
  for (const e of kept) {
    deg[remap[e.a]]++;
    deg[remap[e.b]]++;
  }
  const adjStart = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) adjStart[i + 1] = adjStart[i] + deg[i];
  const fill = adjStart.slice(0, n);
  const m = adjStart[n];
  const adjTo = new Int32Array(m), adjLen = new Float32Array(m), adjCost = new Float32Array(m), adjFlags = new Uint8Array(m);
  for (const e of kept) {
    const a = remap[e.a], b = remap[e.b];
    const len = Math.hypot(x[a] - x[b], y[a] - y[b]);
    for (const [u, v] of [[a, b], [b, a]]) {
      const k = fill[u]++;
      adjTo[k] = v;
      adjLen[k] = len;
      adjCost[k] = len * e.factor;
      adjFlags[k] = e.flags ?? 0;
    }
  }
  const g: RoadGraph = {
    origin,
    n,
    x,
    y,
    lat: Float64Array.from(keepLat),
    lon: Float64Array.from(keepLon),
    adjStart,
    adjTo,
    adjLen,
    adjCost,
    adjFlags,
    edgeCount: kept.length,
    dataTimestamp,
    nodeIndex: null as unknown as SpatialIndex,
    edgeIndex: null as unknown as EdgeIndex,
  };
  g.nodeIndex = new SpatialIndex(g, 60);
  g.edgeIndex = new EdgeIndex(g, 40);
  return g;
}

// ───────────────────────── 공간 색인 ─────────────────────────

export class SpatialIndex {
  private cells = new Map<number, number[]>();
  constructor(private g: { n: number; x: Float64Array; y: Float64Array }, private cell: number) {
    for (let i = 0; i < g.n; i++) {
      const k = this.key(Math.floor(g.x[i] / cell), Math.floor(g.y[i] / cell));
      let c = this.cells.get(k);
      if (!c) this.cells.set(k, (c = []));
      c.push(i);
    }
  }
  private key(cx: number, cy: number) {
    return (cx + 50_000) * 100_000 + (cy + 50_000);
  }
  /** maxDist 안의 가장 가까운 노드, 없으면 -1 */
  nearest(px: number, py: number, maxDist: number): number {
    const c = this.cell;
    const cx = Math.floor(px / c), cy = Math.floor(py / c);
    const rings = Math.ceil(maxDist / c);
    let best = -1, bestD = maxDist * maxDist;
    for (let r = 0; r <= rings; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          const list = this.cells.get(this.key(i, j));
          if (!list) continue;
          for (const v of list) {
            const d = (this.g.x[v] - px) ** 2 + (this.g.y[v] - py) ** 2;
            if (d < bestD) (bestD = d), (best = v);
          }
        }
      }
      // 이번 고리까지 찾은 최단 거리가 다음 고리 최소 거리보다 짧으면 종료
      if (best >= 0 && Math.sqrt(bestD) <= r * c) break;
    }
    return best;
  }
}

export function pointSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 간선(선분) 색인: 그림 모양이 실제 길 위에 얼마나 놓이는지 빠르게 추정할 때 쓴다. */
export class EdgeIndex {
  private cells = new Map<number, Int32Array>();
  constructor(private g: RoadGraph, private cell: number) {
    const tmp = new Map<number, number[]>();
    for (let a = 0; a < g.n; a++) {
      for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) {
        const b = g.adjTo[k];
        if (b < a) continue;
        const x0 = Math.floor(Math.min(g.x[a], g.x[b]) / cell), x1 = Math.floor(Math.max(g.x[a], g.x[b]) / cell);
        const y0 = Math.floor(Math.min(g.y[a], g.y[b]) / cell), y1 = Math.floor(Math.max(g.y[a], g.y[b]) / cell);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) continue; // 비정상적으로 긴 간선은 색인 생략
        for (let i = x0; i <= x1; i++)
          for (let j = y0; j <= y1; j++) {
            const key = this.key(i, j);
            let c = tmp.get(key);
            if (!c) tmp.set(key, (c = []));
            c.push(a, b);
          }
      }
    }
    for (const [k, v] of tmp) this.cells.set(k, Int32Array.from(v));
  }
  private key(cx: number, cy: number) {
    return (cx + 50_000) * 100_000 + (cy + 50_000);
  }
  /** 가장 가까운 길까지 거리 (maxDist에서 자름) */
  distance(px: number, py: number, maxDist: number): number {
    const c = this.cell, g = this.g;
    const cx = Math.floor(px / c), cy = Math.floor(py / c);
    const rings = Math.ceil(maxDist / c);
    let best = maxDist;
    for (let r = 0; r <= rings; r++) {
      for (let i = cx - r; i <= cx + r; i++) {
        for (let j = cy - r; j <= cy + r; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r) continue;
          const list = this.cells.get(this.key(i, j));
          if (!list) continue;
          for (let k = 0; k < list.length; k += 2) {
            const a = list[k], b = list[k + 1];
            const d = pointSegDist(px, py, g.x[a], g.y[a], g.x[b], g.y[b]);
            if (d < best) best = d;
          }
        }
      }
      if (best <= r * c) break;
    }
    return best;
  }
}

// ───────────────────────── 최단 경로 (A*) ─────────────────────────

/** 재사용 가능한 A* 탐색기. 간선 비용에 '현재 그림 선분에서 벗어난 정도' 벌점을 더할 수 있다. */
export class PathFinder {
  private g: Float64Array;
  private prev: Int32Array;
  private stamp: Int32Array;
  private closed: Int32Array;
  private run = 0;
  private heapNode: Int32Array;
  private heapKey: Float64Array;
  private size = 0;

  constructor(private graph: RoadGraph) {
    const n = graph.n;
    this.g = new Float64Array(n);
    this.prev = new Int32Array(n);
    this.stamp = new Int32Array(n);
    this.closed = new Int32Array(n);
    this.heapNode = new Int32Array(Math.max(16, graph.adjTo.length + 1));
    this.heapKey = new Float64Array(this.heapNode.length);
  }

  private push(v: number, k: number) {
    if (this.size >= this.heapNode.length) {
      const nn = new Int32Array(this.heapNode.length * 2), nk = new Float64Array(this.heapNode.length * 2);
      nn.set(this.heapNode);
      nk.set(this.heapKey);
      this.heapNode = nn;
      this.heapKey = nk;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heapKey[p] <= k) break;
      this.heapNode[i] = this.heapNode[p];
      this.heapKey[i] = this.heapKey[p];
      i = p;
    }
    this.heapNode[i] = v;
    this.heapKey[i] = k;
  }
  private pop(): number {
    const top = this.heapNode[0];
    const lastN = this.heapNode[--this.size], lastK = this.heapKey[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.heapKey[c + 1] < this.heapKey[c]) c++;
      if (this.heapKey[c] >= lastK) break;
      this.heapNode[i] = this.heapNode[c];
      this.heapKey[i] = this.heapKey[c];
      i = c;
    }
    this.heapNode[i] = lastN;
    this.heapKey[i] = lastK;
    return top;
  }

  /**
   * s→t 경로(노드 목록). guide 선분이 있으면 그 선분에서 멀어지는 간선에 벌점을 준다.
   * 탐색 한도를 넘거나 연결이 없으면 null (가짜 연결선을 만들지 않는다).
   */
  route(
    s: number,
    t: number,
    guide?: { ax: number; ay: number; bx: number; by: number; tol: number; weight: number },
    maxExpand = 40_000,
    /** 꺾임 벌점(미터 환산, 90° 기준). 0이면 사용 안 함 */
    turnCost = 0,
    /** s에 들어오기 직전 노드 (이전 구간에서 이어지는 방향) */
    startPrev = -1,
  ): number[] | null {
    if (s === t) return [s];
    const G = this.graph;
    const run = ++this.run;
    this.size = 0;
    this.g[s] = 0;
    this.stamp[s] = run;
    this.prev[s] = -1;
    const tx = G.x[t], ty = G.y[t];
    this.push(s, Math.hypot(G.x[s] - tx, G.y[s] - ty));
    let expanded = 0;
    while (this.size > 0) {
      const u = this.pop();
      if (this.closed[u] === run) continue;
      this.closed[u] = run;
      if (u === t) break;
      if (++expanded > maxExpand) return null;
      const gu = this.g[u];
      const pu = u === s ? startPrev : this.prev[u];
      let inX = 0, inY = 0, inL = 0;
      if (turnCost > 0 && pu >= 0) {
        inX = G.x[u] - G.x[pu];
        inY = G.y[u] - G.y[pu];
        inL = Math.hypot(inX, inY);
      }
      for (let k = G.adjStart[u]; k < G.adjStart[u + 1]; k++) {
        const v = G.adjTo[k];
        if (this.closed[v] === run) continue;
        let c = G.adjCost[k];
        if (inL > 0) {
          // 들어온 방향과 나가는 방향 사이 각도. 25° 미만은 직진으로 본다.
          const ox = G.x[v] - G.x[u], oy = G.y[v] - G.y[u];
          const oL = Math.hypot(ox, oy);
          if (oL > 0) {
            const cos = Math.max(-1, Math.min(1, (inX * ox + inY * oy) / (inL * oL)));
            const deg = (Math.acos(cos) * 180) / Math.PI;
            if (deg > 25) c += turnCost * Math.pow(Math.min(deg, 180) / 90, 1.5);
          }
        }
        if (guide) {
          const mx = (G.x[u] + G.x[v]) / 2, my = (G.y[u] + G.y[v]) / 2;
          const d = pointSegDist(mx, my, guide.ax, guide.ay, guide.bx, guide.by) / guide.tol;
          c *= 1 + guide.weight * d * d;
        }
        const ng = gu + c;
        if (this.stamp[v] !== run || ng < this.g[v]) {
          this.stamp[v] = run;
          this.g[v] = ng;
          this.prev[v] = u;
          this.push(v, ng + Math.hypot(G.x[v] - tx, G.y[v] - ty));
        }
      }
    }
    if (this.stamp[t] !== run || this.closed[t] !== run) return null;
    const path: number[] = [];
    for (let v = t; v !== -1; v = this.prev[v]) path.push(v);
    return path.reverse();
  }
}

export function hasEdge(g: RoadGraph, a: number, b: number): boolean {
  for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) return true;
  return false;
}

// ───────────────────────── 길 성격 ─────────────────────────

/** 큰 차도(왕복 차로가 넓은 길: primary·secondary·tertiary) */
export const EDGE_MAJOR = 1;
/** 비포장 (흙·자갈·잔디 등) */
export const EDGE_UNPAVED = 2;
/** 가로등 있음 (lit=yes) */
export const EDGE_LIT = 4;
/** 가로등 없음 (lit=no) */
export const EDGE_UNLIT = 8;
/** 계단 */
export const EDGE_STEPS = 16;

export interface RoadStats {
  /** 큰 차도 거리 비율 */
  major: number;
  /** 비포장 거리 비율 */
  unpaved: number;
  /** 가로등 정보가 있는 길 중 가로등 있는 길 비율 (정보가 없으면 null) */
  lit: number | null;
  /** 가로등 정보가 있는 길의 비율 (OSM 기록 범위) */
  litKnown: number;
  /** 계단 구간 수 */
  steps: number;
}

function edgeFlags(g: RoadGraph, a: number, b: number): number {
  for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) return g.adjFlags[k];
  return 0;
}

/** 경로(노드 목록)가 지나는 길의 성격 요약 */
export function roadStats(g: RoadGraph, path: number[]): RoadStats {
  let total = 0, major = 0, unpaved = 0, lit = 0, known = 0, steps = 0;
  let prevSteps = false;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const d = Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]);
    const f = edgeFlags(g, a, b);
    total += d;
    if (f & EDGE_MAJOR) major += d;
    if (f & EDGE_UNPAVED) unpaved += d;
    if (f & (EDGE_LIT | EDGE_UNLIT)) known += d;
    if (f & EDGE_LIT) lit += d;
    const isSteps = (f & EDGE_STEPS) !== 0;
    if (isSteps && !prevSteps) steps++;
    prevSteps = isSteps;
  }
  const r = (v: number) => (total > 0 ? Math.round((v / total) * 100) / 100 : 0);
  return { major: r(major), unpaved: r(unpaved), lit: known > 0 ? Math.round((lit / known) * 100) / 100 : null, litKnown: r(known), steps };
}
