import { expect, it } from 'vitest';
import { segmentRadiusInterval } from '@/lib/route/segmentRadiusInterval';

it('retains a monotone correspondence that nearest checkpoint projections would discard', () => {
  const first = segmentRadiusInterval([0, 0], [10, 0], [8, 0], 3)!;
  const second = segmentRadiusInterval([0, 0], [10, 0], [7, 0], 3)!;
  expect(first[0]).toBeCloseTo(.5); expect(second[0]).toBeCloseTo(.4);
  const reachableSecond = Math.max(first[0], second[0]);
  expect(reachableSecond).toBeLessThanOrEqual(second[1]);
  expect(reachableSecond).toBeCloseTo(.5);
});

it('preserves reversed direction, tangency, clipping, and zero length semantics', () => {
  expect(segmentRadiusInterval([0, 0], [10, 0], [5, 3], 3)).toEqual([.5, .5]);
  expect(segmentRadiusInterval([0, 0], [10, 0], [5, 4], 3)).toBeNull();
  const forward = segmentRadiusInterval([0, 0], [10, 0], [8, 0], 3)!;
  const reverse = segmentRadiusInterval([10, 0], [0, 0], [8, 0], 3)!;
  expect(reverse[0]).toBeCloseTo(1 - forward[1]); expect(reverse[1]).toBeCloseTo(1 - forward[0]);
  expect(segmentRadiusInterval([0, 0], [0, 0], [0, 0], 0)).toEqual([0, 1]);
  expect(segmentRadiusInterval([0, 0], [0, 0], [1, 0], 0)).toBeNull();
});

it('gives the same feasible road positions when a collinear edge is subdivided', () => {
  const whole = segmentRadiusInterval([0, 0], [10, 0], [6, 2], 3)!;
  const left = segmentRadiusInterval([0, 0], [5, 0], [6, 2], 3)!;
  const right = segmentRadiusInterval([5, 0], [10, 0], [6, 2], 3)!;
  expect(left[0] / 2).toBeCloseTo(whole[0]); expect(left[1]).toBe(1);
  expect(right[0]).toBe(0); expect(.5 + right[1] / 2).toBeCloseTo(whole[1]);
});
