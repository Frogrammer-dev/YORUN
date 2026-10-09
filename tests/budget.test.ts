import { describe, expect, it } from "vitest";
import { StepBudget, TimeBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import { findRoutes } from "@/lib/route/fit";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type OverpassJson } from "@/lib/route/osm";
import { SHAPES } from "@/lib/route/shapes";

const LAT0 = 35.15, LON0 = 129.1;
const dLat = (m: number) => m / 111_195;
const dLon = (m: number) => m / (111_195 * Math.cos((LAT0 * Math.PI) / 180));

/** 조금 불규칙한 격자 (교차점을 살짝 흔들어 결과가 위치에 따라 달라지게) */
function jitterGrid(n: number, step: number) {
  const els: OverpassJson["elements"] = [];
  const id = (i: number, j: number) => 1 + i * n + j;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      const jx = Math.sin(i * 12.9898 + j * 78.233) * 12, jy = Math.cos(i * 4.1414 + j * 3.7) * 12;
      els.push({ type: "node", id: id(i, j), lat: LAT0 + dLat(i * step + jy), lon: LON0 + dLon(j * step + jx) } as never);
    }
  let w = 100_000;
  for (let i = 0; i < n; i++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, j) => id(i, j)), tags: { highway: "residential", name: "가" } } as never);
  for (let j = 0; j < n; j++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, i) => id(i, j)), tags: { highway: "residential", name: "세" } } as never);
  const span = (n - 1) * step;
  const bbox = { south: LAT0 - dLat(30), west: LON0 - dLon(30), north: LAT0 + dLat(span + 30), east: LON0 + dLon(span + 30) };
  const g = graphFromOverpass({ elements: els }, bbox, { excludeSteps: true, detail: "detailed" });
  const [minX, minY] = project(g.origin, bbox.south, bbox.west);
  const [maxX, maxY] = project(g.origin, bbox.north, bbox.east);
  return { g, region: { minX, minY, maxX, maxY } };
}

const summary = (cs: Array<{ id: string; similarity: number; lengthMeters: number }>) => cs.map((c) => `${c.id}:${c.similarity}:${c.lengthMeters}`);

describe("탐색 예산", () => {
  it("단계 예산: 정한 비율까지만 허용", () => {
    const b = new StepBudget(10);
    expect(b.ok()).toBe(true);
    b.spend(5);
    expect(b.ok(0.4)).toBe(false);
    expect(b.ok(0.5)).toBe(true);
    b.spend(6);
    expect(b.ok()).toBe(false);
    expect(b.remaining()).toBe(0);
  });

  it("시간 예산: 시계를 주입해 확인", () => {
    let t = 1000;
    const b = new TimeBudget(100, () => t);
    expect(b.ok()).toBe(true);
    t = 1060;
    expect(b.ok(0.5)).toBe(false);
    expect(b.remaining()).toBeCloseTo(0.4, 5);
    t = 1200;
    expect(b.ok()).toBe(false);
  });

  it("같은 입력·같은 단계 예산이면 결과가 항상 같다 (그림 맞추기)", () => {
    const { g, region } = jitterGrid(15, 80);
    const run = () => summary(findRoutes(g, { shapes: ["heart", "star"], minMeters: 2000, maxMeters: 5000, region, budget: new StepBudget(60) }).candidates);
    const a = run(), b = run();
    expect(a.length).toBeGreaterThan(0);
    expect(b).toEqual(a);
  }, 60_000);

  it("같은 입력·같은 단계 예산이면 결과가 항상 같다 (동네 추천)", () => {
    const { g, region } = jitterGrid(15, 80);
    const run = () => summary(discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: 2000, maxMeters: 5000, region, budget: new StepBudget(400) }).candidates);
    const a = run(), b = run();
    expect(b).toEqual(a);
  }, 60_000);

  it("예산이 모자라면 일부만 찾았다고 알린다", () => {
    const { g, region } = jitterGrid(15, 80);
    const r = findRoutes(g, { shapes: SHAPES.slice(0, 6), minMeters: 2000, maxMeters: 5000, region, budget: new StepBudget(5) });
    expect(r.partial).toBe(true);
  }, 60_000);
});
