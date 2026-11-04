import { loopSamples, matchShape, shapeSamples } from "@/lib/route/loops";
import { SHAPES, type ShapeKind } from "@/lib/route/shapes";
import type { ReferencePoint } from "./roadReference";

export interface RouteHypothesis {
  shapeId: string;
  kind: ShapeKind;
  /** Lower is better. Local geometry only, never a semantic probability. */
  score: number;
  meanError: number;
  worstSegmentError: number;
  residual: number;
}
export interface RouteHypotheses {
  basic: RouteHypothesis | null;
  animal: RouteHypothesis | null;
  object: RouteHypothesis | null;
}
const bank = SHAPES.map(shape => ({ shape, samples: shapeSamples(shape) }));

/** Match a whole object hypothesis with one uniform pose and cyclic order.
 * The worst 1/8-contour window prevents a good body from hiding a badly fitting
 * distinguishing part. This does not identify anatomical parts or certify meaning.
 */
export function describeRouteHypotheses(line: ReferencePoint[]): RouteHypotheses {
  const empty: RouteHypotheses = { basic: null, animal: null, object: null };
  if (line.length < 4 || line.length > 10_000 || line.some(p => p.some(v => !Number.isFinite(v)))
    || line[0][0] !== line.at(-1)![0] || line[0][1] !== line.at(-1)![1]) return empty;
  // Reference coordinates are y-down; the immutable shape bank uses y-up.
  const xy = line.map(([x, y]): ReferencePoint => [x, -y]);
  let area = 0;
  for (let i = 1; i < xy.length; i++) area += xy[i - 1][0] * xy[i][1] - xy[i][0] * xy[i - 1][1];
  if (Math.abs(area) < 1e-12) return empty;
  const route = loopSamples(xy);
  const matches = bank.flatMap(({ shape, samples }) => {
    const fit = matchShape(xy, shape, samples, false, route, { fullRotation: true });
    return fit && Number.isFinite(fit.resid) && fit.scale > 1e-12 ? [{ shape, samples, fit }] : [];
  });
  for (const kind of ["basic", "animal", "object"] as const) {
    // Shortlist by cheap ordered whole-contour residual before window diagnostics.
    const shortlist = matches.filter(m => (m.shape.kind ?? "basic") === kind).sort((a, b) => a.fit.resid - b.fit.resid || a.shape.id.localeCompare(b.shape.id)).slice(0, 3);
    for (const { shape, samples, fit } of shortlist) {
      const angle = fit.rotDeg * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
      const aligned = samples.map(([x, y]) => [fit.cx + fit.scale * (x * c - y * s), fit.cy + fit.scale * (x * s + y * c)]);
      let errors: number[] = [], best = Infinity;
      for (let shift = 0; shift < route.length; shift++) {
        const distances = aligned.map((p, i) => Math.hypot(p[0] - route[(i + shift) % route.length][0], p[1] - route[(i + shift) % route.length][1]) / fit.scale);
        const total = distances.reduce((sum, d) => sum + d * d, 0);
        if (total < best) { best = total; errors = distances; }
      }
      const meanError = errors.reduce((sum, d) => sum + d, 0) / errors.length;
      const window = Math.max(1, Math.round(errors.length / 8));
      let worstSegmentError = 0;
      for (let start = 0; start < errors.length; start++) {
        let sum = 0;
        for (let i = 0; i < window; i++) sum += errors[(start + i) % errors.length];
        worstSegmentError = Math.max(worstSegmentError, sum / window);
      }
      const hypothesis: RouteHypothesis = { shapeId: shape.id, kind, score: meanError + .5 * worstSegmentError, meanError, worstSegmentError, residual: fit.resid };
      if (!empty[kind] || hypothesis.score < empty[kind]!.score) empty[kind] = hypothesis;
    }
  }
  return empty;
}
