import type { Region } from './fit';
import type { RoadGraph } from './graph';
import type { ExactRoadPortGraph } from './exactRoadPortGraph';

/** 원12의 lossless span35–94 진단 후 고정. 점수·도형을 생성 단계에서 읽지 않는다. */
export const MACRO_CYCLE_PARAMS = {
  maxArcDepth: 128, maxExpansions: 4194304, statesPerLayer: 4096,
  statesPerStratum: 32, maxFanout: 32, cycleCap: 256, cyclesPerStratum: 4,
  minMeters: 3000, maxMeters: 8000, repeatMax: .2, turnThresholdDeg: 45,
  hardRunLimit: false, candidateQualityUsed: false, geometryHashSeed: 20261013,
} as const;
/** 원래와 같은 총4096 slots. 반복 상태와 무반복 상태 및 endpoint 공간을 별도 보존한다. */
export const MACRO_CYCLE_DIVERSE_PARAMS = { ...MACRO_CYCLE_PARAMS, statesPerStratum: 4, repeatedPrefixQuota: true, endpointSpatialQuota: true } as const;

type Arc = { id: number; edgeId: number; from: number; to: number; nodes: number[]; meters: number; key: string; hash: number; first: number; last: number; pos: number; neg: number; area: number; minX: number; maxX: number; minY: number; maxY: number };
type State = { start: number; at: number; path: number[]; used: Map<number, number>; meters: number; repeated: number; hash: number; pos: number; neg: number; first: number; last: number; area: number; minX: number; maxX: number; minY: number; maxY: number };
export type MacroCycleCandidate = { nodes: number[]; geometryKey: string; lengthMeters: number; repeatRatio: number; macroArcCount: number; concaveTurns: number };

const hashText = (s: string, seed: number = MACRO_CYCLE_PARAMS.geometryHashSeed) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
const mix = (a: number, b: number) => Math.imul(a ^ b, 16777619) >>> 0;
const turn = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a)) * 180 / Math.PI;
const turnCount = (t: number) => ({ pos: t >= MACRO_CYCLE_PARAMS.turnThresholdDeg ? 1 : 0, neg: t <= -MACRO_CYCLE_PARAMS.turnThresholdDeg ? 1 : 0 });
const band = (value: number, lo: number, hi: number, n: number) => Math.max(0, Math.min(n - 1, Math.floor((value - lo) / Math.max(hi - lo, 1e-9) * n)));

/** 좌표 해시와 다양성 quota로 실제 연결 고리를 생성한다. 원식 평가는 호출자가 수행한다. */
export function macroCycleSearch(g: RoadGraph, pg: ExactRoadPortGraph, region: Region, diverseStateQuota = false) {
  const P = diverseStateQuota ? MACRO_CYCLE_DIVERSE_PARAMS : MACRO_CYCLE_PARAMS, coord = (v: number) => `${g.x[v].toPrecision(15)},${g.y[v].toPrecision(15)}`;
  const nodeOrder = new Map(pg.ports.map((v, i) => [v, i])), arcs: Arc[] = [], outgoing = new Map<number, Arc[]>();
  for (const e of pg.edges) for (const ns of [e.nodes, e.nodes.slice().reverse()]) {
    let pos = 0, neg = 0, area = 0, first = 0, last = 0;
    for (let i = 1; i < ns.length; i++) {
      const a = ns[i - 1], b = ns[i], heading = Math.atan2(g.y[b] - g.y[a], g.x[b] - g.x[a]);
      area += g.x[a] * g.y[b] - g.x[b] * g.y[a];
      if (i === 1) first = heading; else { const t = turnCount(turn(last, heading)); pos += t.pos; neg += t.neg; } last = heading;
    }
    const key = ns.map(coord).join('|'), arc = { id: arcs.length, edgeId: e.id, from: ns[0], to: ns.at(-1)!, nodes: ns, meters: e.lengthMeters, key, hash: hashText(key), first, last, pos, neg, area, minX: Math.min(...ns.map(v => g.x[v])), maxX: Math.max(...ns.map(v => g.x[v])), minY: Math.min(...ns.map(v => g.y[v])), maxY: Math.max(...ns.map(v => g.y[v])) };
    arcs.push(arc); outgoing.set(arc.from, [...(outgoing.get(arc.from) ?? []), arc]);
  }
  // fanout quota 역시 실제 heading/길이 및 좌표 hash만 읽는다.
  let fanoutSkipped = 0;
  for (const [v, list] of outgoing) {
    if (list.length <= P.maxFanout) { outgoing.set(v, list.slice().sort((a, b) => a.hash - b.hash || a.key.localeCompare(b.key))); continue; }
    const bins = new Map<string, Arc>();
    for (const a of list) {
      const k = `${band(a.first, -Math.PI, Math.PI, 8)}:${band(a.meters, 0, P.maxMeters, 4)}`, previous = bins.get(k);
      if (!previous || a.hash < previous.hash || (a.hash === previous.hash && a.key < previous.key)) bins.set(k, a);
    }
    const kept = [...bins.values()].sort((a, b) => a.hash - b.hash || a.key.localeCompare(b.key)).slice(0, P.maxFanout);
    fanoutSkipped += list.length - kept.length; outgoing.set(v, kept);
  }
  const stateBin = (s: State) => `${band(g.x[s.start], region.minX, region.maxX, 4)}:${band(g.y[s.start], region.minY, region.maxY, 4)}:${band(s.meters, 0, P.maxMeters, 4)}:${s.pos && s.neg ? 1 : 0}${diverseStateQuota ? `:${s.repeated > 0 ? 1 : 0}:${band(g.x[s.at], region.minX, region.maxX, 2)}:${band(g.y[s.at], region.minY, region.maxY, 2)}` : ''}`;
  const pools = new Map<string, Array<{ hash: number; candidate: MacroCycleCandidate }>>(), seenGeometry = new Set<string>();
  let expansions = 0, lengthRejected = 0, repeatBoundRejected = 0, canonicalOrderRejected = 0, closures = 0, strictClosures = 0, closureRepeatRejected = 0, duplicateClosures = 0, stateQuotaSkipped = 0, maxLiveStates = 0, depthReached = 0;
  const depthDiagnostics: Array<{ depth: number; retainedStates: number; retainedSimplePrefixes: number; retainedRepeatPrefixes: number; lengthBands: number[]; strictClosuresCumulative: number }> = [];
  const addClosed = (s: State) => {
    closures++; if (s.meters < P.minMeters || s.meters > P.maxMeters) return;
    if (s.repeated / s.meters > P.repeatMax) { closureRepeatRejected++; return; }
    const ns = s.path.flatMap((id, i) => i ? arcs[id].nodes.slice(1) : arcs[id].nodes.slice());
    if (ns.length < 4 || ns[0] !== ns.at(-1)) return;
    strictClosures++;
    const keys = ns.slice(1).map((v, i) => { const a = coord(ns[i]), b = coord(v); return a < b ? `${a}>${b}` : `${b}>${a}`; }).sort(), geometryKey = keys.join(';');
    if (seenGeometry.has(geometryKey)) { duplicateClosures++; return; } seenGeometry.add(geometryKey);
    const closing = turnCount(turn(s.last, s.first)), pos = s.pos + closing.pos, neg = s.neg + closing.neg, concaveTurns = s.area >= 0 ? neg : pos;
    const cb = concaveTurns === 0 ? 0 : concaveTurns === 1 ? 1 : concaveTurns <= 4 ? 2 : 3;
    const binKey = `${band(s.meters, P.minMeters, P.maxMeters, 4)}:${cb}:${band((s.minX + s.maxX) / 2, region.minX, region.maxX, 2)}:${band((s.minY + s.maxY) / 2, region.minY, region.maxY, 2)}`, hash = hashText(geometryKey), pool = pools.get(binKey) ?? [];
    const candidate = { nodes: ns, geometryKey, lengthMeters: s.meters, repeatRatio: s.repeated / s.meters, macroArcCount: s.path.length, concaveTurns };
    pool.push({ hash, candidate }); pool.sort((a, b) => a.hash - b.hash || a.candidate.geometryKey.localeCompare(b.candidate.geometryKey)); if (pool.length > P.cyclesPerStratum) pool.pop(); pools.set(binKey, pool);
  };
  let states: State[] = pg.ports.map(v => ({ start: v, at: v, path: [], used: new Map(), meters: 0, repeated: 0, hash: hashText(coord(v)), pos: 0, neg: 0, first: 0, last: 0, area: 0, minX: g.x[v], maxX: g.x[v], minY: g.y[v], maxY: g.y[v] }));
  for (let depth = 1; depth <= P.maxArcDepth && states.length && expansions < P.maxExpansions; depth++) {
    depthReached = depth; const next = new Map<string, State[]>();
    for (const s of states) for (const a of outgoing.get(s.at) ?? []) {
      if (expansions >= P.maxExpansions) break; expansions++;
      const meters = s.meters + a.meters; if (meters > P.maxMeters) { lengthRejected++; continue; }
      // 각 cycle의 좌표 최소 port에서 열거하여 중복을 줄인다. 품질 평가 출발점 선택과 별개다.
      if (nodeOrder.get(a.to)! < nodeOrder.get(s.start)!) { canonicalOrderRejected++; continue; }
      const repeated = s.repeated + (s.used.has(a.edgeId) ? a.meters : 0); if (repeated / P.maxMeters > P.repeatMax) { repeatBoundRejected++; continue; }
      const change = s.path.length ? turnCount(turn(s.last, a.first)) : { pos: 0, neg: 0 }, hash = mix(s.hash, a.hash);
      const t: State = { ...s, at: a.to, path: [...s.path, a.id], used: s.used, meters, repeated, hash, pos: s.pos + a.pos + change.pos, neg: s.neg + a.neg + change.neg, first: s.path.length ? s.first : a.first, last: a.last, area: s.area + a.area, minX: Math.min(s.minX, a.minX), maxX: Math.max(s.maxX, a.maxX), minY: Math.min(s.minY, a.minY), maxY: Math.max(s.maxY, a.maxY) };
      if (a.to === s.start) addClosed(t);
      const k = stateBin(t), heap = next.get(k) ?? [], worst = heap.at(-1);
      if (heap.length >= P.statesPerStratum && worst && hash >= worst.hash) { stateQuotaSkipped++; continue; }
      t.used = new Map(s.used); t.used.set(a.edgeId, (t.used.get(a.edgeId) ?? 0) + 1);
      heap.push(t); heap.sort((a, b) => a.hash - b.hash); if (heap.length > P.statesPerStratum) { heap.pop(); stateQuotaSkipped++; } next.set(k, heap);
    }
    states = [...next.values()].flat(); maxLiveStates = Math.max(maxLiveStates, states.length);
    const lengthBands = [0, 0, 0, 0]; for (const s of states) lengthBands[band(s.meters, 0, P.maxMeters, 4)]++;
    depthDiagnostics.push({ depth, retainedStates: states.length, retainedSimplePrefixes: states.filter(s => s.repeated === 0).length, retainedRepeatPrefixes: states.filter(s => s.repeated > 0).length, lengthBands, strictClosuresCumulative: strictClosures });
  }
  const candidates = [...pools.values()].flat().sort((a, b) => a.hash - b.hash || a.candidate.geometryKey.localeCompare(b.candidate.geometryKey)).slice(0, P.cycleCap).map(v => v.candidate);
  return { candidates, params: P, diagnostics: { portCount: pg.ports.length, undirectedMacroEdges: pg.edges.length, directedArcs: arcs.length, fanoutSkipped, expansions, budgetReached: expansions >= P.maxExpansions, depthReached, maxLiveStates, stateQuotaSkipped, lengthRejected, repeatBoundRejected, canonicalOrderRejected, closures, strictClosures, closureRepeatRejected, duplicateClosures, uniqueBeforeCap: seenGeometry.size, selectedCycles: candidates.length, candidateStrata: pools.size, lowerBoundPruningUsed: false, diverseStateQuota, depthDiagnostics } };
}
