import { expect, it } from "vitest";
import { describeRouteHypotheses } from "@/lib/art/routeHypotheses";
import { SHAPE_BY_ID } from "@/lib/route/shapes";
import type { ReferencePoint } from "@/lib/art/roadReference";

const outline = (id: "heart" | "cat" | "car"): ReferencePoint[] => SHAPE_BY_ID[id].points.map(([x, y]) => [x, -y]);
it("matches an exact original contour without modifying its geometry", () => {
  for (const id of ["heart", "cat", "car"] as const) {
    const line = outline(id), before = structuredClone(line), kind = SHAPE_BY_ID[id].kind ?? "basic";
    const result = describeRouteHypotheses(line)[kind]!;
    expect(result.shapeId).toBe(id);
    expect(result.score).toBeLessThan(1e-8);
    expect(line).toEqual(before);
  }
});
it("retains uniform rotation/scale/reversal agreement", () => {
  const line = outline("cat"), angle = .83;
  const transformed = line.map(([x, y]): ReferencePoint => [4 + 3 * (x * Math.cos(angle) - y * Math.sin(angle)), 2 + 3 * (x * Math.sin(angle) + y * Math.cos(angle))]).reverse();
  expect(describeRouteHypotheses(transformed).animal!.shapeId).toBe("cat");
  expect(describeRouteHypotheses(transformed).animal!.score).toBeLessThan(1e-8);
});
it("penalizes a badly displaced contour section instead of accepting one plausible body", () => {
  const line = outline("cat"), damaged = line.map((p, i): ReferencePoint => [p[0] + (i === 2 ? .4 : 0), p[1]]);
  expect(describeRouteHypotheses(damaged).animal!.score).toBeGreaterThan(describeRouteHypotheses(line).animal!.score + .02);
});
it("does not repair invalid or open routes", () => {
  for (const line of [[], outline("cat").slice(0, -1), [[0, 0], [1, 0], [2, 0], [0, 0]]] as ReferencePoint[][]) expect(describeRouteHypotheses(line)).toEqual({ basic: null, animal: null, object: null });
});
