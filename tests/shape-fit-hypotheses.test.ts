import { expect, it } from 'vitest';
import { placeShape } from '@/lib/route/fit';
import { matchShape } from '@/lib/route/loops';
import { shapeFitHypotheses } from '@/lib/route/shapeFitHypotheses';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it('recovers a translated and rotated uniformly scaled asymmetric template', () => {
  const shape = SHAPE_BY_ID.cat, p = { cx: 350, cy: -230, scale: 1400, rotDeg: 112 };
  const xy = placeShape(shape.points, p), hypotheses = shapeFitHypotheses(xy, shape);
  expect(hypotheses.length).toBeLessThanOrEqual(8);
  expect(hypotheses[0].residual).toBeLessThan(1e-10);
  expect(hypotheses[0].placement.cx).toBeCloseTo(p.cx, 7);
  expect(hypotheses[0].placement.cy).toBeCloseTo(p.cy, 7);
  expect(hypotheses[0].placement.scale).toBeCloseTo(p.scale, 7);
  expect(hypotheses[0].placement.rotDeg).toBeCloseTo(p.rotDeg, 7);
  const old = matchShape(xy, shape, undefined, false, undefined, { fullRotation: true });
  expect(hypotheses[0].residual).toBeCloseTo(old!.resid, 10);
});

it('keeps correspondence hypotheses finite and positive without reflected transforms', () => {
  const shape = SHAPE_BY_ID.cat, xy = placeShape(shape.points, { cx: 0, cy: 0, scale: 1000, rotDeg: -21 }).reverse();
  const hypotheses = shapeFitHypotheses(xy, shape);
  expect(hypotheses.length).toBeGreaterThan(1);
  expect(hypotheses.every(h => h.placement.scale > 0 && Object.values(h.placement).every(Number.isFinite))).toBe(true);
  expect(hypotheses[0].residual).toBeLessThan(1e-10);
});
