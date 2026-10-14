// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { loadPlannedRoute, plannedRouteBadge, savePlannedRoute, type PlannedRoute } from "@/lib/run/storage";

afterEach(() => localStorage.clear());

const route: PlannedRoute = {
  id: "native-loop", shapeId: "doodle", shapeName: "말풍선", similarity: 0,
  latlngs: [[35, 129], [35, 129.01], [35.01, 129.01], [35, 129]],
  outline: [], lengthMeters: 3800, dataTimestamp: null, recognitionKind: "reference",
};

it("preserves native route and the interpretation marker when saving a course for running", () => {
  const before = structuredClone(route);
  expect(savePlannedRoute(route)).toBe(true);
  const restored = loadPlannedRoute();
  expect(restored).toEqual(before);
  expect(plannedRouteBadge(restored!)).toBe("AI 해석 · 실험");
  expect(plannedRouteBadge(restored!)).not.toMatch(/0%|유사도/);
  expect(route).toEqual(before);
});

it("keeps legacy routes readable and separates CLIP interpretation from the score", () => {
  expect(plannedRouteBadge({ ...route, recognitionKind: "clip", similarity: 46 })).toBe("AI 해석 · 실험");
  expect(plannedRouteBadge({ ...route, recognitionKind: undefined, shapeId: "square", similarity: 78 })).toBe("유사도 78");
  expect(plannedRouteBadge({ ...route, recognitionKind: undefined, similarity: 53 })).toBe("인식 53%");
  expect(plannedRouteBadge({ ...route, recognitionKind: undefined, shapeId: "run", similarity: 91 })).toBe("쾌적 91");
});
