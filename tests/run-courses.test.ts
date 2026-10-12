// 러닝 코스 찾기: 출발점에서 출발해 돌아오고, 거리 범위를 지킨다
import { describe, expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type OverpassJson } from "@/lib/route/osm";
import { discomfort, findRunningCourses } from "@/lib/route/runCourses";

const LAT0 = 37.5, LON0 = 127.0;
const dLat = (m: number) => m / 111_195;
const dLon = (m: number) => m / (111_195 * Math.cos((LAT0 * Math.PI) / 180));

/** n×n 바둑판 (간격 step m). 왼쪽 절반 세로줄은 산책로, 나머지는 생활도로 */
function grid(n: number, step: number) {
  const els: OverpassJson["elements"] = [];
  const id = (i: number, j: number) => 1 + i * n + j;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) els.push({ type: "node", id: id(i, j), lat: LAT0 + dLat(i * step), lon: LON0 + dLon(j * step) } as never);
  let w = 1_000_000;
  for (let i = 0; i < n; i++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, j) => id(i, j)), tags: { highway: "residential", name: "가" } } as never);
  for (let j = 0; j < n; j++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, i) => id(i, j)), tags: { highway: j < n / 2 ? "footway" : "residential", name: "세" } } as never);
  const span = (n - 1) * step;
  return graphFromOverpass({ elements: els } as OverpassJson, { south: LAT0 - dLat(10), west: LON0 - dLon(10), north: LAT0 + dLat(span + 10), east: LON0 + dLon(span + 10) }, { excludeSteps: true, detail: "detailed" });
}

describe("러닝 코스 찾기", () => {
  it("출발점에서 출발해 같은 곳으로 돌아오고, 거리 범위 안이다", () => {
    const g = grid(12, 150);
    const startLL: [number, number] = [LAT0 + dLat(825), LON0 + dLon(825)];
    const [sx, sy] = project(g.origin, ...startLL);
    const region = { minX: sx - 1600, minY: sy - 1600, maxX: sx + 1600, maxY: sy + 1600 };
    const r = findRunningCourses(g, { start: [sx, sy], minMeters: 2000, maxMeters: 5000, region, budget: new StepBudget(5000) });
    if ("error" in r) throw new Error("no start");
    expect(r.candidates.length).toBeGreaterThan(1);
    for (const c of r.candidates) {
      expect(c.shapeId).toBe("run");
      expect(c.lengthMeters).toBeGreaterThanOrEqual(2000);
      expect(c.lengthMeters).toBeLessThanOrEqual(5000);
      expect(c.similarity).toBeGreaterThanOrEqual(0);
      expect(c.similarity).toBeLessThanOrEqual(100);
      // 출발점에 가장 가까운 교차점(격자 간격의 절반 이내)에서 출발해 같은 곳으로 돌아온다
      expect(c.latlngs[0]).toEqual(c.latlngs[c.latlngs.length - 1]);
      expect(Math.hypot((c.latlngs[0][0] - startLL[0]) * 111_195, (c.latlngs[0][1] - startLL[1]) * 88_000)).toBeLessThan(120);
    }
  });

  it("출발점 근처에 길이 없으면 알린다", () => {
    const g = grid(6, 150);
    const r = findRunningCourses(g, { start: [50_000, 50_000], minMeters: 1000, maxMeters: 3000, region: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, budget: new StepBudget(10) });
    expect(r).toEqual({ error: "no_start" });
  });

  it("쾌적도: 큰 차도·차도·비포장이 많을수록 나쁘다", () => {
    const base = { major: 0, unpaved: 0, lit: null, litKnown: 0, steps: 0, carFree: 1, tunnels: 0 };
    expect(discomfort(base, 0)).toBe(0);
    expect(discomfort({ ...base, major: 1, carFree: 0 }, 0)).toBeCloseTo(0.6, 5);
    expect(discomfort({ ...base, unpaved: 0.5 }, 0)).toBeGreaterThan(discomfort(base, 0));
  });
});
