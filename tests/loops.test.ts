import { describe, expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import { hasEdge, project } from "@/lib/route/graph";
import { buildBlocks, matchShape, traceUnion } from "@/lib/route/loops";
import { graphFromOverpass, type OverpassJson } from "@/lib/route/osm";
import { SHAPES, SHAPE_BY_ID, customShapeFromStroke } from "@/lib/route/shapes";

const LAT0 = 35.15, LON0 = 129.1;
const dLat = (m: number) => m / 111_195;
const dLon = (m: number) => m / (111_195 * Math.cos((LAT0 * Math.PI) / 180));

/** n×n 격자 도로망 (간격 step m) */
function grid(n: number, step: number) {
  const els: OverpassJson["elements"] = [];
  const id = (i: number, j: number) => 1 + i * n + j;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) els.push({ type: "node", id: id(i, j), lat: LAT0 + dLat(i * step), lon: LON0 + dLon(j * step) } as never);
  let w = 100_000;
  for (let i = 0; i < n; i++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, j) => id(i, j)), tags: { highway: "residential", name: `가로${i}` } } as never);
  for (let j = 0; j < n; j++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, i) => id(i, j)), tags: { highway: "residential", name: `세로${j}` } } as never);
  const span = (n - 1) * step;
  const bbox = { south: LAT0 - dLat(10), west: LON0 - dLon(10), north: LAT0 + dLat(span + 10), east: LON0 + dLon(span + 10) };
  const g = graphFromOverpass({ elements: els }, bbox);
  const [minX, minY] = project(g.origin, bbox.south, bbox.west);
  const [maxX, maxY] = project(g.origin, bbox.north, bbox.east);
  return { g, region: { minX, minY, maxX, maxY } };
}

describe("동네 블록과 고리 코스", () => {
  it("격자의 블록 수 = 칸 수, 블록 넓이 = 칸 넓이", () => {
    const { g, region } = grid(5, 100);
    const m = buildBlocks(g, ((region.maxX - region.minX) * (region.maxY - region.minY)) / 2);
    expect(m.faces).toHaveLength(16);
    for (const f of m.faces) {
      expect(f.area).toBeCloseTo(10_000, -2);
      expect(f.perim).toBeCloseTo(400, -1);
    }
  });

  it("이웃 블록 2×2 합집합의 테두리 = 실제 길로 이어진 닫힌 단순 고리", () => {
    const { g } = grid(5, 100);
    const m = buildBlocks(g, 1e12);
    // 왼쪽 아래 2×2 블록
    const minCx = Math.min(...m.faces.map((f) => f.cx)), minCy = Math.min(...m.faces.map((f) => f.cy));
    const low = m.faces.map((_, i) => i).filter((i) => m.faces[i].cx - minCx < 150 && m.faces[i].cy - minCy < 150);
    expect(low).toHaveLength(4);
    const inSet = new Uint8Array(m.faces.length + 1);
    for (const i of low) inSet[i] = 1;
    const path = traceUnion(g, m, inSet, low)!;
    expect(path).not.toBeNull();
    expect(path[0]).toBe(path[path.length - 1]);
    let len = 0;
    for (let i = 1; i < path.length; i++) {
      expect(hasEdge(g, path[i - 1], path[i])).toBe(true);
      len += Math.hypot(g.x[path[i]] - g.x[path[i - 1]], g.y[path[i]] - g.y[path[i - 1]]);
    }
    expect(len).toBeCloseTo(800, -1);
    expect(new Set(path.slice(0, -1)).size).toBe(path.length - 1); // 같은 점을 두 번 지나지 않음
  });

  it("구멍이 생기는 묶음(가운데 블록 빠짐)은 하나의 고리가 아니므로 null", () => {
    const { g } = grid(4, 100);
    const m = buildBlocks(g, 1e12);
    const minCx = Math.min(...m.faces.map((f) => f.cx)), minCy = Math.min(...m.faces.map((f) => f.cy));
    const center = m.faces.findIndex((f) => Math.abs(f.cx - minCx - 100) < 1 && Math.abs(f.cy - minCy - 100) < 1);
    const ring = m.faces.map((_, i) => i).filter((i) => i !== center);
    const inSet = new Uint8Array(m.faces.length + 1);
    for (const i of ring) inSet[i] = 1;
    expect(traceUnion(g, m, inSet, ring)).toBeNull();
  });

  it("모양 판정: 돌리고 키운 네모는 네모와 거의 같다", () => {
    const sq = SHAPE_BY_ID.square;
    const r = (20 * Math.PI) / 180;
    const pts = sq.points.map(([x, y]) => [500 + 800 * (x * Math.cos(r) - y * Math.sin(r)), -300 + 800 * (x * Math.sin(r) + y * Math.cos(r))] as [number, number]);
    const m = matchShape(pts, sq)!;
    expect(m.resid).toBeLessThan(0.01);
    expect(m.scale).toBeCloseTo(800, -1);
    expect(Math.abs(m.cx - 500)).toBeLessThan(5);
  });

  it("동네 추천: 격자에서 반복 없는 실제 길 고리 코스를 찾고 닮은 그림을 붙인다", () => {
    const { g, region } = grid(21, 60); // 1.2km × 1.2km
    const r = discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: 1500, maxMeters: 3500, region, budget: new StepBudget(1_000_000) });
    expect(r.candidates.length).toBeGreaterThan(0);
    const best = r.candidates[0];
    expect(best.shapeId).toBe("square");
    expect(best.similarity).toBeGreaterThanOrEqual(70);
    for (const c of r.candidates) {
      expect(c.repeatRatio).toBe(0);
      expect(c.latlngs[0]).toEqual(c.latlngs[c.latlngs.length - 1]);
      const idx = (ll: [number, number]) => g.nodeIndex.nearest(...project(g.origin, ll[0], ll[1]), 0.5);
      for (let i = 1; i < c.latlngs.length; i++) expect(hasEdge(g, idx(c.latlngs[i - 1]), idx(c.latlngs[i]))).toBe(true);
    }
  }, 60_000);

  it("직접 그린 그림으로 찾기", () => {
    const { g, region } = grid(21, 60);
    // 손으로 그린 세모 (화면 좌표, y 아래로)
    const stroke: [number, number][] = [];
    const v: [number, number][] = [[100, 10], [190, 170], [10, 170], [100, 10]];
    for (let i = 1; i < v.length; i++) for (let k = 0; k < 15; k++) stroke.push([v[i - 1][0] + ((v[i][0] - v[i - 1][0]) * k) / 15, v[i - 1][1] + ((v[i][1] - v[i - 1][1]) * k) / 15]);
    const tri = customShapeFromStroke(stroke)!;
    expect(tri.id).toBe("custom");
    expect(tri.points.length).toBe(4); // 꼭짓점 3개 + 닫는 점
    expect(Math.max(...tri.points.map((p) => p[1]))).toBeGreaterThan(0.4); // 위쪽 꼭짓점이 위(북쪽)
    const r = discoverRoutes(g, { mode: "shape", shapes: [tri], minMeters: 1500, maxMeters: 3500, region, budget: new StepBudget(1_000_000) });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.shapeId === "custom")).toBe(true);
  }, 60_000);

  it("선 하나처럼 안쪽이 없는 그림은 거절", () => {
    const line = Array.from({ length: 20 }, (_, i) => [i * 10, i * 10] as [number, number]);
    expect(customShapeFromStroke(line)).toBeNull();
  });
});
