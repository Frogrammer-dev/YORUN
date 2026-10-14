import { expect, it } from 'vitest';
import { buildGraph, hasEdge, makeOrigin, unproject } from '@/lib/route/graph';
import { roadConnectorCycles } from '@/lib/route/roadConnectorCycles';

it('closes four long sides through short curved actual corner paths only', () => {
  const origin = makeOrigin(35, 129), xy: Array<[number, number]> = [[50, 0], [950, 0], [1000, 50], [1000, 950], [950, 1000], [50, 1000], [0, 950], [0, 50], [980, 0], [1000, 20], [1000, 980], [980, 1000], [20, 1000], [0, 980], [0, 20], [20, 0]];
  const links = [[0, 1], [2, 3], [4, 5], [6, 7], [1, 8], [8, 9], [9, 2], [3, 10], [10, 11], [11, 4], [5, 12], [12, 13], [13, 6], [7, 14], [14, 15], [15, 0]];
  const ll = xy.map(([x, y]) => unproject(origin, x, y)), g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), links.map(([a, b]) => ({ a, b, factor: 1 })), null);
  const index = (x: number, y: number) => g.nodeIndex.nearest(x, y, .01), chain = (a: [number, number], b: [number, number], heading: number) => { const from = index(...a), to = index(...b); return { a: from, b: to, nodes: [from, to], length: 900, heading }; };
  const chains = [chain([50, 0], [950, 0], 0), chain([1000, 50], [1000, 950], 90), chain([50, 1000], [950, 1000], 0), chain([0, 50], [0, 950], 90)];
  const result = roadConnectorCycles(g, chains, { minX: -1, minY: -1, maxX: 1001, maxY: 1001 });
  expect(result.diagnostics.sharedLinks).toBe(0); expect(result.diagnostics.routedLinks).toBe(4); expect(result.candidates.length).toBeGreaterThan(0);
  for (const c of result.candidates) { expect(c.usesConnector).toBe(true); expect(c.nodes[0]).toBe(c.nodes.at(-1)); expect(c.nodes.every((v, i) => !i || hasEdge(g, c.nodes[i - 1], v))).toBe(true); }
  // Removing actual curved corner edges keeps geometric intersections but forbids closure.
  const broken = { ...g, adjTo: g.adjTo.slice() };
  for (let a = 0; a < g.n; a++) for (let ei = g.adjStart[a]; ei < g.adjStart[a + 1]; ei++) {
    const b = g.adjTo[ei]; if (!chains.some(c => c.nodes.includes(a) && c.nodes.includes(b))) broken.adjTo[ei] = a;
  }
  const noBridge = roadConnectorCycles(broken, chains, { minX: -1, minY: -1, maxX: 1001, maxY: 1001 }); expect(noBridge.candidates).toHaveLength(0);
});
