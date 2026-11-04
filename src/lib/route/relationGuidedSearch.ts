import { evaluatePath, placeShape, type Evaluated, type Placement, type Region } from './fit';
import { hasEdge, pointSegDist, type RoadGraph } from './graph';
import { resample, type ShapeDef } from './shapes';
import { pairEdgeKey, pairPhaseZero } from './pairSegmentRepair';

type XY = [number, number];
const BINS = 48;
export interface RelationSearchOptions {
  mode: 'uniform' | 'relation';
  maxProposals?: number;
  maxExpanded?: number;
  minMeters?: number;
  maxMeters?: number;
  checkpoints?: number[];
}
export interface RelationDiagnostics {
  /** All errors are in original shape scale units; not semantic confidence. */
  meanOrderedError: number;
  worstSegmentError: number;
  missingFeatureFraction: number;
  objective: number;
  relationObjective: number;
}
export interface RelationSearchResult {
  evaluated: Evaluated;
  diagnostics: RelationDiagnostics;
  initialDiagnostics: RelationDiagnostics;
  attempts: number;
  evaluatedCandidates: number;
  acceptedRepairs: number;
  expanded: number;
  history: Array<{ proposal: number; objective: number; relationObjective: number }>;
  checkpoints: Array<{ proposals: number; evaluated: Evaluated; diagnostics: RelationDiagnostics; expanded: number; evaluatedCandidates: number; acceptedRepairs: number }>;
}

/** Exactly the existing fit objective, without changing fit.ts or the shape bank. */
export function relationOriginalObjective(e: Evaluated, p: Placement): number {
  return e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm)
    - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
}

function correspondence(g: RoadGraph, shape: ShapeDef, p: Placement, path: number[]) {
  const xy = path.map(v => [g.x[v], g.y[v]] as XY);
  const route = resample(xy, BINS).slice(0, BINS);
  const outline = placeShape(resample(shape.points, BINS), p).slice(0, BINS);
  let best = Infinity, shift = 0, direction = 1;
  for (const dir of [1, -1]) for (let offset = 0; offset < BINS; offset++) {
    let error = 0;
    for (let i = 0; i < BINS; i++) {
      const q = outline[(offset + dir * i + BINS * 2) % BINS];
      error += (route[i][0] - q[0]) ** 2 + (route[i][1] - q[1]) ** 2;
    }
    if (error < best) { best = error; shift = offset; direction = dir; }
  }
  const aligned = route.map((_, i) => outline[(shift + direction * i + BINS * 2) % BINS]);
  const errors = route.map((q, i) => Math.hypot(q[0] - aligned[i][0], q[1] - aligned[i][1]) / p.scale);
  const cumulative = [0];
  for (let i = 1; i < xy.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const length = cumulative.at(-1)!;
  const nodeIndices = route.map((_, bin) => {
    const target = bin / BINS * length;
    let k = 0;
    while (k + 1 < cumulative.length && cumulative[k + 1] <= target) k++;
    if (k + 1 < cumulative.length && cumulative[k + 1] - target < target - cumulative[k]) k++;
    return Math.min(k, path.length - 2);
  });
  return { aligned, errors, nodeIndices };
}

function describe(e: Evaluated, p: Placement, errors: number[]): RelationDiagnostics {
  const meanOrderedError = errors.reduce((s, d) => s + d, 0) / errors.length;
  let worstSegmentError = 0;
  for (let i = 0; i < BINS; i++) {
    let sum = 0;
    for (let j = 0; j < 6; j++) sum += errors[(i + j) % BINS];
    worstSegmentError = Math.max(worstSegmentError, sum / 6);
  }
  const objective = relationOriginalObjective(e, p), missingFeatureFraction = 1 - e.featureCoverage;
  return { meanOrderedError, worstSegmentError, missingFeatureFraction, objective,
    relationObjective: objective + 1.5 * worstSegmentError + .5 * meanOrderedError + .25 * missingFeatureFraction };
}

/** Independent fixed-pose diagnostics for experiment baselines. */
export function relationDiagnostics(g: RoadGraph, shape: ShapeDef, placement: Placement, path: number[], minMeters = 3000, maxMeters = 8000): RelationDiagnostics {
  return describe(evaluatePath(g, shape, placement, path, minMeters, maxMeters), placement,
    correspondence(g, shape, placement, path).errors);
}

/** Phase-ordered local road search. Advancing a phase never adds geometry.
 * Unlike a nearest-outline cost alone, a road segment cannot skip directly from
 * one nearby body/ear portion to a different contour portion without visiting
 * their intervening waypoint neighbourhoods in cyclic order.
 */
function reconnect(g: RoadGraph, start: number, goal: number, guide: XY[], allowed: Uint8Array,
  forbidden: Set<number>, scale: number, weight: number, maxExpanded: number) {
  const phases = guide.length, total = phases * g.n;
  const costs = new Float64Array(total); costs.fill(Infinity);
  const prev = new Int32Array(total); prev.fill(-1);
  const heap: Array<[number, number]> = [];
  const push = (state: number, cost: number) => {
    let i = heap.length; heap.push([state, cost]);
    while (i) { const parent = (i - 1) >> 1; if (heap[parent][1] <= cost) break; heap[i] = heap[parent]; i = parent; }
    heap[i] = [state, cost];
  };
  const pop = () => {
    const first = heap[0], last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1][1] < heap[child][1]) child++;
        if (heap[child][1] >= last[1]) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  };
  const update = (state: number, parent: number, cost: number) => {
    if (cost < costs[state]) { costs[state] = cost; prev[state] = parent; push(state, cost); }
  };
  costs[start] = 0; push(start, 0);
  const radius = Math.max(35, scale * .10), tolerance = Math.max(25, scale * .06);
  let expanded = 0, end = -1;
  while (heap.length && expanded < maxExpanded) {
    const [state, cost] = pop(); if (cost !== costs[state]) continue;
    expanded++;
    const phase = Math.floor(state / g.n), node = state % g.n;
    if (phase === phases - 1 && node === goal) { end = state; break; }
    if (phase < phases - 1) {
      const target = guide[phase + 1], d = Math.hypot(g.x[node] - target[0], g.y[node] - target[1]);
      if (d <= radius) update((phase + 1) * g.n + node, state, cost + weight * d);
    }
    const a = guide[Math.min(phase, phases - 2)], b = guide[Math.min(phase + 1, phases - 1)];
    const before = prev[state] >= 0 ? prev[state] % g.n : -1;
    for (let edge = g.adjStart[node]; edge < g.adjStart[node + 1]; edge++) {
      const v = g.adjTo[edge];
      if (!allowed[v] || forbidden.has(v) || v === before || (v === start && node !== start)) continue;
      // Compressed road edges may cross several contour samples between nodes.
      // Advance only through ordered samples lying near this actual edge.
      let after = phase, lastProjection = -1e-9;
      const dx = g.x[v] - g.x[node], dy = g.y[v] - g.y[node], norm = dx * dx + dy * dy;
      while (after < phases - 1) {
        const target = guide[after + 1];
        const projection = ((target[0] - g.x[node]) * dx + (target[1] - g.y[node]) * dy) / (norm || 1);
        if (projection < lastProjection || projection < 0 || projection > 1
          || pointSegDist(...target, g.x[node], g.y[node], g.x[v], g.y[v]) > radius) break;
        lastProjection = projection; after++;
      }
      const segmentA = after > phase ? guide[Math.min(after, phases - 2)] : a;
      const segmentB = after > phase ? guide[Math.min(after + 1, phases - 1)] : b;
      const d = pointSegDist(g.x[v], g.y[v], ...segmentA, ...segmentB);
      if (d > scale * .45) continue;
      update(after * g.n + v, state, cost + g.adjLen[edge] * (1 + weight * d / tolerance));
    }
  }
  if (end < 0) return { path: null, expanded };
  const path: number[] = [];
  for (let s = end; s >= 0; s = prev[s]) { const node = s % g.n; if (path.at(-1) !== node) path.push(node); }
  return { path: path.reverse(), expanded };
}

/** Experimental geometric relation-guided generator; not an anatomy or semantic model.
 * Both arms share correspondence, road search, proposal count and expansion cap.
 * Relation chooses the worst ordered windows; uniform schedules windows evenly.
 * An unchanged valid seed is retained, and the returned original objective cannot
 * regress. Every accepted/generated result is native-road closed and in the ROI.
 */
export function relationGuidedSearch(g: RoadGraph, shape: ShapeDef, placement: Placement,
  input: number[], region: Region, options: RelationSearchOptions): RelationSearchResult | null {
  const { mode, maxProposals = 32, maxExpanded = 12000, minMeters = 3000, maxMeters = 8000 } = options;
  if (!Number.isFinite(placement.scale) || placement.scale <= 0 || !Number.isFinite(maxProposals)
    || maxProposals < 0 || !Number.isFinite(maxExpanded) || maxExpanded < 0
    || !Number.isFinite(minMeters) || !Number.isFinite(maxMeters) || minMeters < 0 || maxMeters < minMeters) return null;
  const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  if (!placeShape(shape.points, placement).every(([x, y]) => inside(x, y))) return null;
  const allowed = new Uint8Array(g.n);
  for (let v = 0; v < g.n; v++) allowed[v] = +inside(g.x[v], g.y[v]);
  const valid = (path: number[]) => path.length >= 4 && path[0] === path.at(-1)
    && path.every((v, i) => Number.isInteger(v) && v >= 0 && v < g.n && allowed[v] && (!i || hasEdge(g, path[i - 1], v)));
  if (!valid(input)) return null;
  const feasible = (e: Evaluated) => {
    if (e.lengthMeters < minMeters || e.lengthMeters > maxMeters || e.repeatRatio > .2) return false;
    let meters = 0, repeated = 0;
    const seen = new Set<string>();
    for (let i = 1; i < e.path.length; i++) {
      const a = e.path[i - 1], b = e.path[i], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      let length = NaN;
      for (let edge = g.adjStart[a]; edge < g.adjStart[a + 1]; edge++) if (g.adjTo[edge] === b) { length = g.adjLen[edge]; break; }
      if (!Number.isFinite(length) || length < 0) return false;
      meters += length; if (seen.has(key)) repeated += length; seen.add(key);
    }
    return meters >= minMeters && meters <= maxMeters && repeated / meters <= .2;
  };
  const initial = evaluatePath(g, shape, placement, input, minMeters, maxMeters);
  if (!feasible(initial)) return null;
  let current = initial, best = initial;
  let matched = correspondence(g, shape, placement, current.path), diagnostics = describe(current, placement, matched.errors);
  const initialDiagnostics = { ...diagnostics };
  const canonical = evaluatePath(g, shape, placement, pairPhaseZero(g, shape, placement, input), minMeters, maxMeters);
  const threshold = Math.min(initialDiagnostics.objective, relationOriginalObjective(canonical, placement));
  const inputKey = pairEdgeKey(input);
  let bestDiagnostics = { ...diagnostics }, attempts = 0, evaluatedCandidates = 0, acceptedRepairs = 0, expanded = 0;
  const history: RelationSearchResult['history'] = [{ proposal: 0, objective: diagnostics.objective, relationObjective: diagnostics.relationObjective }];
  const checkpoints: RelationSearchResult['checkpoints'] = [];
  const recordCheckpoint = () => {
    if (options.checkpoints?.includes(attempts) && !checkpoints.some(c => c.proposals === attempts))
      checkpoints.push({ proposals: attempts, evaluated: { ...best, fit: placement }, diagnostics: { ...bestDiagnostics }, expanded, evaluatedCandidates, acceptedRepairs });
  };
  const tried = new Set<string>();
  while (attempts < Math.floor(maxProposals)) {
    recordCheckpoint();
    const windows: Array<{ start: number; width: number; error: number }> = [];
    // Interleave short and long windows; both arms have the same proposal universe.
    for (const width of [6, 12, 20]) for (let start = 0; start < BINS; start += 2) {
      let error = 0; for (let j = 0; j <= width; j++) error += matched.errors[(start + j) % BINS];
      windows.push({ start, width, error: error / (width + 1) });
    }
    if (mode === 'relation') windows.sort((a, b) => b.error - a.error || a.width - b.width || a.start - b.start);
    // Multiplication by 7 visits separated contour locations before neighbouring bins.
    else windows.sort((a, b) => ((a.start / 2 * 7) % 24) - ((b.start / 2 * 7) % 24) || a.width - b.width);
    let proposal: { rotated: number[]; right: number; guide: XY[]; key: string; weight: number } | null = null;
    const loop = current.path.slice(0, -1);
    for (const w of windows) {
      const left = matched.nodeIndices[w.start], end = matched.nodeIndices[(w.start + w.width) % BINS];
      const count = (end - left + loop.length) % loop.length;
      if (count < 2 || count >= loop.length - 1) continue;
      const rotated = [...loop.slice(left), ...loop.slice(0, left), loop[left]];
      for (const weight of [1.5, 4, 8]) {
        const key = `${current.path.join(',')}|${w.start}:${w.width}:${weight}`;
        if (tried.has(key)) continue;
        tried.add(key);
        const guide = Array.from({ length: w.width + 1 }, (_, j) => matched.aligned[(w.start + j) % BINS]);
        // Exact road endpoints are appended to the immutable contour guide.
        proposal = { rotated, right: count, guide: [[g.x[rotated[0]], g.y[rotated[0]]], ...guide, [g.x[rotated[count]], g.y[rotated[count]]]], key, weight };
        break;
      }
      if (proposal) break;
    }
    if (!proposal) break;
    attempts++;
    const { rotated, right, guide, weight } = proposal;
    const forbidden = new Set(rotated.slice(right + 1, -1));
    const replacement = reconnect(g, rotated[0], rotated[right], guide, allowed, forbidden, placement.scale, weight, Math.floor(maxExpanded));
    expanded += replacement.expanded;
    if (!replacement.path) continue;
    const path = pairPhaseZero(g, shape, placement, [...replacement.path, ...rotated.slice(right + 1)]);
    if (!valid(path)) continue;
    if (pairEdgeKey(path) === inputKey || pairEdgeKey(path) === pairEdgeKey(current.path)) continue;
    const candidate = evaluatePath(g, shape, placement, path, minMeters, maxMeters); evaluatedCandidates++;
    if (!feasible(candidate)) continue;
    const nextMatch = correspondence(g, shape, placement, path), next = describe(candidate, placement, nextMatch.errors);
    if (next.objective < Math.min(bestDiagnostics.objective, threshold) - 1e-9) { best = candidate; bestDiagnostics = next; }
    const improves = mode === 'relation' ? next.relationObjective < diagnostics.relationObjective - 1e-9 : next.objective < diagnostics.objective - 1e-9;
    if (improves && next.objective <= threshold + 1e-9) {
      current = candidate; matched = nextMatch; diagnostics = next; acceptedRepairs++;
      history.push({ proposal: attempts, objective: next.objective, relationObjective: next.relationObjective });
    }
  }
  recordCheckpoint();
  return { evaluated: { ...best, fit: placement }, diagnostics: bestDiagnostics, initialDiagnostics,
    attempts, evaluatedCandidates, acceptedRepairs, expanded, history, checkpoints };
}
