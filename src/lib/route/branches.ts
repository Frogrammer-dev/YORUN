// 왕복 가지 붙이기 (실험): 동네 고리에 '나갔다가 같은 길로 돌아오는' 가지를 1~2개 붙여
// 꼬리·다리·더듬이처럼 튀어나온 선이 있는 그림 후보를 만든다. 무엇처럼 보이는지는 낙서 인식이 판정한다.
// 이어진 길 묶음은 길마다 최대 두 번 지나면 한 번에 달릴 수 있으므로, 가지는 고리에서 곧게 뻗어 나간 뒤 그대로 되돌아온다.

import type { Budget } from "./budget";
import type { RoadGraph } from "./graph";
import type { NaturalLoop } from "./loops";

type XY = [number, number];

/** 가지 길이 후보 = 고리 크기(긴 변) × 이 비율 */
const TAIL_FRACTIONS = [0.25, 0.45, 0.7];
/** 교차점에서 이보다 많이 꺾어야 하면 가지를 거기서 멈춘다 (가지는 곧은 선이어야 그림에서 '획'으로 보인다) */
const MAX_TURN_DEG = 40;
/** 가지 끝이 고리에서 이만큼(고리 크기 대비) 떨어져야 28×28 낙서에서 고리와 구별된다 */
const MIN_TIP_GAP = 0.12;
/** 두 가지가 붙는 자리는 고리 크기 대비 이만큼 떨어져야 한다 (한 곳에 몰리면 굵은 막대 하나로 보인다) */
const MIN_ROOT_GAP = 0.25;

export interface Branch {
  /** 고리 경로(path)에서 가지가 붙는 위치 */
  at: number;
  /** 고리 위 교차점부터 가지 끝까지 노드 */
  nodes: number[];
  /** 한 방향 길이 (m) */
  length: number;
}

export interface BranchedLoop {
  loop: NaturalLoop;
  branches: Branch[];
  /** 고리 + 가지를 왕복한 전체 경로 (닫힌 경로) */
  path: number[];
  /** 전체 달리는 거리 = 고리 + 2 × 가지 */
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

function distToPolyline(px: number, py: number, line: XY[]): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1], [bx, by] = line[i];
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

/** v → u 방향으로 가장 곧게 이어지는 길을 maxLen까지 따라간다. 고리 위 노드·이미 지난 노드는 밟지 않는다. */
function walkStraight(g: RoadGraph, onLoop: Uint8Array, v: number, u: number, maxLen: number): { nodes: number[]; cum: number[] } {
  const nodes = [v, u], cum = [0, Math.hypot(g.x[u] - g.x[v], g.y[u] - g.y[v])];
  const seen = new Set(nodes);
  while (cum[cum.length - 1] < maxLen) {
    const cur = nodes[nodes.length - 1], prev = nodes[nodes.length - 2];
    const h = Math.atan2(g.y[cur] - g.y[prev], g.x[cur] - g.x[prev]);
    let best = -1, bestTurn = Infinity;
    for (let k = g.adjStart[cur]; k < g.adjStart[cur + 1]; k++) {
      const w = g.adjTo[k];
      if (w === prev || onLoop[w] || seen.has(w)) continue;
      let d = Math.abs(Math.atan2(g.y[w] - g.y[cur], g.x[w] - g.x[cur]) - h);
      if (d > Math.PI) d = 2 * Math.PI - d;
      if (d < bestTurn) {
        bestTurn = d;
        best = w;
      }
    }
    const junction = g.adjStart[cur + 1] - g.adjStart[cur] >= 3;
    // 교차점에서 곧은 길이 없으면 멈춘다. 교차점이 아닌 점(길의 굽은 자리)은 길을 그대로 따라간다
    if (best < 0 || (junction && (bestTurn * 180) / Math.PI > MAX_TURN_DEG)) break;
    seen.add(best);
    nodes.push(best);
    cum.push(cum[cum.length - 1] + Math.hypot(g.x[best] - g.x[cur], g.y[best] - g.y[cur]));
  }
  return { nodes, cum };
}

/** 고리 하나에서 붙일 수 있는 가지 후보 (붙는 자리·방향·길이별) */
export function branchOptions(g: RoadGraph, loop: NaturalLoop): Branch[] {
  const path = loop.path;
  const ring: XY[] = path.map((v) => [g.x[v], g.y[v]]);
  const xs = ring.map((p) => p[0]), ys = ring.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const onLoop = new Uint8Array(g.n);
  for (const v of path) onLoop[v] = 1;
  const out: Branch[] = [];
  const last = path[0] === path[path.length - 1] ? path.length - 1 : path.length;
  for (let i = 0; i < last; i++) {
    const v = path[i];
    if (g.adjStart[v + 1] - g.adjStart[v] < 3) continue;
    for (let k = g.adjStart[v]; k < g.adjStart[v + 1]; k++) {
      const u = g.adjTo[k];
      if (onLoop[u]) continue;
      const walk = walkStraight(g, onLoop, v, u, TAIL_FRACTIONS[TAIL_FRACTIONS.length - 1] * size * 1.15);
      for (const f of TAIL_FRACTIONS) {
        const target = f * size;
        const j = walk.cum.findIndex((d) => d >= target);
        if (j < 0 || walk.cum[j] > target * 1.3) continue;
        const tip = walk.nodes[j];
        if (distToPolyline(g.x[tip], g.y[tip], ring) < MIN_TIP_GAP * size) continue;
        out.push({ at: i, nodes: walk.nodes.slice(0, j + 1), length: walk.cum[j] });
      }
    }
  }
  return out;
}

/** 고리 경로에 가지들을 왕복으로 끼워 넣은 닫힌 경로 */
export function withBranches(loopPath: number[], branches: Branch[]): number[] {
  const byAt = new Map<number, Branch[]>();
  for (const b of branches) byAt.set(b.at, [...(byAt.get(b.at) ?? []), b]);
  const out: number[] = [];
  for (let i = 0; i < loopPath.length; i++) {
    out.push(loopPath[i]);
    for (const b of byAt.get(i) ?? []) {
      // 나갔다 (끝까지) 같은 길로 돌아온다: v a b … tip … b a v
      for (let k = 1; k < b.nodes.length; k++) out.push(b.nodes[k]);
      for (let k = b.nodes.length - 2; k >= 0; k--) out.push(b.nodes[k]);
    }
  }
  return out;
}

/**
 * 고리들에 가지 1~2개를 붙인 후보를 만든다. 전체 거리(가지는 왕복)가 목표 범위에 드는 것만,
 * 고리마다 perLoop개까지 무작위로 고르게 뽑는다 (같은 지도·조건이면 같은 결과).
 */
export function branchLoops(
  g: RoadGraph,
  loops: NaturalLoop[],
  o: { minMeters: number; maxMeters: number; max: number; perLoop?: number; budget?: Budget; fraction?: number },
): BranchedLoop[] {
  const perLoop = o.perLoop ?? 4;
  const rand = rng(777);
  const lo = o.minMeters * 0.9, hi = o.maxMeters * 1.1;
  // 고리를 고르게 섞어 앞쪽 고리만 쓰이지 않게
  const order = loops.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const out: BranchedLoop[] = [];
  for (const li of order) {
    if (out.length >= o.max) break;
    if (o.budget && !o.budget.ok(o.fraction ?? 1)) break;
    o.budget?.spend();
    const loop = loops[li];
    if (loop.length >= hi) continue;
    const opts = branchOptions(g, loop);
    if (!opts.length) continue;
    const xs = loop.path.map((v) => g.x[v]), ys = loop.path.map((v) => g.y[v]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const rootGap = (a: Branch, b: Branch) => Math.hypot(g.x[loop.path[a.at]] - g.x[loop.path[b.at]], g.y[loop.path[a.at]] - g.y[loop.path[b.at]]);
    const fits = (bs: Branch[]) => {
      const total = loop.length + 2 * bs.reduce((s, b) => s + b.length, 0);
      return total >= lo && total <= hi ? total : -1;
    };
    const picked: Branch[][] = [];
    const seen = new Set<string>();
    // 가지 하나 · 둘을 번갈아 시도한다
    for (let t = 0; t < perLoop * 6 && picked.length < perLoop; t++) {
      const a = opts[Math.floor(rand() * opts.length)];
      let bs = [a];
      if (t % 2 === 1) {
        const b = opts[Math.floor(rand() * opts.length)];
        if (rootGap(a, b) < MIN_ROOT_GAP * size) continue;
        // 두 가지가 같은 길을 쓰면 그 길을 네 번 지나게 된다
        if (b.nodes.some((v) => a.nodes.includes(v))) continue;
        bs = [a, b].sort((p, q) => p.at - q.at);
      }
      if (fits(bs) < 0) continue;
      const key = bs.map((b) => `${b.at}:${b.nodes[1]}:${b.nodes.length}`).join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      picked.push(bs);
    }
    for (const bs of picked) {
      if (out.length >= o.max) break;
      out.push({ loop, branches: bs, path: withBranches(loop.path, bs), length: fits(bs) });
    }
  }
  return out;
}
