import type { ReferencePoint } from "./roadReference";

/** Label-free shape evidence, not a semantic confidence or route quality score. */
export interface RouteStructure {
  signature: number[];
  salience: number;
}

const N = 64;

/** Arc-length sampling followed by circular smoothing suppresses street-grid kinks. */
export function describeRouteStructure(line: ReferencePoint[]): RouteStructure {
  const lengths = [0];
  for (let i = 1; i < line.length; i++) lengths.push(lengths[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const perimeter = lengths.at(-1) ?? 0;
  if (line.length < 4 || !Number.isFinite(perimeter) || perimeter <= 0) return { signature: Array(N).fill(0), salience: 0 };
  let edge = 1;
  const samples = Array.from({ length: N }, (_, i): ReferencePoint => {
    const d = perimeter * i / N;
    while (edge < line.length - 1 && lengths[edge] < d) edge++;
    const a = line[edge - 1], b = line[edge];
    const t = (d - lengths[edge - 1]) / (lengths[edge] - lengths[edge - 1] || 1);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  });
  const smooth = samples.map((_, i): ReferencePoint => {
    const neighbours = [-2, -1, 0, 1, 2].map(k => samples[(i + k + N) % N]);
    return [neighbours.reduce((s, p) => s + p[0], 0) / 5, neighbours.reduce((s, p) => s + p[1], 0) / 5];
  });
  const cx = smooth.reduce((s, p) => s + p[0], 0) / N, cy = smooth.reduce((s, p) => s + p[1], 0) / N;
  const radii = smooth.map(p => Math.hypot(p[0] - cx, p[1] - cy));
  const mean = radii.reduce((s, r) => s + r, 0) / N || 1;
  // Ordered radii encode relative sizes and arc spacing of protrusions/indentations.
  const signature = radii.map(r => r / mean);
  const variation = signature.reduce((s, r) => s + (r - 1) ** 2, 0) / N;
  const roughness = samples.reduce((s, p, i) => s + Math.hypot(p[0] - smooth[i][0], p[1] - smooth[i][1]), 0) / N / mean;
  return { signature, salience: Math.min(variation, .5) / (1 + 10 * roughness) };
}

/** Compare relative part arrangement regardless of start vertex, direction or rotation. */
export function routeStructureDistance(a: RouteStructure, b: RouteStructure): number {
  let best = Infinity;
  for (const direction of [1, -1]) for (let shift = 0; shift < N; shift++) {
    let distance = 0;
    for (let i = 0; i < N; i++) distance += (a.signature[i] - b.signature[(shift + direction * i + N) % N]) ** 2;
    best = Math.min(best, distance / N);
  }
  return best;
}
