import type { Region } from './fit';
import type { RoadGraph } from './graph';
import type { FeatureArc, FeatureChains } from './distinctiveFeatures';
import { boundaryEdgeKey, routeBoundarySegment, type BoundaryBudget } from './boundaryRouting';

export interface BoundaryCompletionOptions {
  mode: 'plain' | 'independent'; region: Region; maxExpandedPerCall: number;
  guideTolerance: number; guideWeight: number; now?: () => number;
}
export interface BoundaryCompletion {
  path: number[] | null; chains: FeatureChains[]; calls: number; expanded: number;
  reason: string;
}
/** Open vertex list (remove the final closing duplicate), same outline/anchor IDs
 * for both modes. Independent mode first
 * reserves disjoint feature boundaries, then completes the remaining contour.
 * Body/body reuse is allowed, as in the control. No coordinates are synthesized.
 * Caller MUST audit final length, repetition, real edges, bounds and feature metrics.
 */
export function completeBoundaryOutline(g: RoadGraph, outline: readonly (readonly [number, number])[], pins: readonly number[],
  features: readonly FeatureArc[], options: BoundaryCompletionOptions, budget: BoundaryBudget): BoundaryCompletion {
  const n = outline.length, started = budget.expanded;
  let calls = 0;
  const fail = (reason: string): BoundaryCompletion => ({ path: null, chains: [], calls, expanded: budget.expanded - started, reason });
  if (n < 3 || pins.length !== n || outline.some(p => p.length !== 2 || p.some(x => !Number.isFinite(x)))
    || pins.some(v => !Number.isInteger(v) || v < 0 || v >= g.n)) return fail('invalid_outline_or_anchor');
  if (outline[0][0] === outline[n - 1][0] && outline[0][1] === outline[n - 1][1]) return fail('closing_duplicate_must_be_removed');
  if (options.mode === 'independent' && features.length < 2) return fail('two_feature_definitions_required');
  const vertexOwner = new Map<number, number>(), featureSegments: number[] = [];
  for (let f = 0; f < features.length; f++) {
    const arc = features[f];
    if (arc.vertices.length < 3 || arc.triple[0] !== arc.vertices[0] || arc.triple[2] !== arc.vertices.at(-1)
      || !arc.vertices.slice(1, -1).includes(arc.triple[1])) return fail('invalid_feature_arc');
    for (let j = 0; j < arc.vertices.length; j++) {
      const v = arc.vertices[j];
      if (!Number.isInteger(v) || v < 0 || v >= n || vertexOwner.has(v)) return fail('overlapping_or_invalid_feature_vertices');
      if (j && v !== (arc.vertices[j - 1] + 1) % n) return fail('nonconsecutive_feature_arc');
      vertexOwner.set(v, f);
      if (j < arc.vertices.length - 1) featureSegments.push(v);
    }
  }
  const featureSet = new Set(featureSegments), featurePins = new Set([...vertexOwner.keys()].map(i => pins[i]));
  if (options.mode === 'independent' && featurePins.size !== vertexOwner.size) return fail('collapsed_feature_anchors');
  if (options.mode === 'independent' && pins.some((v, i) => featurePins.has(v) && !vertexOwner.has(i))) return fail('body_anchor_aliases_feature');
  const allPins = new Set(pins), connectionIndices = new Set(features.flatMap(f => [f.vertices[0], f.vertices.at(-1)!]));
  const order = options.mode === 'plain' ? Array.from({ length: n }, (_, i) => i)
    : [...featureSegments, ...Array.from({ length: n }, (_, i) => i).filter(i => !featureSet.has(i))];
  const parts = new Map<number, number[]>(), protectedNodes = new Set<number>(), protectedEdges = new Set<string>();
  for (const i of order) {
    const next = (i + 1) % n, start = pins[i], goal = pins[next];
    if (options.mode === 'independent' && !featureSet.has(i)
      && [[i, start], [next, goal]].some(([index, node]) => protectedNodes.has(node) && !connectionIndices.has(index))) return fail('body_endpoint_inside_feature');
    const blocked = options.mode === 'independent'
      ? new Set([...protectedNodes, ...(featureSet.has(i) ? allPins : featurePins)]) : new Set<number>();
    blocked.delete(start); blocked.delete(goal);
    calls++;
    const route = routeBoundarySegment(g, start, goal, {
      region: options.region, forbiddenNodes: blocked,
      forbiddenEdges: options.mode === 'independent' ? protectedEdges : undefined,
      maxExpanded: options.maxExpandedPerCall, now: options.now,
      guide: { a: outline[i], b: outline[next], tolerance: options.guideTolerance, weight: options.guideWeight },
    }, budget);
    if (!route.path) return fail(`segment_${i}:${route.reason}`);
    parts.set(i, route.path);
    if (options.mode === 'independent' && featureSet.has(i)) {
      route.path.forEach(v => protectedNodes.add(v));
      for (let j = 1; j < route.path.length; j++) protectedEdges.add(boundaryEdgeKey(route.path[j - 1], route.path[j]));
    }
  }
  const concatenate = (segments: readonly number[]) => segments.flatMap((i, j) => j ? parts.get(i)!.slice(1) : parts.get(i)!);
  const path = concatenate(Array.from({ length: n }, (_, i) => i));
  if (path[0] !== path.at(-1)) return fail('completion_not_closed');
  const chains: FeatureChains[] = features.map(arc => {
    const tip = arc.vertices.indexOf(arc.triple[1]);
    return { entryToTip: concatenate(arc.vertices.slice(0, tip)), tipToExit: concatenate(arc.vertices.slice(tip, -1)) };
  });
  return { path, chains, calls, expanded: budget.expanded - started, reason: 'completed_not_yet_audited' };
}
