import { describe, expect, it } from "vitest";
import { describeRouteParts } from "@/lib/art/routeParts";
import type { ReferencePoint } from "@/lib/art/roadReference";

const close = (p: ReferencePoint[]): ReferencePoint[] => [...p, [...p[0]]];
const notch = close([[0, 0], [1, 0], [1, 1], [.7, 1], [.7, .5], [.3, .5], [.3, 1], [0, 1]]);
describe("stable contour pockets", () => {
  it("does not treat elongation in convex rectangles as a part", () => {
    for (const height of [.01, .1, 1, 5]) expect(describeRouteParts(close([[0, 0], [1, 0], [1, height], [0, height]])).salience).toBe(0);
  });
  it("finds one stable indentation with its depth and arc interval", () => {
    const parts = describeRouteParts(notch);
    expect(parts.stablePockets).toBe(1);
    expect(parts.pockets[0].depth).toBeGreaterThan(.3);
    expect(parts.pockets[0].depth).toBeLessThan(.4);
    expect(parts.salience).toBeGreaterThan(0);
  });
  it("preserves pocket strength under travel reversal, rotation, scale and added collinear vertices", () => {
    const dense = notch.flatMap((p, i): ReferencePoint[] => i === notch.length - 1 ? [p] : [p, [(p[0] + notch[i + 1][0]) / 2, (p[1] + notch[i + 1][1]) / 2]]);
    const angle = .731, c = Math.cos(angle), s = Math.sin(angle);
    for (const line of [notch, [...notch].reverse(), dense, notch.map(([x, y]): ReferencePoint => [3 + 2 * (x * c - y * s), 5 + 2 * (x * s + y * c)])]) {
      expect(describeRouteParts(line).stablePockets).toBe(1);
      expect(describeRouteParts(line).salience).toBeCloseTo(describeRouteParts(notch).salience, 10);
    }
  });
  it("ignores a shallow street-grid notch", () => {
    const shallow = close([[0, 0], [1, 0], [1, 1], [.7, 1], [.7, .99], [.3, .99], [.3, 1], [0, 1]]);
    expect(describeRouteParts(shallow).stablePockets).toBe(0);
  });
  it("retains the large notch when the closed route starts at another vertex", () => {
    const ring = notch.slice(0, -1);
    for (let i = 0; i < ring.length; i++) {
      const shifted = close([...ring.slice(i), ...ring.slice(0, i)]);
      expect(describeRouteParts(shifted).stablePockets).toBe(1);
      expect(describeRouteParts(shifted).salience).toBeCloseTo(describeRouteParts(notch).salience, 10);
    }
  });
  it("does not silently close an open route", () => {
    expect(describeRouteParts(notch.slice(0, -1)).salience).toBe(0);
  });
  it("handles empty, coincident and nonfinite points", () => {
    for (const line of [[], [[0, 0], [0, 0], [0, 0], [0, 0]], [[0, 0], [NaN, 0], [1, 1], [0, 0]]] as ReferencePoint[][]) {
      expect(describeRouteParts(line).salience).toBe(0);
    }
  });
});
