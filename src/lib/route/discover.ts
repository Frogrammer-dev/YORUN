// 동네 길 먼저 찾기: 블록을 합친 자연스러운 고리 코스를 모은 뒤, 각 코스가 어떤 그림을 닮았는지 판정한다.
// - 추천(discover): 동네 고리 → 9가지 그림 중 가장 닮은 것으로 이름 붙여 닮은 순으로
// - 그림 지정·직접 그리기(shape): 동네 고리 + 그림 모양대로 블록을 칠한 고리 + 유연 맞추기(findRoutes) 중 잘 맞는 순으로

import { dominantGridAngle, evaluatePath, findRoutes, toCandidate, type FindResult, type Placement, type Region, type RouteCandidate } from "./fit";
import { branchLoops, type BranchedLoop } from "./branches";
import { budgetOf, type Budget } from "./budget";
import { roadStats, type RoadGraph } from "./graph";
import { buildBlocks, growLoops, loopSamples, matchShape, shapeSamples, unionForPlacement, type BlockMap, type NaturalLoop } from "./loops";
import type { ShapeDef } from "./shapes";

type XY = [number, number];

/** 경로 길이 ≈ 모양 둘레 × 이 비율 (fit.ts와 같은 가정) */
const DETOUR = 1.2;
/** 동네 추천에서 '○○ 닮은 코스'로 보여 줄 최소 유사도 */
const DISCOVER_MIN_SIMILARITY = 60;

const blockCache = new WeakMap<RoadGraph, { key: string; m: BlockMap }>();
function blocksFor(g: RoadGraph, region: Region): BlockMap {
  const key = `${Math.round(region.minX)},${Math.round(region.minY)},${Math.round(region.maxX)},${Math.round(region.maxY)}`;
  const c = blockCache.get(g);
  if (c && c.key === key) return c.m;
  const m = buildBlocks(g, ((region.maxX - region.minX) * (region.maxY - region.minY)) / 4);
  blockCache.set(g, { key, m });
  return m;
}

export interface DiscoverOptions {
  shapes: ShapeDef[];
  minMeters: number;
  maxMeters: number;
  region: Region;
  /** "discover": 동네 고리를 그림별로 판정해 닮은 순, "shape": 지정한 그림 하나를 여러 방법으로 찾기 */
  mode: "discover" | "shape";
  /** 시간 예산(ms). budget을 주면 무시 */
  timeBudgetMs?: number;
  /** 탐색 예산 (테스트는 단계 예산으로 결정적 결과) */
  budget?: Budget;
  maxResults?: number;
  /** 낙서 인식용으로 함께 돌려줄 동네 고리 수 (discover 모드) */
  poolSize?: number;
  /** (실험) 왕복 가지를 붙인 동네 고리를 이만큼 낙서 인식 후보에 더한다 (discover 모드) */
  branchPool?: number;
  /** 길 조건 선호: 큰 차도 피하기·가로등 있는 길 우선 (순위에 반영) */
  prefs?: { avoidMajor?: boolean; preferLit?: boolean };
  onProgress?: (fraction: number, label: string) => void;
}

/** 고리 하나를 그림 하나에 맞춰 평가 (배치는 고리에 맞춘 것) */
function scoreLoop(g: RoadGraph, loop: NaturalLoop, shape: ShapeDef, tmpl: XY[], minM: number, maxM: number) {
  const xy = loop.path.map((v) => [g.x[v], g.y[v]] as XY);
  const fit = matchShape(xy, shape, tmpl, true);
  if (!fit) return null;
  const p: Placement = { cx: fit.cx, cy: fit.cy, scale: fit.scale, rotDeg: fit.rotDeg };
  const e = evaluatePath(g, shape, p, loop.path, minM, maxM);
  return { p, e: { ...e, fit: p } };
}

/** 그림 모양대로 블록을 칠해 만든 고리들 (지정 그림용) */
function guidedLoops(g: RoadGraph, m: BlockMap, shape: ShapeDef, o: DiscoverOptions, budget: Budget, fraction: number): NaturalLoop[] {
  const r = o.region;
  const W = r.maxX - r.minX, H = r.maxY - r.minY;
  const sMin = o.minMeters / (DETOUR * shape.perimeter);
  const sMax = Math.min(o.maxMeters / (DETOUR * shape.perimeter), Math.min(W, H) * 0.98);
  if (sMax < Math.max(sMin, 120)) return [];
  const lo = Math.max(sMin, 120);
  const scales = [0, 1, 2, 3].map((k) => lo * Math.pow(sMax / lo, k / 3));
  const grid = dominantGridAngle(g);
  const rots = shape.rotationFree ? [0] : [...new Set([-20, 0, 20, grid].map((d) => Math.round(Math.max(-45, Math.min(45, d)))))];
  const seen = new Set<string>();
  const out: NaturalLoop[] = [];
  for (const scale of scales)
    for (const rotDeg of rots)
      for (let cx = r.minX + scale * 0.5; cx <= r.maxX - scale * 0.5; cx += Math.max(80, scale * 0.18))
        for (let cy = r.minY + scale * 0.5; cy <= r.maxY - scale * 0.5; cy += Math.max(80, scale * 0.18)) {
          if (!budget.ok(fraction)) return out;
          budget.spend();
          const loop = unionForPlacement(g, m, shape, { cx, cy, scale, rotDeg }, r);
          if (!loop || loop.length < o.minMeters * 0.85 || loop.length > o.maxMeters * 1.15) continue;
          const key = loop.faces.slice().sort((a, b) => a - b).join(",");
          if (seen.has(key)) continue;
          seen.add(key);
          out.push(loop);
        }
  return out;
}

/** 그림 판정 없이 동네 고리 그대로의 코스 (낙서 인식이 이름을 붙인다) */
function plainCandidate(g: RoadGraph, loop: NaturalLoop, i: number): RouteCandidate {
  const xs = loop.path.map((v) => g.x[v]), ys = loop.path.map((v) => g.y[v]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    id: `loop-${i}-${loop.path[0]}-${loop.path.length}`,
    shapeId: "doodle",
    shapeName: "동네 고리",
    placement: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: Math.max(maxX - minX, maxY - minY), rotDeg: 0 },
    latlngs: loop.path.map((v) => [Math.round(g.lat[v] * 1e7) / 1e7, Math.round(g.lon[v] * 1e7) / 1e7]),
    outline: [],
    outlines: [],
    moves: [],
    lengthMeters: Math.round(loop.length),
    moveMeters: 0,
    roadInfo: roadStats(g, loop.path),
    similarity: 0,
    meanDeviationMeters: 0,
    maxDeviationMeters: 0,
    zigzagPerKm: 0,
    spikes: 0,
    featureCoverage: 1,
    repeatRatio: 0,
    cost: 0,
  };
}

/** 왕복 가지를 붙인 동네 고리 (낙서 인식이 이름을 붙인다) */
function branchedCandidate(g: RoadGraph, b: BranchedLoop, i: number): RouteCandidate {
  const branchMeters = b.branches.reduce((s, x) => s + x.length, 0);
  return {
    ...plainCandidate(g, { faces: b.loop.faces, path: b.path, length: b.length }, i),
    id: `branch-${i}-${b.loop.path[0]}-${b.branches.map((x) => x.nodes[x.nodes.length - 1]).join("-")}`,
    shapeName: "가지 붙인 동네 고리",
    // 가지는 갔다가 같은 길로 돌아오므로 왕복 중 한 번이 반복이다
    repeatRatio: Math.round((branchMeters / b.length) * 1000) / 1000,
    branchMeters: Math.round(branchMeters),
  };
}

/** 같은 블록 묶음으로 된 고리는 하나만 */
function uniqueLoops(loops: NaturalLoop[]): NaturalLoop[] {
  const seen = new Set<string>();
  return loops.filter((l) => {
    const k = l.faces.slice().sort((a, b) => a - b).join(",");
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 고리 좌표·비교용 표본은 그림마다 다시 만들지 않는다 */
const prepCache = new WeakMap<NaturalLoop, { xy: XY[]; samples: XY[] }>();
let prepGraph: RoadGraph | null = null;
function prepared(loop: NaturalLoop) {
  let p = prepCache.get(loop);
  if (!p) {
    const g = prepGraph!;
    const xy = loop.path.map((v) => [g.x[v], g.y[v]] as XY);
    p = { xy, samples: loopSamples(xy) };
    prepCache.set(loop, p);
  }
  return p;
}

/** 코스가 차지하는 범위(위경도 사각형) */
function box(c: RouteCandidate) {
  let s = Infinity, w = Infinity, n = -Infinity, e = -Infinity;
  for (const [la, lo] of c.latlngs) {
    if (la < s) s = la;
    if (la > n) n = la;
    if (lo < w) w = lo;
    if (lo > e) e = lo;
  }
  return { s, w, n, e };
}

/** 두 코스가 사실상 같은 자리인가: 차지하는 범위가 60% 이상 겹친다 (모양 배치가 아니라 실제 코스로 비교) */
export function overlap(a: RouteCandidate, b: RouteCandidate): boolean {
  const A = box(a), B = box(b);
  const iw = Math.min(A.e, B.e) - Math.max(A.w, B.w), ih = Math.min(A.n, B.n) - Math.max(A.s, B.s);
  if (iw <= 0 || ih <= 0) return false;
  const inter = iw * ih, area = (r: typeof A) => (r.e - r.w) * (r.n - r.s);
  return inter / (area(A) + area(B) - inter) >= 0.6;
}

export function discoverRoutes(g: RoadGraph, o: DiscoverOptions): FindResult {
  prepGraph = g;
  const W = o.region.maxX - o.region.minX, H = o.region.maxY - o.region.minY;
  const tiles = Math.max(1, Math.round(W / 4500)) * Math.max(1, Math.round(H / 4500));
  const budget = budgetOf(o, Math.min(75_000, 30_000 * tiles));
  const maxResults = o.maxResults ?? 8;
  let partial = false;
  o.onProgress?.(0.02, "동네 블록");
  const m = blocksFor(g, o.region);

  // 1) 동네 고리 모으기
  o.onProgress?.(0.05, "동네 고리 코스");
  // 가지를 붙일 고리는 가지 왕복만큼 짧아도 되므로 더 짧은 고리부터 모은다 (그림 판정에는 목표 거리 안의 고리만 쓴다)
  const branching = o.mode === "discover" && (o.branchPool ?? 0) > 0;
  const grown = growLoops(g, m, o.region, branching ? o.minMeters * 0.5 : o.minMeters, o.maxMeters, {
    seeds: Math.min(m.faces.length, 500 * tiles),
    budget,
    fraction: o.mode === "discover" ? 0.45 : 0.25,
  });
  const natural = branching ? grown.filter((l) => l.length >= o.minMeters) : grown;
  // 같은 블록 묶음은 하나만. 동물·사물은 그림 수가 많아 고리가 많으면 고르게 2000개만 비교한다 (기본 도형은 전부)
  const uniq = uniqueLoops(natural);
  const capped = uniq.length > 2000 ? uniq.filter((_, i) => i % Math.ceil(uniq.length / 2000) === 0) : uniq;
  const pools: Array<{ shape: ShapeDef; loops: NaturalLoop[] }> = o.shapes.map((shape) => ({ shape, loops: shape.kind && shape.kind !== "basic" ? capped : uniq }));

  // 2) 지정 그림이면: 그림 모양대로 블록을 칠한 고리도 더한다
  if (o.mode === "shape") {
    o.onProgress?.(0.3, "그림 모양 블록");
    for (const pl of pools) pl.loops = [...natural, ...guidedLoops(g, m, pl.shape, o, budget, 0.5)];
  }

  // 3) 그림마다: 빠른 판정(점 대응 맞추기)으로 상위 고리만 골라 정밀 평가
  const all: RouteCandidate[] = [];
  let evaluated = 0;
  pools.forEach(({ shape, loops }, si) => {
    o.onProgress?.(0.5 + (0.4 * si) / pools.length, shape.name);
    // 지정 그림이면 마지막 유연 맞추기에 예산을 남긴다
    if (!budget.ok(o.mode === "shape" ? 0.6 : 1)) {
      partial = true;
      return;
    }
    const tmpl = shapeSamples(shape);
    const quick = loops
      .map((loop) => {
        const pre = prepared(loop);
        return { loop, r: matchShape(pre.xy, shape, tmpl, false, pre.samples) };
      })
      .filter((q) => q.r)
      .sort((a, b) => a.r!.resid - b.r!.resid)
      // 정밀 평가 수: 기본 도형은 넉넉히, 동물·사물은 그림 수가 많으므로 적게 (빠른 판정이 대략 맞으면 충분)
      .slice(0, o.mode === "discover" && shape.kind && shape.kind !== "basic" ? 12 : 40);
    const scored: Array<{ p: Placement; e: ReturnType<typeof evaluatePath> & { fit: Placement } }> = [];
    for (const q of quick) {
      if (!budget.ok(o.mode === "shape" ? 0.6 : 1)) {
        partial = true;
        break;
      }
      const s = scoreLoop(g, q.loop, shape, tmpl, o.minMeters, o.maxMeters);
      budget.spend();
      evaluated++;
      if (s) scored.push(s);
    }
    scored.sort((a, b) => a.e.cost - b.e.cost);
    for (const s of scored.slice(0, 12)) all.push(toCandidate(g, shape, s.p, s.e));
  });

  // 4) 지정 그림이면 유연 맞추기 결과도 함께 겨룬다
  if (o.mode === "shape" && budget.ok()) {
    o.onProgress?.(0.9, "그림에 맞춘 코스");
    const r = findRoutes(g, { shapes: o.shapes, minMeters: o.minMeters, maxMeters: o.maxMeters, region: o.region, resultsPerShape: 4, budget });
    all.push(...r.candidates);
    partial ||= r.partial;
    evaluated += r.evaluated;
  }

  // 5) 같은 자리 겹치는 코스를 빼고, 추천은 같은 동네 고리가 여러 그림으로 중복되지 않게
  const rank = (c: RouteCandidate) =>
    c.cost + (o.prefs?.avoidMajor ? 0.15 * c.roadInfo.major : 0) + (o.prefs?.preferLit && c.roadInfo.lit !== null ? 0.05 * (1 - c.roadInfo.lit) : 0);
  all.sort((a, b) => rank(a) - rank(b));
  const chosen: RouteCandidate[] = [];
  const perShape = new Map<string, number>();
  const cap = o.mode === "discover" ? 2 : maxResults;
  for (const c of all) {
    if (chosen.length >= maxResults) break;
    // 추천은 '닮았다'고 이름 붙이므로 덜 닮은 코스는 빼서 엉뚱한 이름을 붙이지 않는다
    if (o.mode === "discover" && c.similarity < DISCOVER_MIN_SIMILARITY) continue;
    if (chosen.some((d) => overlap(c, d) && (o.mode === "discover" || d.shapeId === c.shapeId))) continue;
    if ((perShape.get(c.shapeId) ?? 0) >= cap) continue;
    perShape.set(c.shapeId, (perShape.get(c.shapeId) ?? 0) + 1);
    chosen.push(c);
  }
  // 보여 줄 때는 닮은 정도 순
  chosen.sort((a, b) => b.similarity - a.similarity);
  o.onProgress?.(1, "");
  // 낙서 인식 후보: 그림에 맞춘 나머지 코스 + 고르게 뽑은 동네 고리 (모양 판정은 화면 쪽 모델이 한다)
  let pool: RouteCandidate[] | undefined;
  if (o.mode === "discover" && (o.poolSize ?? 0) > 0) {
    const fromTemplates = all.filter((c) => !chosen.includes(c));
    const inRange = uniq.filter((l) => l.length >= o.minMeters * 0.9 && l.length <= o.maxMeters * 1.1);
    const step = Math.max(1, Math.ceil(inRange.length / o.poolSize!));
    const fromLoops = inRange.filter((_, i) => i % step === 0).map((l, i) => plainCandidate(g, l, i));
    pool = [...fromTemplates, ...fromLoops];
    if (branching) {
      const branched = branchLoops(g, uniqueLoops(grown), { minMeters: o.minMeters, maxMeters: o.maxMeters, max: o.branchPool! });
      pool.push(...branched.map((b, i) => branchedCandidate(g, b, i)));
    }
  }
  return { candidates: chosen, partial, evaluated, pool };
}
