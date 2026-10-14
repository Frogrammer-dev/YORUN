import { pointSegDist, type RoadGraph } from './graph';
import { continuousArcPhase, type ContinuousPhaseWork } from './continuousEdgePhase';

export interface GuideProductArc {
  id: number;
  from: number;
  to: number;
  nodes: number[];
}

type PhaseResult = ReturnType<typeof continuousArcPhase>;
type Point = [number, number];

/** Numeric heap entries retain their distance so outdated entries can be skipped. */
class StateHeap {
  private states: number[] = [];
  private distances: number[] = [];

  push(state: number, distance: number) {
    let i = this.states.length;
    this.states.push(state);
    this.distances.push(distance);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.distances[parent] <= distance) break;
      this.states[i] = this.states[parent];
      this.distances[i] = this.distances[parent];
      i = parent;
    }
    this.states[i] = state;
    this.distances[i] = distance;
  }

  pop() {
    if (!this.states.length) return undefined;
    const state = this.states[0], distance = this.distances[0];
    const lastState = this.states.pop()!, lastDistance = this.distances.pop()!;
    if (this.states.length) {
      let i = 0;
      while (2 * i + 1 < this.states.length) {
        let child = 2 * i + 1;
        if (child + 1 < this.states.length && this.distances[child + 1] < this.distances[child]) child++;
        if (this.distances[child] >= lastDistance) break;
        this.states[i] = this.states[child];
        this.distances[i] = this.distances[child];
        i = child;
      }
      this.states[i] = lastState;
      this.distances[i] = lastDistance;
    }
    return { state, distance };
  }

  get size() { return this.states.length; }
}

/**
 * Exact shortest proxy suffix in the relaxed port × phase graph of the current
 * continuousArcPhase labels. Turn, incoming arc, length, repetition, depth and
 * immediate reversal constraints are omitted, so this is a completed-suffix
 * lower bound only. It does not imply prefix or native-Q optimality.
 *
 * The optional cache must belong to this graph, guide, radius and tolerance;
 * its arcId:initialPhase keys are the same keys used by live transitions. Setup
 * reads hits only; it does not retain the large phase arrays of cache misses.
 * Setup and reverse Dijkstra work are outside the rollout expansion budget.
 */
export function createGuideProductClosureIndex(
  g: RoadGraph,
  arcs: readonly GuideProductArc[],
  guide: Point[],
  radius: number,
  tol: number,
  phaseCache: Map<string, PhaseResult> = new Map(),
) {
  if (guide.length < 2 || guide.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
    || !Number.isFinite(radius) || radius < 0 || !Number.isFinite(tol) || tol <= 0) {
    throw new Error('Invalid guide product closure input');
  }
  const phases = guide.length, lastPhase = phases - 1;
  const ports = [...new Set(arcs.flatMap(a => [a.from, a.to]))].sort((a, b) => a - b);
  const portIndex = new Map(ports.map((node, i) => [node, i]));
  const stateCount = ports.length * phases;
  let setupOperations = 0, nativeEdgeChecks = 0, nativeAdjacencyInspections = 0;
  let cacheHits = 0, cacheMisses = 0, arcPhasePairs = 0, necessaryPrefilterSkipped = 0;
  const work: ContinuousPhaseWork = {
    intervalTests: 0, phaseChoices: 0, integralCalls: 0,
    edgePhaseEvaluations: 0, earlierPhaseRetained: 0,
    maxReachablePhase: 0, phaseChoiceCapSkipped: 0,
  };

  const validNode = (node: number) => Number.isInteger(node) && node >= 0 && node < g.n;
  for (let i = 0; i < arcs.length; i++) {
    const arc = arcs[i];
    if (arc.id !== i || arc.nodes.length < 2 || !validNode(arc.from) || !validNode(arc.to)
      || arc.nodes[0] !== arc.from || arc.nodes.at(-1) !== arc.to) {
      throw new Error('Invalid guide product arc identity or endpoints');
    }
    for (let k = 1; k < arc.nodes.length; k++) {
      const from = arc.nodes[k - 1], to = arc.nodes[k];
      if (!validNode(from) || !validNode(to)) throw new Error('Invalid guide product road node');
      let native = -1;
      for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) {
        nativeAdjacencyInspections++; setupOperations++;
        if (g.adjTo[e] === to) { native = g.adjLen[e]; break; }
      }
      if (!Number.isFinite(native) || native < 0) throw new Error('Guide product arc contains a nonexistent or invalid native road edge');
      nativeEdgeChecks++;
    }
  }

  const fromStates: number[] = [], toStates: number[] = [], costs: number[] = [], transitionArcs: number[] = [];
  const reverseStart = new Int32Array(stateCount + 1);
  for (const arc of arcs) {
    const fromPort = portIndex.get(arc.from)!, toPort = portIndex.get(arc.to)!;
    for (let phase = 0; phase < phases; phase++) {
      arcPhasePairs++; setupOperations++;
      // Every label checks the initial guide segment from the first real node,
      // including a zero-distance phase jump at t=0. This exact prerequisite
      // uses the same pointSegDist and threshold as continuousEdgePhase.
      const segment = Math.min(phase, lastPhase - 1);
      if (pointSegDist(g.x[arc.from], g.y[arc.from], ...guide[segment], ...guide[segment + 1]) > radius * 2) {
        necessaryPrefilterSkipped++; continue;
      }
      const key = `${arc.id}:${phase}`;
      let options = phaseCache.get(key);
      if (options) cacheHits++;
      else {
        options = continuousArcPhase(g, arc.nodes, guide, phase, radius, tol);
        cacheMisses++;
        for (const counter of ['intervalTests', 'phaseChoices', 'integralCalls', 'edgePhaseEvaluations', 'earlierPhaseRetained', 'phaseChoiceCapSkipped'] as const) work[counter] += options.work[counter];
        work.maxReachablePhase = Math.max(work.maxReachablePhase, options.work.maxReachablePhase);
      }
      for (const label of options.labels) {
        setupOperations++;
        if (!Number.isInteger(label.phase) || label.phase < phase || label.phase > lastPhase
          || !Number.isFinite(label.proxyExtra) || label.proxyExtra < 0) {
          throw new Error('Invalid guide product transition label');
        }
        const from = fromPort * phases + phase, to = toPort * phases + label.phase;
        fromStates.push(from); toStates.push(to); costs.push(label.proxyExtra); transitionArcs.push(arc.id);
        reverseStart[to + 1]++;
      }
    }
  }
  const transitionCount = costs.length;
  for (let i = 0; i < stateCount; i++) { reverseStart[i + 1] += reverseStart[i]; setupOperations++; }
  const fill = reverseStart.slice(0, stateCount);
  const reverseFrom = new Int32Array(transitionCount), reverseCost = new Float64Array(transitionCount), reverseArc = new Int32Array(transitionCount);
  for (let i = 0; i < transitionCount; i++) {
    const e = fill[toStates[i]]++;
    reverseFrom[e] = fromStates[i]; reverseCost[e] = costs[i]; reverseArc[e] = transitionArcs[i]; setupOperations++;
  }
  fromStates.length = 0; toStates.length = 0; costs.length = 0; transitionArcs.length = 0;

  const bounds = new Map<number, ReturnType<typeof buildStartBound>>();
  let reverseSearches = 0, reusedStartBounds = 0, reverseArcInspections = 0, reverseHeapPops = 0;
  function buildStartBound(start: number) {
    const startPort = portIndex.get(start);
    if (startPort === undefined) throw new Error('Guide product closure start is not an arc port');
    const distances = new Float64Array(stateCount).fill(Infinity);
    const successorState = new Int32Array(stateCount).fill(-1), successorArc = new Int32Array(stateCount).fill(-1);
    const target = startPort * phases + lastPhase, heap = new StateHeap();
    distances[target] = 0; heap.push(target, 0);
    let heapPops = 0, staleHeapPops = 0, arcInspections = 0, relaxations = 0, reachableStates = 0;
    while (heap.size) {
      const current = heap.pop()!; heapPops++;
      if (current.distance !== distances[current.state]) { staleHeapPops++; continue; }
      reachableStates++;
      for (let e = reverseStart[current.state]; e < reverseStart[current.state + 1]; e++) {
        arcInspections++;
        const from = reverseFrom[e], next = current.distance + reverseCost[e];
        if (next < distances[from]) {
          distances[from] = next; successorState[from] = current.state; successorArc[from] = reverseArc[e];
          relaxations++; heap.push(from, next);
        }
      }
    }
    reverseSearches++; reverseArcInspections += arcInspections; reverseHeapPops += heapPops;
    let queryCount = 0, unreachableQueries = 0;
    const stateOf = (node: number, phase: number) => {
      if (!Number.isInteger(phase) || phase < 0 || phase >= phases) throw new Error('Invalid guide product closure phase');
      const port = portIndex.get(node);
      if (port === undefined) throw new Error('Guide product closure query is not an arc port');
      return port * phases + phase;
    };
    return {
      estimate(node: number, phase: number) {
        queryCount++;
        const distance = distances[stateOf(node, phase)];
        if (!Number.isFinite(distance)) unreachableQueries++;
        return distance;
      },
      certificate(node: number, phase: number) {
        let state = stateOf(node, phase);
        if (!Number.isFinite(distances[state])) return null;
        const suffix: Array<{ arcId: number; initialPhase: number; finalPhase: number }> = [];
        for (let steps = 0; state !== target; steps++) {
          const next = successorState[state], arcId = successorArc[state];
          if (steps >= stateCount || next < 0 || arcId < 0) throw new Error('Invalid guide product suffix certificate');
          suffix.push({ arcId, initialPhase: state % phases, finalPhase: next % phases });
          state = next;
        }
        return suffix;
      },
      diagnostics: () => ({
        start, targetPhase: lastPhase, queryCount, unreachableQueries,
        reachableStates, unreachableStates: stateCount - reachableStates,
        heapPops, staleHeapPops, arcInspections, relaxations,
        onlyCompletedSuffixLowerBound: true,
        prefixOptimalityClaim: false, nativeQOptimalityClaim: false,
        setupIncludedInExpansionBudget: false,
      }),
    };
  }

  return {
    toStart(start: number) {
      const old = bounds.get(start);
      if (old) { reusedStartBounds++; return old; }
      const bound = buildStartBound(start); bounds.set(start, bound); return bound;
    },
    diagnostics: () => ({
      portCount: ports.length, phaseCount: phases, stateCount, transitionCount,
      setupOperations, nativeEdgeChecks, nativeAdjacencyInspections,
      arcPhasePairs, cacheHits, cacheMisses, necessaryPrefilterSkipped, dpWork: { ...work },
      reverseSearches, reusedStartBounds, reverseArcInspections, reverseHeapPops,
      exactCurrentSelectedLabels: true, omittedTurnHistoryAndResources: true,
      setupCacheNotPopulated: true, exactInitialSegmentNecessaryPrefilter: true,
      onlyCompletedSuffixLowerBound: true,
      prefixOptimalityClaim: false, nativeQOptimalityClaim: false,
      setupIncludedInExpansionBudget: false,
    }),
  };
}
