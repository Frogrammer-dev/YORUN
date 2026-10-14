import type { Region } from './fit';
import type { RoadGraph } from './graph';

export interface ExactRoadPortEdge { id: number; a: number; b: number; nodes: number[]; lengthMeters: number; }
export interface ExactRoadPortSpan { edgeId: number; from: number; to: number; }
export interface ExactRoadPortGraph {
  ports: number[];
  edges: ExactRoadPortEdge[];
  degree: Int32Array;
  incident: Map<number, number[]>;
  directedLocations: Map<string, { edgeId: number; from: number; to: number }>;
  insideEdgeCount: number;
}
const directedKey = (a: number, b: number) => `${a}:${b}`;
const undirectedKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;

/** Lossless degree-two compression of the induced inside graph. Bends are retained. */
export function exactRoadPortGraph(g: RoadGraph, region: Region): ExactRoadPortGraph {
  const inside = (v: number) => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY;
  const compare = (a: number, b: number) => g.x[a] - g.x[b] || g.y[a] - g.y[b] || a - b;
  const neighbors = Array.from({ length: g.n }, () => [] as number[]), lengths = new Map<string, number>();
  for (let v = 0; v < g.n; v++) if (inside(v)) for (let j = g.adjStart[v]; j < g.adjStart[v + 1]; j++) {
    const w = g.adjTo[j]; if (!inside(w)) continue;
    const key = directedKey(v, w); if (lengths.has(key)) throw new Error('Parallel native edges require explicit multigraph identity');
    neighbors[v].push(w); lengths.set(key, g.adjLen[j]);
  }
  neighbors.forEach(ns => ns.sort(compare));
  const degree = Int32Array.from(neighbors.map(ns => ns.length)), ports = new Set<number>();
  for (let v = 0; v < g.n; v++) if (degree[v] && degree[v] !== 2) ports.add(v);
  const used = new Set<string>(), edges: ExactRoadPortEdge[] = [], directedLocations = new Map<string, { edgeId: number; from: number; to: number }>();
  const trace = (start: number, next: number) => {
    const nodes = [start, next]; used.add(undirectedKey(start, next));
    while (!ports.has(nodes.at(-1)!)) {
      const current = nodes.at(-1)!, previous = nodes.at(-2)!, onward = neighbors[current].find(v => v !== previous);
      if (onward === undefined || used.has(undirectedKey(current, onward))) break;
      used.add(undirectedKey(current, onward)); nodes.push(onward);
    }
    const id = edges.length; let lengthMeters = 0;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i], native = lengths.get(directedKey(a, b));
      if (native === undefined || Math.abs(native - lengths.get(directedKey(b, a))!) > 1e-6) throw new Error('Expected symmetric native road lengths');
      lengthMeters += native;
      directedLocations.set(directedKey(a, b), { edgeId: id, from: i - 1, to: i });
      directedLocations.set(directedKey(b, a), { edgeId: id, from: i, to: i - 1 });
    }
    edges.push({ id, a: nodes[0], b: nodes.at(-1)!, nodes, lengthMeters });
  };
  for (const v of [...ports].sort(compare)) for (const w of neighbors[v]) if (!used.has(undirectedKey(v, w))) trace(v, w);
  // Remaining components are pure degree-two cycles. Their coordinate minimum is a port.
  for (const v of Array.from({ length: g.n }, (_, i) => i).sort(compare)) for (const w of neighbors[v]) if (!used.has(undirectedKey(v, w))) { ports.add(v); trace(v, w); }
  const incident = new Map<number, number[]>();
  for (const edge of edges) for (const v of new Set([edge.a, edge.b])) incident.set(v, [...(incident.get(v) ?? []), edge.id]);
  if (directedLocations.size !== lengths.size) throw new Error('Compression lost native edges');
  return { ports: [...ports].sort(compare), edges, degree, incident, directedLocations, insideEdgeCount: used.size };
}

/** Partial spans retain an arbitrary input start node without rotating the path. */
export function encodeExactRoadPath(portGraph: ExactRoadPortGraph, nodes: number[]): ExactRoadPortSpan[] {
  const spans: ExactRoadPortSpan[] = [];
  for (let i = 1; i < nodes.length; i++) {
    const location = portGraph.directedLocations.get(directedKey(nodes[i - 1], nodes[i]));
    if (!location) throw new Error('Path contains an edge outside the induced graph');
    const previous = spans.at(-1);
    if (previous && previous.edgeId === location.edgeId && previous.to === location.from && Math.sign(previous.to - previous.from) === Math.sign(location.to - location.from)) previous.to = location.to;
    else spans.push({ ...location });
  }
  return spans;
}

export function expandExactRoadPath(portGraph: ExactRoadPortGraph, spans: ExactRoadPortSpan[]): number[] {
  const nodes: number[] = [];
  for (const span of spans) {
    const edge = portGraph.edges[span.edgeId];
    if (!edge || span.from < 0 || span.to < 0 || span.from >= edge.nodes.length || span.to >= edge.nodes.length || span.from === span.to) throw new Error('Invalid macro span');
    const part = span.from < span.to ? edge.nodes.slice(span.from, span.to + 1) : edge.nodes.slice(span.to, span.from + 1).reverse();
    if (nodes.length && nodes.at(-1) !== part[0]) throw new Error('Disconnected macro spans');
    nodes.push(...(nodes.length ? part.slice(1) : part));
  }
  return nodes;
}
