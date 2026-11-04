import type { ReferencePoint } from "./roadReference";
import type { RouteStructure } from "./routeStructure";

type Point = ReferencePoint;
export interface RoutePocket {
  /** Relative positions in the supplied ordered contour, not geographic coordinates. */
  start: number;
  end: number;
  depth: number;
  span: number;
}
export interface RouteParts extends RouteStructure {
  pockets: RoutePocket[];
  stablePockets: number;
}

const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
function distance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function simplify(points: Point[], epsilon: number): Point[] {
  const keep = new Set([0, points.length - 1]), stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let best = epsilon, index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distance(points[i], points[a], points[b]);
      if (d > best) { best = d; index = i; }
    }
    if (index >= 0) { keep.add(index); stack.push([a, index], [index, b]); }
  }
  return [...keep].sort((a, b) => a - b).map(i => points[i]);
}
function hullIndices(points: Point[]): number[] {
  const order = points.map((_, i) => i).sort((a, b) => points[a][0] - points[b][0] || points[a][1] - points[b][1]);
  const half = (indices: number[]) => {
    const result: number[] = [];
    for (const i of indices) {
      while (result.length >= 2 && cross(points[result.at(-2)!], points[result.at(-1)!], points[i]) <= 0) result.pop();
      result.push(i);
    }
    return result.slice(0, -1);
  };
  return [...new Set([...half(order), ...half([...order].reverse())])].sort((a, b) => a - b);
}

/** Geometric convexity pockets at two tolerances. No object name or semantic probability. */
export function describeRouteParts(input: Point[]): RouteParts {
  const empty = (): RouteParts => ({ pockets: [], stablePockets: 0, salience: 0, signature: Array(64).fill(0) });
  if (input.length < 4 || input.some(p => p.some(v => !Number.isFinite(v)))) return empty();
  if (input[0][0] !== input.at(-1)![0] || input[0][1] !== input.at(-1)![1]) return empty();
  const points = input.slice(0, -1);
  if (points.length < 3) return empty();
  // Arc-weighted centre is unchanged by extra collinear road vertices. Unlike a
  // bounding-box diagonal, this scale is also invariant under arbitrary rotation.
  let perimeter = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    perimeter += length; cx += (a[0] + b[0]) * .5 * length; cy += (a[1] + b[1]) * .5 * length;
  }
  if (!perimeter) return empty();
  cx /= perimeter; cy /= perimeter;
  let scale = 0;
  for (const p of points) scale = Math.max(scale, 2 * Math.hypot(p[0] - cx, p[1] - cy));
  if (!scale) return empty();
  // Split the ring at a distant vertex so RDP never receives a zero-length closure chord.
  let far = 1;
  for (let i = 2; i < points.length; i++) if (Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]) > Math.hypot(points[far][0] - points[0][0], points[far][1] - points[0][1])) far = i;
  const atTolerance = (epsilon: number): RoutePocket[] => {
    const ring = [...simplify(points.slice(0, far + 1), epsilon * scale).slice(0, -1), ...simplify([...points.slice(far), points[0]], epsilon * scale).slice(0, -1)];
    if (ring.length < 3) return [];
    const hull = hullIndices(ring), lengths = [0];
    for (let i = 0; i < ring.length; i++) lengths.push(lengths[i] + Math.hypot(ring[(i + 1) % ring.length][0] - ring[i][0], ring[(i + 1) % ring.length][1] - ring[i][1]));
    const total = lengths.at(-1)!;
    const pockets: RoutePocket[] = [];
    for (let j = 0; j < hull.length; j++) {
      const a = hull[j], b = hull[(j + 1) % hull.length];
      let depth = 0;
      for (let k = (a + 1) % ring.length; k !== b; k = (k + 1) % ring.length) depth = Math.max(depth, distance(ring[k], ring[a], ring[b]) / scale);
      const span = ((lengths[b] - lengths[a] + total) % total) / total;
      if (depth >= .025 && span >= .04) pockets.push({ start: lengths[a] / total, end: lengths[b] / total, depth, span });
    }
    return pockets;
  };
  const fine = atTolerance(.0125), coarse = atTolerance(.025);
  const center = (p: RoutePocket) => (p.start + p.span / 2) % 1;
  const pockets = fine.filter(p => coarse.some(q => {
    const delta = Math.abs(center(p) - center(q));
    return Math.min(delta, 1 - delta) < .08 && Math.min(p.depth, q.depth) / Math.max(p.depth, q.depth) > .5;
  }));
  const signature = Array.from({ length: 64 }, (_, i) => pockets.reduce((sum, p) => {
    const t = (i / 64 - p.start + 1) % 1;
    return sum + (t <= p.span ? p.depth * Math.sin(Math.PI * t / p.span) : 0);
  }, 0));
  const salience = pockets.reduce((sum, p) => sum + Math.min(p.depth, .25) * Math.sqrt(p.span), 0) / Math.max(1, pockets.length / 5);
  return { signature, pockets, stablePockets: pockets.length, salience };
}
