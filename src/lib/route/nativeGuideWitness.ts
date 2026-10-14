import { placeShape, type Placement } from './fit';
import { hasEdge, pointSegDist, type RoadGraph } from './graph';
import { polylineLength, resample, type ShapeDef } from './shapes';

type XY = [number, number];
export interface NativeGuideWitness {
  guideDistances: Float64Array;
  featureDistances: Float64Array;
}
export interface NativeWitnessState {
  phase: number;
  cost: number;
  hash: number;
  witness: NativeGuideWitness;
}
export interface NativeWitnessArc { id: number; nodes: readonly number[]; }

/** Exact fixed-pose shape-to-native-segment evidence, never a Q bound or a road. */
export function createNativeGuideWitnessIndex(g: RoadGraph, shape: ShapeDef, p: Placement, guide: XY[]) {
  const began = performance.now();
  const outline = placeShape(shape.points, p), features = placeShape(shape.features, p);
  const total = polylineLength(outline), count = Math.max(8, Math.round(total / 12));
  if (!(total > 0) || !(p.scale > 0) || guide.length < 2) throw new Error('Invalid native witness guide');
  const samples = resample(outline, count), sampleStations = samples.map((_, i) => i * total / count);
  const cumulative = (line: XY[]) => { const stations = [0]; for (let i = 1; i < line.length; i++) stations.push(stations.at(-1)! + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1])); return stations; };
  const guideStations = cumulative(guide), outlineStations = cumulative(outline);
  let stationSegmentTests = 0;
  const featureStations = features.map(([x, y]) => {
    let best = Infinity, station = 0;
    for (let i = 1; i < outline.length; i++) {
      stationSegmentTests++;
      const a = outline[i - 1], b = outline[i], dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
      const d = Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy);
      if (d < best) { best = d; station = outlineStations[i - 1] + t * (outlineStations[i] - outlineStations[i - 1]); }
    }
    return station;
  });
  if (Math.abs(guideStations.at(-1)! - total) > Math.max(1e-7, total * 1e-10)) throw new Error('Witness guide must preserve the original outline perimeter');
  const epsilon = Math.max(1e-7, total * 1e-10);
  const activeSamples = guideStations.map(station => sampleStations.flatMap((s, j) => s <= station + epsilon ? [j] : []));
  const activeFeatures = guideStations.map(station => featureStations.flatMap((s, j) => s <= station + epsilon ? [j] : []));
  const cache = new Map<number, { nodes: number[]; witness: NativeGuideWitness }>();
  const work = { setupMs: performance.now() - began, arcMs: 0, updateMs: 0, selectionMs: 0, stationSegmentTests,
    arcCacheHits: 0, arcCacheMisses: 0, nativeNodeInspections: 0, nativeEdgeChecks: 0, segmentDistanceTests: 0,
    vectorAllocations: 0, vectorAllocatedBytes: 0, minUpdates: 0, stateWitnessInstantiations: 0,
    selectionCalls: 0, selectionCandidateTests: 0, selectionVectorReads: 0, summaryCalls: 0, summaryVectorReads: 0 };
  const allocate = () => { work.vectorAllocations += 2; work.vectorAllocatedBytes += 8 * (samples.length + features.length); return { guideDistances: new Float64Array(samples.length), featureDistances: new Float64Array(features.length) }; };
  const validate = (w: NativeGuideWitness) => {
    if (w.guideDistances.length !== samples.length || w.featureDistances.length !== features.length) throw new Error('Witness belongs to another guide');
  };
  const nodeValid = (v: number) => Number.isInteger(v) && v >= 0 && v < g.n;
  const initial = (node: number): NativeGuideWitness => {
    if (!nodeValid(node)) throw new Error('Invalid witness native start');
    const at = performance.now(), w = allocate(); work.nativeNodeInspections++;
    samples.forEach(([x, y], j) => { w.guideDistances[j] = Math.hypot(x - g.x[node], y - g.y[node]); });
    features.forEach(([x, y], j) => { w.featureDistances[j] = Math.hypot(x - g.x[node], y - g.y[node]); });
    work.stateWitnessInstantiations++; work.updateMs += performance.now() - at; return w;
  };
  const arc = (a: NativeWitnessArc) => {
    const at = performance.now(), cached = cache.get(a.id);
    if (cached) {
      if (cached.nodes.length !== a.nodes.length || cached.nodes.some((v, i) => v !== a.nodes[i])) throw new Error('Witness arc identity changed');
      work.arcCacheHits++; work.arcMs += performance.now() - at; return cached.witness;
    }
    if (!Number.isInteger(a.id) || a.id < 0 || a.nodes.length < 2 || a.nodes.some(v => !nodeValid(v))) throw new Error('Invalid witness native arc');
    const w = allocate(); w.guideDistances.fill(Infinity); w.featureDistances.fill(Infinity);
    work.nativeNodeInspections += a.nodes.length;
    for (let i = 1; i < a.nodes.length; i++) {
      const from = a.nodes[i - 1], to = a.nodes[i]; work.nativeEdgeChecks++;
      if (!hasEdge(g, from, to)) throw new Error('Witness attempted nonexistent native edge');
      const ax = g.x[from], ay = g.y[from], bx = g.x[to], by = g.y[to];
      for (let j = 0; j < samples.length; j++) { work.segmentDistanceTests++; w.guideDistances[j] = Math.min(w.guideDistances[j], pointSegDist(...samples[j], ax, ay, bx, by)); }
      for (let j = 0; j < features.length; j++) { work.segmentDistanceTests++; w.featureDistances[j] = Math.min(w.featureDistances[j], pointSegDist(...features[j], ax, ay, bx, by)); }
    }
    cache.set(a.id, { nodes: [...a.nodes], witness: w }); work.arcCacheMisses++; work.arcMs += performance.now() - at; return w;
  };
  const append = (prior: NativeGuideWitness, a: NativeWitnessArc): NativeGuideWitness => {
    validate(prior); const extra = arc(a), at = performance.now(), w = allocate();
    for (let j = 0; j < samples.length; j++) { work.minUpdates++; w.guideDistances[j] = Math.min(prior.guideDistances[j], extra.guideDistances[j]); }
    for (let j = 0; j < features.length; j++) { work.minUpdates++; w.featureDistances[j] = Math.min(prior.featureDistances[j], extra.featureDistances[j]); }
    work.stateWitnessInstantiations++; work.updateMs += performance.now() - at; return w;
  };
  /** Greedy coverage diversity in fixed slots. This is not Pareto-complete pruning. */
  const diversify = <T extends NativeWitnessState>(candidates: readonly T[], prior: readonly T[], slots: number, phase: number): T[] => {
    if (!Number.isInteger(phase) || phase < 0 || phase >= guide.length) throw new Error('Invalid witness selection phase');
    const at = performance.now(); work.selectionCalls++;
    const selected = [...prior], added: T[] = [], js = activeSamples[phase], fs = activeFeatures[phase];
    const best = new Float64Array(samples.length).fill(Infinity), supported = new Uint8Array(features.length);
    work.vectorAllocations += 2; work.vectorAllocatedBytes += best.byteLength + supported.byteLength;
    const add = (s: T) => { validate(s.witness); for (const j of js) { work.selectionVectorReads++; best[j] = Math.min(best[j], s.witness.guideDistances[j]); } for (const j of fs) { work.selectionVectorReads++; if (s.witness.featureDistances[j] <= .08 * p.scale) supported[j] = 1; } };
    prior.forEach(add);
    while (added.length < slots) {
      let winner: T | undefined, winnerFeatures = -1, winnerGain = -Infinity;
      for (const s of candidates) {
        if (selected.includes(s)) continue; validate(s.witness); work.selectionCandidateTests++;
        let newFeatures = 0, gain = 0;
        for (const j of fs) { work.selectionVectorReads++; if (!supported[j] && s.witness.featureDistances[j] <= .08 * p.scale) newFeatures++; }
        for (const j of js) { work.selectionVectorReads++; const d = s.witness.guideDistances[j]; gain += Number.isFinite(best[j]) ? Math.max(0, best[j] - d) : -d; }
        if (!winner || newFeatures > winnerFeatures || newFeatures === winnerFeatures && (gain > winnerGain || gain === winnerGain && (s.cost < winner.cost || s.cost === winner.cost && s.hash < winner.hash))) { winner = s; winnerFeatures = newFeatures; winnerGain = gain; }
      }
      if (!winner) break; selected.push(winner); added.push(winner); add(winner);
    }
    work.selectionMs += performance.now() - at; return added;
  };
  return { initial, append, diversify,
    summary(w: NativeGuideWitness) { validate(w); work.summaryCalls++; work.summaryVectorReads += samples.length + features.length; return { guideToRoute: w.guideDistances.reduce((a, b) => a + b, 0) / samples.length, featureCoverage: features.length ? w.featureDistances.filter(v => v <= .08 * p.scale).length / features.length : 1, guideSamples: samples.length, features: features.length }; },
    diagnostics: () => ({ ...work, arcCacheEntries: cache.size, cacheBytes: [...cache.values()].reduce((sum, v) => sum + v.witness.guideDistances.byteLength + v.witness.featureDistances.byteLength + v.nodes.length * 8, 0), originalSampleStepMeters: 12, featureRadiusFraction: .08, actualNodeInsertion: false, originalScoreModified: false, nativeQBoundClaim: false, paretoCompleteClaim: false, includedInExpansionBudget: false }),
  };
}

export type NativeGuideWitnessIndex = ReturnType<typeof createNativeGuideWitnessIndex>;

export function selectWitnessLabels<T extends NativeWitnessState>(list: readonly T[], index: NativeGuideWitnessIndex, phase: number, enabled: boolean) {
  const ranked = [...list].sort((a, b) => a.cost - b.cost || a.hash - b.hash);
  if (!enabled) return ranked.slice(0, 4);
  const selected = ranked.slice(0, 2); return [...selected, ...index.diversify(ranked, selected, 4 - selected.length, phase)];
}

type BeamResult<T> = { selected: T[]; scored: T[]; feedbackEliteSelected: number; proxySelected: number; hashSelected: number };
export function selectWitnessBeam<T extends NativeWitnessState>(reached: T[], feedbackQ: Map<T, number>, feedback: boolean, index: NativeGuideWitnessIndex, phase: number, enabled: boolean, base: (reached: T[], feedbackQ: Map<T, number>, feedback: boolean) => BeamResult<T>) {
  const original = base(reached, feedbackQ, feedback);
  if (!enabled) return { ...original, witnessSelected: 0 };
  const fixed = original.selected.slice(0, 12), extra = index.diversify(reached, fixed, 16 - fixed.length, phase);
  return { ...original, selected: [...fixed, ...extra], hashSelected: 0, witnessSelected: extra.length };
}

export function testWitnessPrefixes<T extends NativeWitnessState>(reached: T[], index: NativeGuideWitnessIndex, phase: number, enabled: boolean, base: (reached: T[]) => { tested: T[]; control: T[]; outsideControl: number }) {
  const original = base(reached); if (!enabled) return original;
  const tested = [...reached].sort((a, b) => a.cost - b.cost || a.hash - b.hash).slice(0, 2);
  tested.push(...index.diversify(reached.filter(s => !original.control.includes(s)), tested, 4 - tested.length, phase));
  tested.push(...index.diversify(reached, tested, 4 - tested.length, phase));
  return { tested, control: original.control, outsideControl: tested.filter(s => !original.control.includes(s)).length };
}
