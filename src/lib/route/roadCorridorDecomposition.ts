import type { Region } from './fit';
import type { RoadGraph } from './graph';

export const MAXIMAL_CORRIDOR_PARAMS = { minChain: 80, straightRatio: .96, continuationDeg: 10, mutualUnique: true, maximalBidirectional: true, degree2UsesSameAngleRule: true } as const;
export interface CorridorTrace { nodes: number[]; length: number; reason: 'selected' | 'circular' | 'too-short' | 'not-straight' | 'outside'; }
/** A pairing of incident edges gives a non-branching, order-independent edge decomposition. */
export function maximalRoadCorridors(g: RoadGraph, region: Region, observe?: (trace: CorridorTrace) => void) {
  const P = MAXIMAL_CORRIDOR_PARAMS, edges: Array<{ a: number; b: number; length: number }> = [], incident: number[][] = Array.from({ length: g.n }, () => []);
  for (let a = 0; a < g.n; a++) for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (a < g.adjTo[e]) {
    const b = g.adjTo[e], id = edges.length; edges.push({ a, b, length: g.adjLen[e] }); incident[a].push(id); incident[b].push(id);
  }
  const paired = new Map<string, number>(), other = (ei: number, v: number) => edges[ei].a === v ? edges[ei].b : edges[ei].a;
  let ambiguousEndpoints = 0;
  for (let v = 0; v < g.n; v++) {
    const unique = new Map<number, number>();
    for (const ei of incident[v]) {
      const a = other(ei, v), incoming = Math.atan2(g.y[v] - g.y[a], g.x[v] - g.x[a]), choices = [];
      for (const ej of incident[v]) if (ej !== ei) {
        const b = other(ej, v), outgoing = Math.atan2(g.y[b] - g.y[v], g.x[b] - g.x[v]);
        const turn = Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming))) * 180 / Math.PI;
        if (turn <= P.continuationDeg) choices.push(ej);
      }
      if (choices.length === 1) unique.set(ei, choices[0]); else if (choices.length > 1) ambiguousEndpoints++;
    }
    for (const [ei, ej] of unique) if (unique.get(ej) === ei) paired.set(`${ei}:${v}`, ej);
  }
  const visited = new Set<number>(), chains: Array<{ a: number; b: number; length: number; heading: number; nodes: number[] }> = [];
  let circularComponents = 0, rawChains = 0, tooShort = 0, notStraight = 0, outside = 0;
  const trace = (first: number, start: number) => {
    const nodes = [start]; let ei = first, v = start, length = 0;
    while (!visited.has(ei)) {
      visited.add(ei); length += edges[ei].length; v = other(ei, v); nodes.push(v);
      const next = paired.get(`${ei}:${v}`); if (next === undefined) break; ei = next;
    }
    rawChains++; const a = nodes[0], b = nodes.at(-1)!;
    if (a === b) { circularComponents++; observe?.({ nodes: nodes.slice(), length, reason: 'circular' }); return; }
    if (length < P.minChain) { tooShort++; observe?.({ nodes: nodes.slice(), length, reason: 'too-short' }); return; }
    if (Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]) / length < P.straightRatio) { notStraight++; observe?.({ nodes: nodes.slice(), length, reason: 'not-straight' }); return; }
    if (!nodes.every(n => g.x[n] >= region.minX && g.x[n] <= region.maxX && g.y[n] >= region.minY && g.y[n] <= region.maxY)) { outside++; observe?.({ nodes: nodes.slice(), length, reason: 'outside' }); return; }
    // Endpoint coordinate order, not node-ID order, fixes the representation.
    if (g.x[a] > g.x[b] || (g.x[a] === g.x[b] && g.y[a] > g.y[b])) nodes.reverse();
    const from = nodes[0], to = nodes.at(-1)!, heading = (Math.atan2(g.y[to] - g.y[from], g.x[to] - g.x[from]) * 180 / Math.PI + 180) % 180;
    chains.push({ a: from, b: to, length, heading, nodes });
    observe?.({ nodes: nodes.slice(), length, reason: 'selected' });
  };
  // Start at an unpaired endpoint: never consume a maximal corridor from its middle.
  for (let ei = 0; ei < edges.length; ei++) {
    if (visited.has(ei)) continue;
    const { a, b } = edges[ei];
    if (!paired.has(`${ei}:${a}`)) trace(ei, a); else if (!paired.has(`${ei}:${b}`)) trace(ei, b);
  }
  for (let ei = 0; ei < edges.length; ei++) if (!visited.has(ei)) trace(ei, edges[ei].a);
  chains.sort((a, b) => g.x[a.a] - g.x[b.a] || g.y[a.a] - g.y[b.a] || g.x[a.b] - g.x[b.b] || g.y[a.b] - g.y[b.b]);
  return { chains, params: P, diagnostics: { undirectedEdges: edges.length, visitedEdges: visited.size, rawChains, selectedChains: chains.length, circularComponents, tooShort, notStraight, outside, ambiguousEndpoints } };
}
