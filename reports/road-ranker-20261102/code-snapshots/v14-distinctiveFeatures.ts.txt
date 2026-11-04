import { DIVERSITY_CATALOG } from './diversityCatalog';

export type FeatureXY = readonly [number, number];
export type FeatureTriplet = readonly [FeatureXY, FeatureXY, FeatureXY];
/** Fixed BEFORE measuring a candidate. extent is the placed template's max bbox extent,
 * never the candidate bbox. rotationDeg is the template x-axis in world coordinates. */
export interface FeatureFrame { origin: FeatureXY; extent: number; rotationDeg: number }
export interface FeatureMeasurement {
  width: number; depth: number; orientationDeg: number;
  /** Tip displacement from entry/exit midpoint, in the fixed template frame. */
  direction: FeatureXY;
  center: FeatureXY;
}
export interface FeatureArc {
  name: string;
  /** Contiguous ORIGINAL vertex indices, in original contour order (wrap allowed). */
  vertices: readonly number[];
  /** Original vertex indices: entry, representative tip/interior landmark, exit. */
  triple: readonly [number, number, number];
  reference: FeatureMeasurement;
}
export type DistinctiveDefinition = Readonly<{
  key: string; supported: true; features: readonly FeatureArc[]; templateExtent: number;
  basis: string;
}> | Readonly<{ key: string; supported: false; reason: string; basis: string }>;

const BASIS = 'Original-outline structural hypotheses, not anatomical detection or human-recognition truth';
type ArcSpec = readonly [name: string, start: number, tip: number, end: number];
// Indices were read from shapes.ts / objectTemplates.ts, NOT inferred from corners.
// Two ears/wings count as bilateral cues, not proof of species discrimination.
const SPECS: Readonly<Record<string, readonly ArcSpec[] | string>> = {
  cat: [['right ear', 4, 5, 6], ['left ear', 8, 9, 10]],
  fish: 'Tail base repeats the same coordinate at vertices 4 and 7; a two-boundary tail triplet has zero width. Body curvature alone is not a second distinctive cue.',
  dog: [['muzzle', 4, 6, 8], ['raised tail', 17, 18, 0]],
  rabbit: [['first long ear', 9, 11, 13], ['second long ear', 14, 15, 17]],
  bird: [['beak', 6, 7, 8], ['tail', 13, 14, 15]],
  whale: 'A broad body plus one tail complex does not supply two disjoint distinctive cues in this outline; do not relabel generic body corners as anatomy.',
  turtle: [['head', 0, 2, 4], ['front flipper', 5, 7, 9]],
  elephant: [['trunk', 7, 9, 12], ['front leg', 13, 14, 16]],
  giraffe: [['neck and small head', 2, 6, 11], ['hind leg', 16, 17, 19]],
  butterfly: [['left upper wing', 0, 2, 6], ['right upper wing', 18, 22, 23]],
  duck: [['beak', 7, 8, 10], ['tail', 17, 18, 1]],
  house: 'Roof is one cue; the plain rectangular body supplies no second disjoint distinctive feature without inventing a door/window.',
  tree: [['crown', 8, 0, 4], ['trunk', 5, 6, 7]],
  car: [['front wheel', 8, 9, 11], ['rear wheel', 12, 13, 15]],
  rocket: [['nose', 14, 0, 2], ['right fin', 3, 5, 6]],
  apple: 'Stem is one localized cue; body lobes are not a second unambiguous disjoint feature in the existing silhouette.',
  crown: [['left prong', 0, 1, 2], ['right prong', 4, 5, 6]],
  airplane: [['right main wing', 2, 3, 5], ['left tailplane', 9, 10, 12]],
  mug: 'Only the external handle bulge is localized; no handle hole or second separate cue exists in the single outer contour.',
  tshirt: [['neck notch', 1, 2, 4], ['left sleeve', 11, 12, 0]],
  pants: 'The crotch/two-leg gap is one coupled cue; the straight waist is not an independent distinctive cue. Do not split the same gap into two hypotheses.',
  hammer: 'Head and handle share their defining junction; this short outline cannot supply two disjoint nondegenerate arcs representing both without generic-corner proxies.',
  bottle: [['narrow neck', 7, 0, 2], ['wide body', 3, 4, 6]],
  key: [['head', 12, 13, 1], ['tooth', 5, 6, 8]],
  chair: [['backrest', 9, 0, 2], ['front leg', 3, 4, 6]],
};

function finitePoint(p: FeatureXY): boolean {
  return p.length === 2 && p.every(Number.isFinite);
}
function angle(v: FeatureXY): number { return Math.atan2(v[1], v[0]) * 180 / Math.PI; }
function angleDifference(a: number, b: number): number {
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}

/** Pure O(1). Returns null on nonfinite/degenerate geometry. Endpoint reversal leaves
 * width, depth and tip-direction orientation unchanged. Orientation is directed
 * (-180,180], NOT modulo180; mirrored layouts are not rotation equivalents.
 * depth is perpendicular distance to the entry-exit LINE, not to its segment. */
export function measureFeatureTriplet(points: FeatureTriplet, frame: FeatureFrame): FeatureMeasurement | null {
  if (!points.every(finitePoint) || !finitePoint(frame.origin)
    || !Number.isFinite(frame.extent) || frame.extent <= 0 || !Number.isFinite(frame.rotationDeg)) return null;
  const rad = frame.rotationDeg * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const local = ([x, y]: FeatureXY): FeatureXY => {
    const dx = (x - frame.origin[0]) / frame.extent, dy = (y - frame.origin[1]) / frame.extent;
    return [c * dx + s * dy, -s * dx + c * dy];
  };
  const [a, tip, b] = points.map(local);
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const width = Math.hypot(dx, dy);
  const center: FeatureXY = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const direction: FeatureXY = [tip[0] - center[0], tip[1] - center[1]];
  const depth = Math.abs(dx * (tip[1] - a[1]) - dy * (tip[0] - a[0])) / width;
  if (![width, depth, ...center, ...direction].every(Number.isFinite) || width <= 1e-10 || depth <= 1e-10) return null;
  return { width, depth, center, direction, orientationDeg: angle(direction) };
}

function arcIndices(start: number, end: number, n: number): number[] {
  const out = [start];
  for (let i = 1; i < n; i++) { const v = (start + i) % n; out.push(v); if (v === end) return out; }
  throw new Error('Arc must end at a distinct original vertex');
}

/** Frozen, detached definitions; never freezes or mutates the original templates.
 * Features have disjoint original vertex arcs, including their endpoints. */
export const DISTINCTIVE_FEATURES: readonly DistinctiveDefinition[] = Object.freeze(DIVERSITY_CATALOG.map(item => {
  const spec = SPECS[item.key];
  if (!spec) throw new Error(`Missing feature scope: ${item.key}`);
  if (typeof spec === 'string') return Object.freeze({ key: item.key, supported: false as const, reason: spec, basis: BASIS });
  const points = item.shape.points, n = points.length - 1;
  const extent = Math.max(...points.map(p => p[0])) - Math.min(...points.map(p => p[0]));
  const templateExtent = Math.max(extent, Math.max(...points.map(p => p[1])) - Math.min(...points.map(p => p[1])));
  const used = new Set<number>();
  const features = spec.map(([name, start, tip, end]) => {
    if (![start, tip, end].every(i => Number.isInteger(i) && i >= 0 && i < n)) throw new Error(`Bad index: ${item.key}`);
    const vertices = arcIndices(start, end, n);
    if (!vertices.slice(1, -1).includes(tip)) throw new Error(`Tip outside arc: ${item.key}/${name}`);
    for (const vertex of vertices) {
      if (used.has(vertex)) throw new Error(`Overlapping template arcs: ${item.key}`);
      used.add(vertex);
    }
    const reference = measureFeatureTriplet([points[start], points[tip], points[end]], { origin: [0, 0], extent: templateExtent, rotationDeg: 0 });
    if (!reference) throw new Error(`Degenerate reference: ${item.key}/${name}`);
    Object.freeze(reference.center); Object.freeze(reference.direction); Object.freeze(reference);
    return Object.freeze({ name, vertices: Object.freeze(vertices), triple: Object.freeze([start, tip, end] as const), reference });
  });
  return Object.freeze({ key: item.key, supported: true as const, templateExtent, features: Object.freeze(features), basis: BASIS });
}));

export interface FeatureChains {
  /** Chains must follow entry->tip and tip->exit, sharing their tip node. */
  entryToTip: readonly number[]; tipToExit: readonly number[];
}
export interface FeatureCheck { ok: boolean; reasons: string[] }

/** Bounded to64 features,10000 nodes/chain. Rejects any undirected edge reuse,
 * including reversal within one boundary, across two boundaries or across features.
 * Each arm must be node-simple; arms may share only their common tip. Different
 * features may not share ANY node, including their entry/tip/exit endpoints.
 * Checks identity only: callers MUST separately verify real edges, XY/node agreement,
 * region, closure, native/projected3-8km and repeat<=.2 for the complete route. */
export function checkFeatureChains(chains: readonly FeatureChains[]): FeatureCheck {
  const reasons: string[] = [], seen = new Set<string>(), previousFeatureNodes = new Set<number>();
  if (chains.length < 2 || chains.length > 64) return { ok: false, reasons: ['feature_chain_count'] };
  chains.forEach((pair, feature) => {
    const a = pair.entryToTip, b = pair.tipToExit;
    if (a.length < 2 || b.length < 2 || a.length > 10000 || b.length > 10000) { reasons.push(`chain_length:${feature}`); return; }
    if (a.at(-1) !== b[0]) reasons.push(`tip_not_shared:${feature}`);
    if (a[0] === b.at(-1)) reasons.push(`collapsed_entry_exit:${feature}`);
    const featureNodes = new Set<number>(), firstArmNodes = new Set<number>();
    for (const [arm, chain] of [a, b].entries()) {
      if (!chain.every(v => Number.isSafeInteger(v) && v >= 0)) { reasons.push(`invalid_node:${feature}`); continue; }
      const armNodes = new Set<number>();
      for (const node of chain) {
        if (armNodes.has(node)) reasons.push(`repeated_arm_node:${feature}:${arm}:${node}`);
        if (arm === 1 && firstArmNodes.has(node) && !(a.at(-1) === b[0] && node === b[0]))
          reasons.push(`shared_boundary_node:${feature}:${node}`);
        if (previousFeatureNodes.has(node) && !featureNodes.has(node))
          reasons.push(`shared_feature_node:${feature}:${node}`);
        armNodes.add(node); featureNodes.add(node);
        if (arm === 0) firstArmNodes.add(node);
      }
      for (let i = 1; i < chain.length; i++) {
        const u = chain[i - 1], v = chain[i], key = u < v ? `${u}:${v}` : `${v}:${u}`;
        if (u === v) reasons.push(`zero_edge:${feature}`);
        if (seen.has(key)) reasons.push(`reused_edge:${feature}:${key}`);
        seen.add(key);
      }
    }
    for (const node of featureNodes) previousFeatureNodes.add(node);
  });
  return { ok: reasons.length === 0, reasons };
}

/** Ratios fixed inclusive[.5,1.5], directed angle<=30 degrees. Measurements must
 * use the SAME predeclared frame (no candidate refit). Also checks pairwise center
 * separation and its directed orientation: independently matching two cues is
 * insufficient. Optional chains correspond positionally to definition.features. */
export function checkDistinctiveConstraints(definition: DistinctiveDefinition,
  placed: readonly FeatureTriplet[], frame: FeatureFrame, chains?: readonly FeatureChains[]): FeatureCheck {
  if (!definition.supported) return { ok: false, reasons: [`unsupported:${definition.reason}`] };
  if (placed.length !== definition.features.length) return { ok: false, reasons: ['feature_count'] };
  const reasons: string[] = [];
  const measured = placed.map(p => measureFeatureTriplet(p, frame));
  const ratioOK = (actual: number, reference: number) => actual / reference >= .5 - 1e-12 && actual / reference <= 1.5 + 1e-12;
  measured.forEach((m, i) => {
    if (!m) { reasons.push(`degenerate:${i}`); return; }
    const r = definition.features[i].reference;
    if (!ratioOK(m.width, r.width)) reasons.push(`width:${i}`);
    if (!ratioOK(m.depth, r.depth)) reasons.push(`depth:${i}`);
    if (angleDifference(m.orientationDeg, r.orientationDeg) > 30 + 1e-10) reasons.push(`orientation:${i}`);
  });
  for (let i = 0; i < measured.length; i++) for (let j = i + 1; j < measured.length; j++) {
    const a = measured[i], b = measured[j]; if (!a || !b) continue;
    const ra = definition.features[i].reference.center, rb = definition.features[j].reference.center;
    const d: FeatureXY = [b.center[0] - a.center[0], b.center[1] - a.center[1]];
    const rd: FeatureXY = [rb[0] - ra[0], rb[1] - ra[1]];
    const length = Math.hypot(...rd);
    if (length <= 1e-10) { reasons.push(`degenerate_reference_relation:${i}:${j}`); continue; }
    if (!ratioOK(Math.hypot(...d), length)) reasons.push(`separation:${i}:${j}`);
    if (angleDifference(angle(d), angle(rd)) > 30 + 1e-10) reasons.push(`relation_orientation:${i}:${j}`);
  }
  if (chains) {
    if (chains.length !== definition.features.length) reasons.push('chain_count_mismatch');
    reasons.push(...checkFeatureChains(chains).reasons);
  }
  return { ok: reasons.length === 0, reasons };
}
