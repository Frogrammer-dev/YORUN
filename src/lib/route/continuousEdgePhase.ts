import { pointSegDist, type RoadGraph } from './graph';
import { segmentRadiusInterval } from './segmentRadiusInterval';
import { continuousGuideDistance } from './continuousGuideDistance';

type XY = [number, number];
export interface ContinuousPhaseLabel { phase: number; proxyExtra: number; phaseNativeMeters: number[]; phaseActualNodes: number[][]; zeroDistancePhaseAdvances: number; }
export interface ContinuousPhaseWork { intervalTests: number; phaseChoices: number; integralCalls: number; edgePhaseEvaluations: number; earlierPhaseRetained: number; maxReachablePhase: number; phaseChoiceCapSkipped: number; }
export const CONTINUOUS_PHASE_PARAMS = { endpointPhaseCap: 4, proxyBestSlots: 2, earliestOrderedCircleHit: true, actualRouteNodeInsertion: false, analyticDeviationIntegral: true, genuineParetoDominanceClaim: false } as const;

/** 도로 선분 안의 단조 위치에서 checkpoint를 넘는다. hit 위치는 경로 node가 아니다. */
export function continuousEdgePhase(g: RoadGraph, from: number, to: number, guide: XY[], initialPhase: number, radius: number, nativeMeters: number, tol: number) {
  const last = guide.length - 1, a: XY = [g.x[from], g.y[from]], b: XY = [g.x[to], g.y[to]], physical = Math.hypot(b[0] - a[0], b[1] - a[1]), at = (t: number): XY => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  if (initialPhase < 0 || initialPhase > last || nativeMeters < 0 || tol <= 0) throw new Error('Invalid continuous edge-phase resources');
  const labels: ContinuousPhaseLabel[] = [], work: ContinuousPhaseWork = { intervalTests: 0, phaseChoices: 0, integralCalls: 0, edgePhaseEvaluations: 1, earlierPhaseRetained: 0, maxReachablePhase: initialPhase, phaseChoiceCapSkipped: 0 };
  const events: Array<{ phase: number; at: number }> = [];
  let phase = initialPhase, hit = 0;
  while (true) {
    work.phaseChoices++; const tail = Math.min(phase, last - 1), tailStart = at(hit), devA = pointSegDist(...tailStart, ...guide[tail], ...guide[tail + 1]), devB = pointSegDist(...b, ...guide[tail], ...guide[tail + 1]);
    if (devA <= radius * 2 && devB <= radius * 2) {
      const phaseNativeMeters = Array(last + 1).fill(0), phaseActualNodes = Array.from({ length: last + 1 }, () => [] as number[]); phaseActualNodes[initialPhase].push(from); phaseActualNodes[phase].push(to);
      let proxyExtra = nativeMeters, previous = 0, currentPhase = initialPhase, zeroDistancePhaseAdvances = 0, admissible = true;
      for (const event of [...events, { phase: -1, at: 1 }]) {
        const k = Math.min(currentPhase, last - 1), startPoint = at(previous), endPoint = at(event.at);
        if (pointSegDist(...startPoint, ...guide[k], ...guide[k + 1]) > radius * 2 || pointSegDist(...endPoint, ...guide[k], ...guide[k + 1]) > radius * 2) { admissible = false; break; }
        phaseNativeMeters[currentPhase] += nativeMeters * (event.at - previous);
        work.integralCalls++; proxyExtra += physical ? continuousGuideDistance(a, b, guide[k], guide[k + 1], previous, event.at) * nativeMeters / physical / tol : nativeMeters * (event.at - previous) * pointSegDist(...a, ...guide[k], ...guide[k + 1]) / tol;
        if (event.phase >= 0) { if (event.at - previous <= 1e-12) zeroDistancePhaseAdvances++; currentPhase = event.phase; }
        previous = event.at;
      }
      if (admissible && Number.isFinite(proxyExtra)) labels.push({ phase, proxyExtra, phaseNativeMeters, phaseActualNodes, zeroDistancePhaseAdvances });
    }
    if (phase === last) break;
    work.intervalTests++; const interval = segmentRadiusInterval(a, b, guide[phase + 1], radius); if (!interval) break;
    const next = Math.max(hit, interval[0]); if (next > interval[1] + 1e-12) break;
    hit = Math.min(1, next); phase++; work.maxReachablePhase = phase; events.push({ phase, at: hit });
  }
  work.earlierPhaseRetained = labels.filter(s => s.phase < work.maxReachablePhase).length;
  return { labels, work };
}

/** 원래 arc의 실제 간선을 순서대로 처리하고 종료 phase를 다양하게 보존한다. */
export function continuousArcPhase(g: RoadGraph, nodes: number[], guide: XY[], initialPhase: number, radius: number, tol: number) {
  const size = guide.length, work: ContinuousPhaseWork = { intervalTests: 0, phaseChoices: 0, integralCalls: 0, edgePhaseEvaluations: 0, earlierPhaseRetained: 0, maxReachablePhase: initialPhase, phaseChoiceCapSkipped: 0 };
  let frontier: ContinuousPhaseLabel[] = [{ phase: initialPhase, proxyExtra: 0, phaseNativeMeters: Array(size).fill(0), phaseActualNodes: Array.from({ length: size }, () => []), zeroDistancePhaseAdvances: 0 }];
  for (let i = 1; i < nodes.length && frontier.length; i++) {
    const from = nodes[i - 1], to = nodes[i]; let native = -1; for (let e = g.adjStart[from]; e < g.adjStart[from + 1]; e++) if (g.adjTo[e] === to) { native = g.adjLen[e]; break; } if (native < 0) throw new Error('Continuous phase attempted nonexistent road edge');
    const next = new Map<number, ContinuousPhaseLabel>();
    for (const prior of frontier) {
      const result = continuousEdgePhase(g, from, to, guide, prior.phase, radius, native, tol);
      for (const k of ['intervalTests', 'phaseChoices', 'integralCalls', 'edgePhaseEvaluations', 'earlierPhaseRetained'] as const) work[k] += result.work[k]; work.maxReachablePhase = Math.max(work.maxReachablePhase, result.work.maxReachablePhase);
      for (const label of result.labels) {
        const cost = prior.proxyExtra + label.proxyExtra, old = next.get(label.phase); if (old && old.proxyExtra <= cost) continue;
        next.set(label.phase, { phase: label.phase, proxyExtra: cost, phaseNativeMeters: prior.phaseNativeMeters.map((v, k) => v + label.phaseNativeMeters[k]), phaseActualNodes: prior.phaseActualNodes.map((ns, k) => [...new Set([...ns, ...label.phaseActualNodes[k]])]), zeroDistancePhaseAdvances: prior.zeroDistancePhaseAdvances + label.zeroDistancePhaseAdvances });
      }
    }
    frontier = [...next.values()];
  }
  const sorted = frontier.slice().sort((a, b) => a.proxyExtra - b.proxyExtra || a.phase - b.phase), selected = sorted.slice(0, 2), byPhase = frontier.slice().sort((a, b) => a.phase - b.phase);
  for (const label of [byPhase[0], byPhase.at(-1)]) if (label && !selected.includes(label)) selected.push(label);
  work.phaseChoiceCapSkipped = Math.max(0, frontier.length - selected.length);
  return { labels: selected.slice(0, 4), allEndpointPhasesBeforeCap: frontier.map(s => s.phase).sort((a, b) => a - b), work };
}
