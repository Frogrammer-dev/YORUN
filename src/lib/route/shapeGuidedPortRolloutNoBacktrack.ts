import { continuousArcPhase, CONTINUOUS_PHASE_PARAMS } from './continuousEdgePhase';
import { evaluatePath, placeShape, toCandidate, type Placement, type Region } from './fit';
import { pointSegDist, type RoadGraph } from './graph';
import type { ShapeDef } from './shapes';
import type { ExactRoadPortGraph } from './exactRoadPortGraph';
import { pairEdgeKey, pairPhaseZero } from './pairSegmentRepair';

export const SHAPE_GUIDED_ROLLOUT_PARAMS = { poses: 8, startsPerPose: 2, radiusFraction: .16, uniformCheckpoints: 32, beam: 16, prefixCandidateCap: 64, feedbackElite: 2, proxyAndEliteSlots: 12, hashDiversitySlots: 4, labelsPerResourceKey: 4, lengthBucketMeters: 500, stages: 4, evaluatedPrefixesPerStage: 4, suffixProfiles: [30, 0], maxArcDepth: 128, caseExpansions: 400000, rolloutQCap: 512, minMeters: 3000, maxMeters: 8000, repeatMax: .2, prefixBudgetFraction: .3 } as const;
type XY = [number, number];
type Arc = { id: number; edgeId: number; from: number; to: number; nodes: number[]; meters: number; first: number; last: number };
type State = { node: number; phase: number; path: number[]; used: Map<number, number>; history: string; meters: number; repeated: number; cost: number; hash: number; first: number; last: number; zeroAdvances: number; phaseMeters: number[]; phaseNodes: number[][]; };
class Heap<T> {
  private a: Array<{ value: T; rank: number }> = [];
  push(value: T, rank: number) { const item = { value, rank }; let i = this.a.length; this.a.push(item); while (i) { const p = (i - 1) >> 1; if (this.a[p].rank <= rank) break; this.a[i] = this.a[p]; i = p; } this.a[i] = item; }
  pop() { const first = this.a[0], last = this.a.pop(); if (!first || !last) return undefined; if (this.a.length) { let i = 0; while (2 * i + 1 < this.a.length) { let j = 2 * i + 1; if (j + 1 < this.a.length && this.a[j + 1].rank < this.a[j].rank) j++; if (this.a[j].rank >= last.rank) break; this.a[i] = this.a[j]; i = j; } this.a[i] = last; } return first.value; }
  get size() { return this.a.length; }
}
const hash = (s: string, seed = 20261013) => { let h = seed >>> 0; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
const angle = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a)));

export function selectRolloutBeam<T extends { cost: number; hash: number }>(reached: T[], feedbackQ: Map<T, number>, feedback: boolean) {
  const P = SHAPE_GUIDED_ROLLOUT_PARAMS, byProxy = reached.slice().sort((a, b) => a.cost - b.cost || a.hash - b.hash), scored = [...feedbackQ.keys()].sort((a, b) => feedbackQ.get(b)! - feedbackQ.get(a)! || a.hash - b.hash), selected = feedback ? scored.slice(0, P.feedbackElite) : [];
  const feedbackEliteSelected = selected.length;
  for (const s of byProxy) if (selected.length < P.proxyAndEliteSlots && !selected.includes(s)) selected.push(s);
  const proxySelected = selected.length - feedbackEliteSelected;
  for (const s of reached.slice().sort((a, b) => a.hash - b.hash)) if (selected.length < P.beam && !selected.includes(s)) selected.push(s);
  return { selected, scored, feedbackEliteSelected, proxySelected, hashSelected: selected.length - feedbackEliteSelected - proxySelected };
}

/** proxy의 상위2개와 control beam 밖의 hash2개를 양쪽 arm에서 똑같이 평가한다. */
export function rolloutTestPrefixes<T extends { cost: number; hash: number }>(reached: T[]) {
  const control = selectRolloutBeam(reached, new Map<T, number>(), false).selected, tested = reached.slice().sort((a, b) => a.cost - b.cost || a.hash - b.hash).slice(0, 2), byHash = reached.slice().sort((a, b) => a.hash - b.hash);
  for (const s of byHash) if (tested.length < 4 && !control.includes(s) && !tested.includes(s)) tested.push(s);
  for (const s of byHash) if (tested.length < 4 && !tested.includes(s)) tested.push(s);
  return { tested, control, outsideControl: tested.filter(s => !control.includes(s)).length };
}

/** 원본 template의 꼭짓점을 보존하며 검색용 checkpoint만 추가한다. */
export function rolloutGuide(shape: ShapeDef, p: Placement): XY[] {
  const lengths = [0]; for (let i = 1; i < shape.points.length; i++) lengths.push(lengths.at(-1)! + Math.hypot(shape.points[i][0] - shape.points[i - 1][0], shape.points[i][1] - shape.points[i - 1][1]));
  const total = lengths.at(-1)!, stations = [...lengths, ...Array.from({ length: 33 }, (_, i) => total * i / 32)].sort((a, b) => a - b).filter((v, i, a) => !i || Math.abs(v - a[i - 1]) > 1e-10);
  const points = stations.map(s => { let i = 1; while (i < lengths.length - 1 && lengths[i] < s) i++; const f = (s - lengths[i - 1]) / Math.max(lengths[i] - lengths[i - 1], 1e-12), a = shape.points[i - 1], b = shape.points[i]; return [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])] as XY; });
  return placeShape(points, p);
}

/** 자동 coarse 순위를 유지하며 공간·회전의 서로 다른 strata를 우선 선택한다. */
export function rolloutPoseSeeds(seeds: Placement[], region: Region) {
  const bins = new Set<string>(), selected: Placement[] = [];
  for (const p of seeds) { const k = `${Math.min(1, Math.max(0, Math.floor((p.cx - region.minX) / (region.maxX - region.minX) * 2)))}:${Math.min(1, Math.max(0, Math.floor((p.cy - region.minY) / (region.maxY - region.minY) * 2)))}:${Math.floor(((p.rotDeg % 360 + 360) % 360) / 90)}`; if (!bins.has(k)) { bins.add(k); selected.push(p); if (selected.length === 8) break; } }
  for (const p of seeds) if (selected.length < 8 && !selected.includes(p)) selected.push(p);
  return selected;
}

/** 실제 완성 경로의 Q를 feedback할지 여부만 선택 정책에서 달리하는 독립 실험. */
export function shapeGuidedPortRolloutNoBacktrack(g: RoadGraph, pg: ExactRoadPortGraph, shape: ShapeDef, region: Region, poses: Placement[], feedback: boolean) {
  const P = SHAPE_GUIDED_ROLLOUT_PARAMS, arcs: Arc[] = [], outgoing = new Map<number, Arc[]>();
  for (const e of pg.edges) for (const nodes of [e.nodes, e.nodes.slice().reverse()]) { const a = nodes[0], b = nodes[1], z = nodes.at(-1)!, y = nodes.at(-2)!, arc = { id: arcs.length, edgeId: e.id, from: a, to: z, nodes, meters: e.lengthMeters, first: Math.atan2(g.y[b] - g.y[a], g.x[b] - g.x[a]), last: Math.atan2(g.y[z] - g.y[y], g.x[z] - g.x[y]) }; arcs.push(arc); outgoing.set(a, [...(outgoing.get(a) ?? []), arc]); }
  const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  const pool: Array<{ raw: number; candidate: ReturnType<typeof toCandidate>; nodes: number[]; provenance: { unit: number; stage: number; prefixHash: number; suffixTurnWeight: number }; zeroAdvances: number; phaseMeters: number[]; phaseDistinctNodes: number[]; nativeFeatureCoverage: number; }> = [], units = [];
  let expansions = 0, nodeInspections = 0, rolloutQCalls = 0, strictRollouts = 0, phaseAdvanceWithoutMovement = 0, belowMinRejected = 0, repeatRejected = 0, suffixFailures = 0, labelsRejected = 0, lowerBoundArcInspections = 0;
  let immediateReverseRejected = 0, actualArcAttempts = 0, emittedPhaseBranches = 0, budgetTruncatedPhaseBranches = 0, dpCacheHits = 0, dpCacheMisses = 0, dpIntervalTests = 0, dpPhaseChoices = 0, dpIntegralCalls = 0, dpPhaseCapSkipped = 0;
  const select = rolloutPoseSeeds(poses, region);
  for (let poseId = 0; poseId < select.length; poseId++) {
    const p = select[poseId], guide = rolloutGuide(shape, p), lastPhase = guide.length - 1, radius = p.scale * P.radiusFraction, tol = Math.max(20, p.scale * .06);
    if (!placeShape(shape.points, p).every(([x, y]) => inside(x, y))) continue;
    const starts = pg.ports.map(v => ({ v, d: Math.hypot(g.x[v] - guide[0][0], g.y[v] - guide[0][1]) })).filter(s => s.d <= radius).sort((a, b) => a.d - b.d || g.x[a.v] - g.x[b.v] || g.y[a.v] - g.y[b.v]).slice(0, 2);
    const phaseCache = new Map<string, ReturnType<typeof continuousArcPhase>>();
    for (let startId = 0; startId < 2; startId++) {
      const unit = poseId * 2 + startId, start = starts[startId]?.v;
      if (start === undefined) { units.push({ unit, poseId, startId, noStart: true, expansions: 0 }); continue; }
      const limit = P.caseExpansions / 16, prefixCap = Math.floor(limit * P.prefixBudgetFraction / 4), suffixCap = Math.floor(limit * (1 - P.prefixBudgetFraction) / 32);
      let usedBudget = 0, unitQ = 0, unitNodeInspections = 0, lowerBoundRejected = 0, unitZeroAdvances = 0, unitLowerBoundArcInspections = 0;
      // actual port graph native distance and hop lower bounds. No geometry shortcuts.
      const distances = new Map<number, number>([[start, 0]]), dh = new Heap<number>(); dh.push(start, 0);
      while (dh.size) { const v = dh.pop()!, d = distances.get(v)!; for (const a of outgoing.get(v) ?? []) { unitLowerBoundArcInspections++; const nd = d + a.meters; if (nd < (distances.get(a.to) ?? Infinity)) { distances.set(a.to, nd); dh.push(a.to, nd); } } }
      const hops = new Map<number, number>([[start, 0]]), queue = [start]; for (let i = 0; i < queue.length; i++) for (const a of outgoing.get(queue[i]) ?? []) { unitLowerBoundArcInspections++; if (!hops.has(a.to)) { hops.set(a.to, hops.get(queue[i])! + 1); queue.push(a.to); } }
      const searchCalls: Array<{ completion: boolean; targetPhase: number; maxPhase: number; prefixSeedPhases: number[]; nativeSeedMeters: number[]; effectiveCap: number; legacyCap: number; budgetUsedBefore: number; budgetUsedAfter: number; expanded: number; remainingBefore: number; remainingAfter: number; unusedCallCap: number; heapRemaining: number; goalResults: number; capReached: boolean }> = []; let feedbackSelectionBudgetMarker: number | null = null;
      const initial: State = { node: start, phase: 0, path: [], used: new Map(), history: '', meters: 0, repeated: 0, cost: 0, hash: hash(`${g.x[start]},${g.y[start]}`), first: 0, last: 0, zeroAdvances: 0, phaseMeters: Array(lastPhase + 1).fill(0), phaseNodes: Array.from({ length: lastPhase + 1 }, () => []) };
      let beam = [initial]; const stages = [];
      const transition = (s: State, a: Arc, turnWeight: number): State[] => {
        if (usedBudget >= limit || s.path.length >= P.maxArcDepth) return []; actualArcAttempts++;
        const spendOne = () => { usedBudget++; expansions++; };
        const previousArc = s.path.at(-1);
        if (previousArc !== undefined && a.edgeId === arcs[previousArc].edgeId && a.id !== previousArc) { spendOne(); immediateReverseRejected++; return []; }
        const meters = s.meters + a.meters, repeated = s.repeated + (s.used.has(a.edgeId) ? a.meters : 0);
        if (meters > 8000 || repeated / 8000 > .2) { spendOne(); return []; }
        if (meters + (distances.get(a.to) ?? Infinity) > 8000 || s.path.length + 1 + (hops.get(a.to) ?? Infinity) > P.maxArcDepth) { lowerBoundRejected++; spendOne(); return []; }
        const cacheKey = `${a.id}:${s.phase}`; let options = phaseCache.get(cacheKey);
        if (options) dpCacheHits++; else {
          options = continuousArcPhase(g, a.nodes, guide, s.phase, radius, tol); phaseCache.set(cacheKey, options); dpCacheMisses++;
          dpIntervalTests += options.work.intervalTests; dpPhaseChoices += options.work.phaseChoices; dpIntegralCalls += options.work.integralCalls; dpPhaseCapSkipped += options.work.phaseChoiceCapSkipped;
          nodeInspections += options.work.edgePhaseEvaluations; unitNodeInspections += options.work.edgePhaseEvaluations;
        }
        if (!options.labels.length) { spendOne(); return []; }
        let internalTurn = 0; for (let i = 1; i < a.nodes.length - 1; i++) { const u = a.nodes[i - 1], v = a.nodes[i], w = a.nodes[i + 1]; internalTurn += angle(Math.atan2(g.y[v] - g.y[u], g.x[v] - g.x[u]), Math.atan2(g.y[w] - g.y[v], g.x[w] - g.x[v])); }
        const physicalTurn = internalTurn + (s.path.length ? angle(s.last, a.first) : 0), states: State[] = [];
        for (let i = 0; i < options.labels.length; i++) {
          if (usedBudget >= limit) { budgetTruncatedPhaseBranches += options.labels.length - i; break; } spendOne(); emittedPhaseBranches++;
          const label = options.labels[i], used = new Map(s.used); used.set(a.edgeId, (used.get(a.edgeId) ?? 0) + 1);
          const t: State = { ...s, node: a.to, phase: label.phase, path: [...s.path, a.id], used, meters, repeated, hash: hash(`${a.from}:${a.to}:${a.edgeId}:${label.phase}`, s.hash), history: [...used].sort((a, b) => a[0] - b[0]).map(([e, n]) => `${e}:${n}`).join(","), first: s.path.length ? s.first : a.first, last: a.last, zeroAdvances: s.zeroAdvances + label.zeroDistancePhaseAdvances, cost: s.cost + (label.proxyExtra + turnWeight * physicalTurn) / Math.max(p.scale, 1), phaseMeters: s.phaseMeters.map((v, k) => v + label.phaseNativeMeters[k]), phaseNodes: s.phaseNodes.map((ns, k) => [...new Set([...ns, ...label.phaseActualNodes[k]])]) };
          unitZeroAdvances += label.zeroDistancePhaseAdvances; states.push(t);
        }
        return states;
      };
      const search = (seeds: State[], targetPhase: number, cap: number, turnWeight: number, completion: boolean) => {
        const remainingAtStart = limit - usedBudget, effectiveCap = remainingAtStart; let maxPoppedPhase = -1;
        const heap = new Heap<State>(), labels = new Map<string, State[]>(), results: State[] = [], began = usedBudget;
        const keep = (s: State) => { const incoming = s.path.at(-1) ?? -1, key = `${incoming}:${s.phase}:${Math.floor(s.meters / 500)}`, list = labels.get(key) ?? []; if (list.some(t => t.history === s.history && t.cost <= s.cost)) { labelsRejected++; return; } list.push(s); list.sort((a, b) => a.cost - b.cost || a.hash - b.hash); if (list.length > 4) list.pop(); labels.set(key, list); if (list.includes(s)) heap.push(s, s.cost); else labelsRejected++; };
        seeds.forEach(keep);
        while (heap.size && usedBudget - began < effectiveCap && usedBudget < limit) {
          const s = heap.pop()!, incoming = s.path.at(-1) ?? -1, key = `${incoming}:${s.phase}:${Math.floor(s.meters / 500)}`; if (!labels.get(key)?.includes(s)) continue;
          maxPoppedPhase = Math.max(maxPoppedPhase, s.phase);
          if (completion && s.phase === lastPhase && s.node === start && s.meters < 3000) belowMinRejected++;
          if (completion && s.phase === lastPhase && s.node === start && s.meters >= 3000 && s.repeated / s.meters > .2) repeatRejected++;
          if ((!completion && s.phase >= targetPhase) || (completion && s.phase === lastPhase && s.node === start && s.meters >= 3000 && s.repeated / s.meters <= .2)) { results.push(s); if (results.length >= (completion ? 1 : P.prefixCandidateCap)) break; if (!completion) continue; }
          for (const a of outgoing.get(s.node) ?? []) { if (usedBudget - began >= effectiveCap || usedBudget >= limit) break; for (const t of transition(s, a, turnWeight)) keep(t); }
        }
        searchCalls.push({ completion, targetPhase, maxPhase: maxPoppedPhase, prefixSeedPhases: seeds.map(s => s.phase), nativeSeedMeters: seeds.map(s => s.meters), effectiveCap, legacyCap: cap, budgetUsedBefore: began, budgetUsedAfter: usedBudget, expanded: usedBudget - began, remainingBefore: remainingAtStart, remainingAfter: limit - usedBudget, unusedCallCap: effectiveCap - (usedBudget - began), heapRemaining: heap.size, goalResults: results.length, capReached: usedBudget - began >= effectiveCap });
        return results;
      };
      for (let stage = 1; stage <= 4 && beam.length && usedBudget < limit; stage++) {
        const reached = search(beam, Math.ceil(lastPhase * stage / 4), prefixCap, 30, false), { tested, outsideControl } = rolloutTestPrefixes(reached);
        const feedbackQ = new Map<State, number>(); let evaluated = 0;
        for (const prefix of tested) for (const turnWeight of P.suffixProfiles) {
          const goals = search([prefix], lastPhase, suffixCap, turnWeight, true); if (!goals.length) { suffixFailures++; continue; }
          const goal = goals[0]; if (goal.meters < 3000) { belowMinRejected++; continue; } if (goal.repeated / goal.meters > .2) { repeatRejected++; continue; }
          const nodes = goal.path.flatMap((id, i) => i ? arcs[id].nodes.slice(1) : arcs[id].nodes.slice());
          if (nodes.length < 4 || nodes[0] !== nodes.at(-1)) continue;
          if (unitQ >= 32 || rolloutQCalls >= 512) continue;
          const canonical = pairPhaseZero(g, shape, p, nodes), e = evaluatePath(g, shape, p, canonical, 3000, 8000); unitQ++; rolloutQCalls++; evaluated++;
          if (e.lengthMeters < 3000 || e.lengthMeters > 8000 || e.repeatRatio > .2) continue;
          const raw = 100 * Math.exp(-e.meanDev / (.08 * p.scale) - Math.log1p(.03 * e.zigzagPerKm) + Math.log(.55 + .45 * e.featureCoverage) + e.spikes * Math.log(.9)); strictRollouts++;
          feedbackQ.set(prefix, Math.max(feedbackQ.get(prefix) ?? -Infinity, raw));
          pool.push({ raw, candidate: toCandidate(g, shape, p, e), nodes: canonical, provenance: { unit, stage, prefixHash: prefix.hash, suffixTurnWeight: turnWeight }, zeroAdvances: goal.zeroAdvances, phaseMeters: goal.phaseMeters, phaseDistinctNodes: goal.phaseNodes.map(ns => ns.length), nativeFeatureCoverage: e.featureCoverage });
        }
        const { selected, scored, feedbackEliteSelected, proxySelected, hashSelected } = selectRolloutBeam(reached, feedbackQ, feedback);
        if (feedback && feedbackEliteSelected > 0 && feedbackSelectionBudgetMarker === null) feedbackSelectionBudgetMarker = usedBudget;
        stages.push({ stage, reached: reached.length, evaluatedPrefixes: tested.length, testedOutsideControl: outsideControl, testedPrefixHashes: tested.map(s => s.hash), wholeQCalls: evaluated, feedbackScoredPrefixes: feedbackQ.size, feedbackEliteSelected, proxySelected, hashSelected, retainedFeedbackPrefixes: selected.filter(s => feedbackQ.has(s)).length, evaluatedPrefixScores: scored.map(s => ({ hash: s.hash, raw: feedbackQ.get(s)! })), selectedPrefixHashes: selected.map(s => s.hash), selectedPhases: selected.map(s => s.phase) }); beam = selected;
      }
      phaseAdvanceWithoutMovement += unitZeroAdvances; lowerBoundArcInspections += unitLowerBoundArcInspections; units.push({ unit, poseId, startId, start, noStart: false, expansions: usedBudget, rolloutQCalls: unitQ, nodeInspections: unitNodeInspections, lowerBoundArcInspections: unitLowerBoundArcInspections, lowerBoundRejected, phaseAdvanceWithoutMovement: unitZeroAdvances, stages, searchCalls, unusedUnitBudget: limit - usedBudget, afterFeedbackExpansions: feedbackSelectionBudgetMarker === null ? 0 : usedBudget - feedbackSelectionBudgetMarker });
    }
  }
  const distinct = new Map<string, typeof pool[number]>(); for (const c of pool) { const k = pairEdgeKey(c.nodes); if (!distinct.has(k) || c.raw > distinct.get(k)!.raw) distinct.set(k, c); }
  return { params: { ...P, scheduling: 'remaining-unit' as const, callCapIsRemainingUnitBudget: true, actualWorkEqualAcrossArms: false, continuousPhase: CONTINUOUS_PHASE_PARAMS, transitionBudgetCountsReturnedPhaseBranches: true, immediateMacroReverseExcluded: true }, feedback, selectedPoses: select, pool: [...distinct.values()].sort((a, b) => b.raw - a.raw).slice(0, 16), diagnostics: { expansions, nodeInspections, nodeInspectionsCountsEdgePhaseEvaluations: true, actualArcAttempts, immediateReverseRejected, emittedPhaseBranches, budgetTruncatedPhaseBranches, dpCacheHits, dpCacheMisses, dpIntervalTests, dpPhaseChoices, dpIntegralCalls, dpPhaseCapSkipped, lowerBoundArcInspections, lowerBoundSetupIncludedInExpansionBudget: false, rolloutQCalls, strictRollouts, uniqueGeometries: distinct.size, phaseAdvanceWithoutMovement, belowMinRejected, repeatRejected, suffixFailures, labelsRejected, zeroPhaseAdvanceIsWeakFallback: true, noPhaseCoverageClaim: true, units } };
}
