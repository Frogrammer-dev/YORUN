import { evaluatePath, placeShape, toCandidate, type Placement, type Region, type RouteCandidate } from './fit';
import { hasEdge, type RoadGraph } from './graph';
import { buildBlocks, traceUnion, unionForPlacement } from './loops';
import { pairEdgeKey, pairPhaseZero } from './pairSegmentRepair';
import type { ShapeDef } from './shapes';

export interface FacePopulationOptions { maxStates?: number; populationSize?: number; maxPoses?: number; seed?: number; coldParents?: RouteCandidate[]; maxColdParents?: number; reservoirSlots?: number; }

/** Independent coarse-pose population, not a neighborhood of a saved best path.
 * The state includes both a real-face union and a uniform template placement.
 * Nonlocal double flips, connected patches, donor-parent patches, and joint
 * pose/face mutations explore intermediate populations under the original Q.
 */
export function facePopulationSearch(g: RoadGraph, shape: ShapeDef, region: Region, coarsePoses: Placement[], incumbent: RouteCandidate, options: FacePopulationOptions = {}, minMeters = 3000, maxMeters = 8000) {
  const { maxStates = 500, populationSize = 12, maxPoses = 12, seed = 0xFACE2026, coldParents = [], maxColdParents = 8, reservoirSlots = 0 } = options;
  let rng = seed >>> 0 || 1;
  const random = () => { rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5; return (rng >>> 0) / 4294967296; };
  const rejections = { poseOutsideOrInvalidScale: 0, initialUnionNull: 0, traceFailed: 0, pathInvalid: 0, tooShort: 0, tooLong: 0, repeated: 0 };
  const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  const poseValid = (p: Placement) => p.scale > 0 && placeShape(shape.points, p).every(([x, y]) => inside(x, y));
  const m = buildBlocks(g, (region.maxX - region.minX) * (region.maxY - region.minY) / 4);
  const eligible = m.faces.map(f => inside(f.minX, f.minY) && inside(f.maxX, f.maxY));
  const neighbors = m.faces.map(f => [...new Set(f.hes.map(h => m.heFace[h ^ 1]).filter(v => v >= 0 && eligible[v]))]);
  const index = new Map<string, number[]>();
  for (let v = 0; v < g.n; v++) { const key = `${g.lat[v].toFixed(7)},${g.lon[v].toFixed(7)}`; index.set(key, [...(index.get(key) ?? []), v]); }
  const input = incumbent.latlngs.map(([lat, lon]) => { const values = index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`); return values?.length === 1 ? values[0] : -1; });
  const valid = (path: number[]) => path.length >= 4 && path[0] === path.at(-1) && path.every((v, i) => v >= 0 && inside(g.x[v], g.y[v]) && (!i || hasEdge(g, path[i - 1], v)));
  const q = (e: ReturnType<typeof evaluatePath>, p: Placement) => e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
  if (!valid(input) || !poseValid(incumbent.placement)) return null;
  const original = evaluatePath(g, shape, incumbent.placement, input, minMeters, maxMeters);
  if (original.lengthMeters < minMeters || original.lengthMeters > maxMeters || original.repeatRatio > .2) return null;
  const canonicalOriginal = evaluatePath(g, shape, incumbent.placement, pairPhaseZero(g, shape, incumbent.placement, input), minMeters, maxMeters);
  let threshold = Math.min(q(original, incumbent.placement), q(canonicalOriginal, incumbent.placement));
  const inputKey = pairEdgeKey(input), inputKeys = new Set([inputKey]);
  type State = { faces: Set<number>; pose: Placement; candidate: RouteCandidate; quality: number; key: string; edgeKey: string; parentQuality: number | null; mutation: string; id: number; parentId: number | null; depth: number; ancestorWorseSteps: number; rootQuality: number; lineage: string; };
  const seen = new Set<string>(), archive = new Map<string, State>();
  let states = 0, evaluated = 0, invalid = 0, cached = 0, worseChildrenRetained = 0, initialStates = 0, generations = 0;
  const mutations: Record<string, { attempted: number; valid: number; worse: number }> = {};
  const reconstruction: Array<{ inputEdgeCount: number; sourceRaw?: number; exact: boolean; reason: string; method?: string; faceCount?: number }> = [];
  const reservoirHistory: Array<{ generation: number; count: number; ids: number[]; fresh: number; worse: number; maxDepth: number }> = [];
  let coldValidationEvaluations = 0;
  const assess = (faces: Set<number>, pose: Placement, parentQuality: number | null, mutation: string): State | null => {
    if (states >= maxStates) return null;
    if (!poseValid(pose)) { rejections.poseOutsideOrInvalidScale++; return null; }
    const faceKey = [...faces].sort((a, b) => a - b).join(','), key = `${faceKey}|${pose.cx.toFixed(2)},${pose.cy.toFixed(2)},${pose.scale.toFixed(2)},${pose.rotDeg.toFixed(3)}`;
    if (seen.has(key)) { cached++; return null; } seen.add(key); states++;
    const flags = new Uint8Array(m.faces.length + 1); for (const f of faces) flags[f] = 1;
    const nodes = traceUnion(g, m, flags, [...faces]);
    if (!nodes) { invalid++; rejections.traceFailed++; return null; }
    if (!valid(nodes)) { invalid++; rejections.pathInvalid++; return null; }
    const path = pairPhaseZero(g, shape, pose, nodes), e = evaluatePath(g, shape, pose, path, minMeters, maxMeters); evaluated++;
    if (e.lengthMeters < minMeters) { invalid++; rejections.tooShort++; return null; }
    if (e.lengthMeters > maxMeters) { invalid++; rejections.tooLong++; return null; }
    if (e.repeatRatio > .2) { invalid++; rejections.repeated++; return null; }
    const score = q(e, pose);
    const state: State = { faces, pose, candidate: toCandidate(g, shape, pose, e), quality: score, key, edgeKey: pairEdgeKey(path), parentQuality, mutation, id: states, parentId: null, depth: 0, ancestorWorseSteps: 0, rootQuality: score, lineage: mutation };
    archive.set(key, state); return state;
  };
  const poses: Placement[] = [];
  for (const p of coarsePoses) {
    if (!poseValid(p)) { rejections.poseOutsideOrInvalidScale++; continue; }
    if (poses.some(a => Math.hypot(p.cx - a.cx, p.cy - a.cy) < .12 * p.scale && Math.abs(Math.log(p.scale / a.scale)) < .1 && Math.abs(((p.rotDeg - a.rotDeg + 540) % 360) - 180) < 20)) continue;
    poses.push(p); if (poses.length >= maxPoses) break;
  }
  const initial: State[] = [];
  for (const p of poses) for (const threshold of [.3, .5, .7]) {
    const loop = unionForPlacement(g, m, shape, p, region, threshold);
    if (!loop) rejections.initialUnionNull++;
    const state = loop ? assess(new Set(loop.faces), p, null, 'automatic-coarse-union') : null;
    if (state) initial.push(state);
  }
  const usedCold = new Set<string>();
  for (const c of coldParents) {
    if (usedCold.size >= maxColdParents) break;
    const nodes = c.latlngs.map(([lat, lon]) => { const values = index.get(`${lat.toFixed(7)},${lon.toFixed(7)}`); return values?.length === 1 ? values[0] : -1; });
    if (c.shapeId !== shape.id || !valid(nodes) || !poseValid(c.placement)) { reconstruction.push({ inputEdgeCount: nodes.length - 1, exact: false, reason: 'invalid_original_candidate' }); continue; }
    const edgeKey = pairEdgeKey(nodes); if (usedCold.has(edgeKey)) continue; usedCold.add(edgeKey);
    const originalCold = evaluatePath(g, shape, c.placement, nodes, minMeters, maxMeters); coldValidationEvaluations++;
    if (originalCold.lengthMeters < minMeters || originalCold.lengthMeters > maxMeters || originalCold.repeatRatio > .2) { reconstruction.push({ inputEdgeCount: nodes.length - 1, exact: false, reason: 'original_distance_or_repeat' }); continue; }
    const contains = (x: number, y: number) => {
      let yes = false;
      for (let i = 0, j = nodes.length - 1; i < nodes.length; j = i++) { const a = nodes[i], b = nodes[j]; if ((g.y[a] > y) !== (g.y[b] > y) && x < (g.x[b] - g.x[a]) * (y - g.y[a]) / (g.y[b] - g.y[a]) + g.x[a]) yes = !yes; }
      return yes;
    };
    let exactFaces: Set<number> | null = null, method = '', traced = false;
    for (const mode of ['centroid', 'any-interior-sample', 'majority-interior-sample', 'all-interior-samples']) {
      const faces = new Set<number>();
      m.faces.forEach((f, i) => {
        if (!eligible[i]) return;
        const hits = f.samples.filter(([x, y]) => contains(x, y)).length;
        if (mode === 'centroid' ? contains(f.cx, f.cy) : mode === 'any-interior-sample' ? hits > 0 : mode === 'majority-interior-sample' ? hits >= f.samples.length / 2 : hits === f.samples.length) faces.add(i);
      });
      const flags = new Uint8Array(m.faces.length + 1); for (const f of faces) flags[f] = 1;
      const path = traceUnion(g, m, flags, [...faces]); traced ||= !!path;
      if (path && valid(path) && pairEdgeKey(path) === edgeKey) { exactFaces = faces; method = mode; break; }
    }
    if (!exactFaces) { reconstruction.push({ inputEdgeCount: nodes.length - 1, sourceRaw: 100 * Math.exp(-q(originalCold, c.placement)), exact: false, reason: traced ? 'edge_multiset_mismatch' : 'trace_failed' }); continue; }
    const state = assess(exactFaces, c.placement, null, 'automatic-cold-reconstructed');
    if (!state) { reconstruction.push({ inputEdgeCount: nodes.length - 1, exact: false, reason: 'canonical_assessment_invalid_or_duplicate', method, faceCount: exactFaces.size }); continue; }
    inputKeys.add(edgeKey); threshold = Math.min(threshold, q(originalCold, c.placement), state.quality);
    reconstruction.push({ inputEdgeCount: nodes.length - 1, sourceRaw: 100 * Math.exp(-q(originalCold, c.placement)), exact: true, reason: 'exact_actual_edges', method, faceCount: exactFaces.size });
    initial.push(state);
  }
  initialStates = initial.length;
  const initialRejections = { ...rejections }, initialBestRaw = initial.length ? 100 * Math.exp(-Math.min(...initial.map(s => s.quality))) : null;
  const distance = (a: State, b: State) => {
    let intersection = 0; for (const f of a.faces) if (b.faces.has(f)) intersection++;
    const jaccard = 1 - intersection / Math.max(1, a.faces.size + b.faces.size - intersection);
    const pose = Math.min(1, Math.hypot(a.pose.cx - b.pose.cx, a.pose.cy - b.pose.cy) / Math.max(a.pose.scale, b.pose.scale));
    return Math.max(jaccard, pose);
  };
  const select = (candidates: State[], fresh = new Set<string>()) => {
    const ranked = [...new Map(candidates.map(c => [c.key, c])).values()].sort((a, b) => a.quality - b.quality);
    if (reservoirSlots > 0) {
      const eliteCount = Math.max(1, populationSize - reservoirSlots), chosen = ranked.slice(0, eliteCount), reservoir: State[] = [];
      while (chosen.length < populationSize && chosen.length < ranked.length) {
        const available = ranked.filter(s => !chosen.some(p => p.key === s.key));
        available.sort((a, b) => {
          const novelty = (s: State) => Math.min(...chosen.map(p => distance(s, p))) + (fresh.has(s.key) ? .75 : 0) + (s.parentQuality !== null && s.quality > s.parentQuality ? .25 : 0) + Math.min(5, s.depth) * .05;
          return novelty(b) - novelty(a) || a.quality - b.quality;
        });
        chosen.push(available[0]); reservoir.push(available[0]);
      }
      reservoirHistory.push({ generation: generations, count: reservoir.length, ids: reservoir.map(s => s.id), fresh: reservoir.filter(s => fresh.has(s.key)).length, worse: reservoir.filter(s => s.parentQuality !== null && s.quality > s.parentQuality + 1e-7).length, maxDepth: Math.max(0, ...reservoir.map(s => s.depth)) });
      return chosen;
    }
    const chosen: State[] = ranked.length ? [ranked[0]] : [];
    // Geometrically different parents survive even with inferior current Q.
    for (const cutoff of [.3, .15, .06, 0]) for (const state of ranked) {
      if (chosen.some(p => p.key === state.key) || chosen.some(p => distance(p, state) < cutoff)) continue;
      chosen.push(state); if (chosen.length >= populationSize) return chosen;
    }
    return chosen;
  };
  let population = select(initial);
  while (population.length && states < maxStates && generations < 100) {
    const children: State[] = [];
    for (let round = 0; round < 4 && states < maxStates; round++) for (const parent of population) {
      if (states >= maxStates) break;
      const boundary = new Set<number>();
      for (const f of parent.faces) for (const n of neighbors[f]) if (!parent.faces.has(n)) { boundary.add(f); boundary.add(n); }
      const ids = [...boundary]; if (!ids.length) continue;
      const next = new Set(parent.faces), flip = (f: number) => { if (next.has(f)) next.delete(f); else next.add(f); };
      const first = ids[Math.floor(random() * ids.length)]; let pose = parent.pose;
      const kind = (generations + round) % 4, name = ['nonlocal-two-face', 'connected-patch', 'donor-patch', 'joint-pose-and-face'][kind];
      mutations[name] ??= { attempted: 0, valid: 0, worse: 0 }; mutations[name].attempted++;
      if (kind === 0) {
        flip(first);
        const distant = ids.filter(f => Math.hypot(m.faces[f].cx - m.faces[first].cx, m.faces[f].cy - m.faces[first].cy) > .25 * parent.pose.scale);
        if (distant.length) flip(distant[Math.floor(random() * distant.length)]);
      } else if (kind === 1) {
        const patch = [first];
        for (let k = 0; k < 2 + Math.floor(random() * 2); k++) {
          const frontier = patch.flatMap(f => neighbors[f]).filter(f => !patch.includes(f));
          if (frontier.length) patch.push(frontier[Math.floor(random() * frontier.length)]);
        }
        patch.forEach(flip);
      } else if (kind === 2) {
        const donor = population[Math.floor(random() * population.length)];
        const differences = [...new Set([...parent.faces, ...donor.faces])].filter(f => parent.faces.has(f) !== donor.faces.has(f));
        const center = differences[Math.floor(random() * differences.length)];
        if (center === undefined) continue;
        differences.sort((a, b) => Math.hypot(m.faces[a].cx - m.faces[center].cx, m.faces[a].cy - m.faces[center].cy) - Math.hypot(m.faces[b].cx - m.faces[center].cx, m.faces[b].cy - m.faces[center].cy));
        differences.slice(0, 2 + Math.floor(random() * 3)).forEach(flip);
      } else {
        flip(first);
        const axis = Math.floor(random() * 4), sign = random() < .5 ? -1 : 1, p = parent.pose;
        pose = { cx: p.cx + (axis === 0 ? sign * p.scale * .025 : 0), cy: p.cy + (axis === 1 ? sign * p.scale * .025 : 0), scale: p.scale * (axis === 2 ? 1 + sign * .025 : 1), rotDeg: p.rotDeg + (axis === 3 ? sign * 3 : 0) };
      }
      const child = assess(next, pose, parent.quality, name);
      if (child) {
        child.parentId = parent.id; child.depth = parent.depth + 1; child.ancestorWorseSteps = parent.ancestorWorseSteps + (child.quality > parent.quality + 1e-7 ? 1 : 0); child.rootQuality = parent.rootQuality; child.lineage = parent.lineage;
        children.push(child); mutations[name].valid++; if (child.quality > parent.quality + 1e-7) mutations[name].worse++;
      }
    }
    const chosen = select([...population, ...children], new Set(children.map(s => s.key)));
    worseChildrenRetained += chosen.filter(c => c.parentQuality !== null && c.quality > c.parentQuality + 1e-7 && children.some(x => x.key === c.key)).length;
    population = chosen; generations++;
  }
  const ranked = [...archive.values()].sort((a, b) => a.quality - b.quality), best = ranked.find(s => !inputKeys.has(s.edgeKey) && s.quality < threshold - 1e-7);
  const byId = new Map(ranked.map(s => [s.id, s])), chain: Array<{ id: number; parentId: number | null; depth: number; raw: number; mutation: string; lineage: string; ancestorWorseSteps: number }> = [];
  let at: State | undefined = ranked[0];
  while (at) { chain.push({ id: at.id, parentId: at.parentId, depth: at.depth, raw: 100 * Math.exp(-at.quality), mutation: at.mutation, lineage: at.lineage, ancestorWorseSteps: at.ancestorWorseSteps }); at = at.parentId === null ? undefined : byId.get(at.parentId); }
  return { candidate: best?.candidate ?? toCandidate(g, shape, incumbent.placement, original), pool: ranked.slice(0, 16).map(s => s.candidate), geometryImprovement: !!best, inputRaw: 100 * Math.exp(-q(original, incumbent.placement)), canonicalInputRaw: 100 * Math.exp(-q(canonicalOriginal, incumbent.placement)), strongestInputRaw: 100 * Math.exp(-threshold), afterRaw: best ? 100 * Math.exp(-best.quality) : 100 * Math.exp(-q(original, incumbent.placement)), bestGeneratedRaw: ranked[0] ? 100 * Math.exp(-ranked[0].quality) : null, bestGeneratedSimilarity: ranked[0]?.candidate.similarity ?? null, initialBestRaw, initialRejections, rejections, states, evaluated, invalid, cached, poses: poses.length, initialStates, generations, finalPopulation: population.length, worseChildrenRetained, reconstruction, coldValidationEvaluations, reservoirHistory, bestGeneratedChain: chain.reverse(), improvedBeyondRootAfterWorse: ranked.filter(s => s.ancestorWorseSteps > 0 && s.quality < s.rootQuality - 1e-7).length, mutations, blocks: m.faces.length, maximumStates: maxStates, inputUsedAsParent: reconstruction.some(r => r.exact && r.inputEdgeCount === input.length - 1 && Math.abs((r.sourceRaw ?? 0) - 100 * Math.exp(-q(original, incumbent.placement))) < 1e-7) };
}
