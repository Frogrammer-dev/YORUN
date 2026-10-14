import type { RoadGraph } from './graph';
import type { ExactRoadPortGraph } from './exactRoadPortGraph';

type Point = readonly [number, number];

/** Lower bound for a completed suffix, not a score or a prefix optimality claim. */
export function createOrderedClosureBound(g: RoadGraph, pg: ExactRoadPortGraph, guide: readonly Point[], radius: number, start: number) {
  if (!guide.length || !Number.isFinite(radius) || radius < 0) throw new Error('Invalid ordered closure bound input');
  let gamma = 1, setupOperations = 0, queryCount = 0, cacheHits = 0;
  const cache = new Map<number, number>();
  for (const arc of pg.edges) for (let i = 1; i < arc.nodes.length; i++) {
    const a = arc.nodes[i - 1], b = arc.nodes[i], physical = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]);
    let native = -1;
    for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) { native = g.adjLen[e]; break; }
    if (native < 0) throw new Error('Closure bound received a nonexistent road edge');
    if (physical > 0) gamma = Math.min(gamma, native / physical);
    setupOperations++;
  }
  gamma = Math.max(0, gamma * (1 - 1e-9));
  const r = radius + 1e-8, tail = new Float64Array(guide.length);
  for (let i = guide.length - 1; i >= 0; i--) {
    const a = guide[i];
    let value = Math.max(0, Math.hypot(a[0] - g.x[start], a[1] - g.y[start]) - r);
    for (let j = i + 1; j < guide.length; j++) {
      setupOperations++; const b = guide[j];
      value = Math.max(value, Math.max(0, Math.hypot(b[0] - a[0], b[1] - a[1]) - 2 * r) + tail[j]);
    }
    tail[i] = value;
  }
  const estimate = (node: number, phase: number) => {
    if (!Number.isInteger(phase) || phase < 0 || phase >= guide.length) throw new Error('Invalid bound phase');
    queryCount++;
    const key = node * guide.length + phase, cached = cache.get(key);
    if (cached !== undefined) { cacheHits++; return cached; }
    let value = Math.hypot(g.x[node] - g.x[start], g.y[node] - g.y[start]);
    for (let i = phase + 1; i < guide.length; i++) {
      const p = guide[i];
      value = Math.max(value, Math.max(0, Math.hypot(g.x[node] - p[0], g.y[node] - p[1]) - r) + tail[i]);
    }
    const nativeBound = gamma * value; cache.set(key, nativeBound); return nativeBound;
  };
  return { estimate, gamma, setupOperations, diagnostics: () => ({ queryCount, cacheHits, computedPositions: cache.size, setupOperations, onlyCompletedSuffixLowerBound: true }) };
}
