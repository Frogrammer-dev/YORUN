import { describe, expect, it } from "vitest";
import { describeRouteStructure, routeStructureDistance } from "@/lib/art/routeStructure";
import type { ReferencePoint } from "@/lib/art/roadReference";

const close = (points: ReferencePoint[]): ReferencePoint[] => [...points, [...points[0]]];
const shape = close([[0, 0], [1, 0], [1, .4], [.6, .4], [.6, 1], [0, 1]]);

describe("route part arrangement descriptor", () => {
  it("ignores rotation, translation, uniform scale and travel direction", () => {
    const transformed = shape.map(([x, y]): ReferencePoint => [3 - 2 * y, 5 + 2 * x]).reverse();
    expect(routeStructureDistance(describeRouteStructure(shape), describeRouteStructure(transformed))).toBeLessThan(1e-20);
  });
  it("ignores extra road vertices along the same segments", () => {
    const dense = shape.flatMap((p, i): ReferencePoint[] => i === shape.length - 1 ? [p] : [p, [(p[0] + shape[i + 1][0]) / 2, (p[1] + shape[i + 1][1]) / 2]]);
    expect(routeStructureDistance(describeRouteStructure(shape), describeRouteStructure(dense))).toBeLessThan(1e-20);
  });
  it("distinguishes a large indentation from an uncomplicated round outline", () => {
    const circle = close(Array.from({ length: 128 }, (_, i): ReferencePoint => [Math.cos(i * Math.PI / 64), Math.sin(i * Math.PI / 64)]));
    const a = describeRouteStructure(shape), b = describeRouteStructure(circle);
    expect(a.salience).toBeGreaterThan(b.salience + .01);
    expect(routeStructureDistance(a, b)).toBeGreaterThan(.01);
  });
  it("returns finite neutral evidence for a degenerate input", () => {
    expect(describeRouteStructure([[0, 0], [0, 0], [0, 0], [0, 0]]).salience).toBe(0);
  });
  it("exposes elongation bias: a plain thin rectangle can outrank a multipart contour", () => {
    const rectangle = close([[0, 0], [1, 0], [1, .05], [0, .05]]);
    expect(describeRouteStructure(rectangle).salience).toBeGreaterThan(describeRouteStructure(shape).salience);
  });
});
