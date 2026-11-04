import { pointSegDist, type RoadGraph } from './graph';
import type { Region } from './fit';

/** Undirected identity: reversing a feature boundary cannot evade exclusion. */
export const boundaryEdgeKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
export interface BoundaryBudget { expanded: number; maxExpanded: number; deadlineMs: number }
export interface BoundaryOptions {
  region: Region;
  forbiddenNodes?: ReadonlySet<number>;
  forbiddenEdges?: ReadonlySet<string>;
  maxExpanded: number;
  guide?: { a: readonly [number, number]; b: readonly [number, number]; tolerance: number; weight: number };
  now?: () => number;
}
export interface BoundaryRoute {
  path: number[] | null;
  expanded: number;
  reason: 'connected' | 'invalid_endpoint' | 'blocked_endpoint' | 'budget' | 'expansion_limit' | 'disconnected';
}

/** Dijkstra over actual CSR edges only. No heuristic assumes projected/native
 * costs are equal. Exclusions are hard constraints, not retracing penalties.
 * This builds a boundary segment; final closed-route validity is a separate audit.
 */
export function routeBoundarySegment(g: RoadGraph, start: number, goal: number, options: BoundaryOptions, budget: BoundaryBudget): BoundaryRoute {
  const { region, forbiddenNodes, forbiddenEdges, guide } = options;
  const now = options.now ?? (() => performance.now());
  if (!Number.isInteger(options.maxExpanded) || options.maxExpanded < 1 || !Number.isInteger(budget.maxExpanded) || budget.maxExpanded < 1
    || !Number.isInteger(budget.expanded) || budget.expanded < 0 || !Number.isFinite(budget.deadlineMs)) throw new Error('Invalid boundary search budget');
  if ([region.minX, region.minY, region.maxX, region.maxY].some(n => !Number.isFinite(n)) || region.minX > region.maxX || region.minY > region.maxY) throw new Error('Invalid boundary region');
  if (guide && (guide.a.some(n => !Number.isFinite(n)) || guide.b.some(n => !Number.isFinite(n)) || !Number.isFinite(guide.tolerance)
    || guide.tolerance <= 0 || !Number.isFinite(guide.weight) || guide.weight < 0)) throw new Error('Invalid boundary guide');
  let expanded = 0;
  const result = (path: number[] | null, reason: BoundaryRoute['reason']): BoundaryRoute => ({ path, expanded, reason });
  const inside = (v: number) => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY;
  if (![start, goal].every(v => Number.isInteger(v) && v >= 0 && v < g.n)) return result(null, 'invalid_endpoint');
  if (!inside(start) || !inside(goal) || forbiddenNodes?.has(start) || forbiddenNodes?.has(goal)) return result(null, 'blocked_endpoint');
  const distance = new Float64Array(g.n).fill(Infinity), previous = new Int32Array(g.n).fill(-1);
  const heap: Array<{ node: number; cost: number }> = [];
  const push = (node: number, cost: number) => {
    let i = heap.length; heap.push({ node, cost });
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].cost <= cost) break; heap[i] = heap[p]; i = p; }
    heap[i] = { node, cost };
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let c = 2 * i + 1; if (c + 1 < heap.length && heap[c + 1].cost < heap[c].cost) c++;
        if (heap[c].cost >= last.cost) break; heap[i] = heap[c]; i = c;
      }
      heap[i] = last;
    }
    return first;
  };
  distance[start] = 0; push(start, 0);
  while (heap.length) {
    if (budget.expanded >= budget.maxExpanded || now() >= budget.deadlineMs) return result(null, 'budget');
    const { node: u, cost } = pop();
    if (cost !== distance[u]) continue;
    if (u === goal) {
      const path: number[] = [];
      for (let v = u; v !== -1; v = previous[v]) path.push(v);
      return result(path.reverse(), 'connected');
    }
    if (expanded >= options.maxExpanded) return result(null, 'expansion_limit');
    expanded++; budget.expanded++;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const v = g.adjTo[k];
      if (!inside(v) || forbiddenNodes?.has(v) || forbiddenEdges?.has(boundaryEdgeKey(u, v))) continue;
      let edgeCost = g.adjCost[k];
      if (!Number.isFinite(edgeCost) || edgeCost < 0) throw new Error('Invalid native road cost');
      if (guide) {
        const deviation = pointSegDist((g.x[u] + g.x[v]) / 2, (g.y[u] + g.y[v]) / 2, ...guide.a, ...guide.b) / guide.tolerance;
        edgeCost *= 1 + guide.weight * deviation ** 2;
      }
      const next = cost + edgeCost;
      if (!Number.isFinite(next)) throw new Error('Nonfinite guided road cost');
      if (next < distance[v]) { distance[v] = next; previous[v] = u; push(v, next); }
    }
  }
  return result(null, 'disconnected');
}
