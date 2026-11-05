import { describe, expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { placeShape, type Region, type RouteCandidate } from "@/lib/route/fit";
import { buildGraph, hasEdge, makeOrigin, project, unproject, type RawEdge, type RoadGraph } from "@/lib/route/graph";
import { polylineLength, singleGroup, type ShapeDef, type ShapeGroup } from "@/lib/route/shapes";
import { findStrokeRoutes } from "@/lib/route/strokeRoutes";

type XY = [number, number];
const region: Region = { minX: -1, minY: -1, maxX: 1001, maxY: 1001 };

function grid(): RoadGraph {
  const origin = makeOrigin(35.15, 129.1), lats: number[] = [], lons: number[] = [], edges: RawEdge[] = [];
  const n = 21;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const [lat, lon] = unproject(origin, x * 50, y * 50);
    lats.push(lat); lons.push(lon);
    if (x) edges.push({ a: y * n + x - 1, b: y * n + x, factor: 1 });
    if (y) edges.push({ a: (y - 1) * n + x, b: y * n + x, factor: 1 });
  }
  return buildGraph(origin, lats, lons, edges, null);
}

function shape(points: XY[], closed = false): ShapeDef {
  return {
    id: "custom", name: "내 그림", emoji: "", points, closed, corners: true,
    perimeter: polylineLength(points), features: points.slice(1, -1),
  };
}

function validate(g: RoadGraph, candidate: RouteCandidate, min: number, max: number, bounds = region) {
  const nodes = candidate.latlngs.map(([lat, lon]) => g.nodeIndex.nearest(...project(g.origin, lat, lon), 0.1));
  let draw = 0, move = 0;
  nodes.forEach((v, i) => {
    expect(v).toBeGreaterThanOrEqual(0);
    expect(g.x[v]).toBeGreaterThanOrEqual(bounds.minX);
    expect(g.x[v]).toBeLessThanOrEqual(bounds.maxX);
    expect(g.y[v]).toBeGreaterThanOrEqual(bounds.minY);
    expect(g.y[v]).toBeLessThanOrEqual(bounds.maxY);
    if (!i) return;
    expect(hasEdge(g, nodes[i - 1], v)).toBe(true);
    const length = Math.hypot(g.x[v] - g.x[nodes[i - 1]], g.y[v] - g.y[nodes[i - 1]]);
    if (candidate.moves.some(([start, end]) => i > start && i <= end)) move += length;
    else draw += length;
  });
  expect(draw).toBeGreaterThanOrEqual(min);
  expect(draw).toBeLessThanOrEqual(max);
  expect(Math.round(draw)).toBe(candidate.lengthMeters);
  expect(Math.round(move)).toBe(candidate.moveMeters);
  return nodes;
}

describe("열린 손그림의 실제 도로 탐색", () => {
  const cases: Array<[string, XY[], number, number]> = [
    ["직선", [[-0.5, 0], [0.5, 0]], 700, 1000],
    ["L", [[-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]], 1100, 1800],
    ["U", [[-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5]], 1800, 2700],
  ];
  it.each(cases)("%s: 시작·끝을 닫지 않고 실제 간선으로 거리 조건을 만족", (_name, points, minMeters, maxMeters) => {
    const g = grid(), input = shape(points);
    const result = findStrokeRoutes(g, singleGroup(input), {
      region, minMeters, maxMeters, budget: new StepBudget(100_000), maxResults: 3,
    });
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0].similarity).toBeGreaterThanOrEqual(80);
    for (const candidate of result.candidates) {
      const nodes = validate(g, candidate, minMeters, maxMeters);
      expect(nodes[0]).not.toBe(nodes[nodes.length - 1]);
      expect(candidate.moves).toEqual([]);
      expect(candidate.outline[0]).not.toEqual(candidate.outline[candidate.outline.length - 1]);
      const placed = placeShape(input.points, candidate.placement);
      // Both original endpoints remain the exact nearest road junctions, in drawing order.
      expect(nodes[0]).toBe(g.nodeIndex.nearest(...placed[0], 200));
      expect(nodes[nodes.length - 1]).toBe(g.nodeIndex.nearest(...placed[placed.length - 1], 200));
    }
  });

  it("떨어진 두 열린 획은 순서대로 연결하고 이동 거리를 그림 거리에서 제외", () => {
    const g = grid();
    const group: ShapeGroup = {
      id: "custom", name: "두 선",
      parts: [
        { shape: shape([[-0.5, 0], [0.5, 0]]), ox: 0, oy: 0.4, s: 0.6 },
        { shape: shape([[-0.5, 0], [0.5, 0]]), ox: 0, oy: -0.4, s: 0.6 },
      ],
    };
    const result = findStrokeRoutes(g, group, { region, minMeters: 900, maxMeters: 1200, budget: new StepBudget(100_000) });
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      const nodes = validate(g, candidate, 900, 1200);
      expect(nodes[0]).not.toBe(nodes[nodes.length - 1]);
      expect(candidate.moves).toHaveLength(1);
      expect(candidate.outlines).toHaveLength(2);
      expect(candidate.moveMeters).toBeGreaterThan(0);
      const [start, end] = candidate.moves[0];
      expect(start).toBeGreaterThan(0);
      expect(end).toBeLessThan(nodes.length - 1);
      // The connector leaves the first stroke's end and enters the second stroke's start.
      for (const [point, node] of [
        [candidate.outlines[0].at(-1)!, nodes[start]],
        [candidate.outlines[1][0], nodes[end]],
      ] as Array<[XY, number]>) {
        expect(node).toBe(g.nodeIndex.nearest(...project(g.origin, ...point), 200));
      }
    }
  });

  it("열린 획과 닫힌 획을 함께 배치해도 각각의 입력 끝점이 유지됨", () => {
    const g = grid();
    const group: ShapeGroup = {
      id: "custom", name: "선과 네모",
      parts: [
        { shape: shape([[-0.5, 0], [0.5, 0]]), ox: 0, oy: 0.4, s: 0.8 },
        { shape: shape([[-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], true), ox: 0, oy: -0.25, s: 0.4 },
      ],
    };
    const result = findStrokeRoutes(g, group, { region, minMeters: 1600, maxMeters: 2200, budget: new StepBudget(100_000) });
    expect(result.candidates.length).toBeGreaterThan(0);
    const c = result.candidates[0], nodes = validate(g, c, 1600, 2200);
    expect(c.outlines[0][0]).not.toEqual(c.outlines[0].at(-1));
    expect(c.outlines[1][0]).toEqual(c.outlines[1].at(-1));
    expect(nodes[c.moves[0][1]]).toBe(nodes.at(-1));
    expect(nodes[0]).not.toBe(nodes.at(-1));
  });

  it("연결이 끊긴 두 도로 사이에 가짜 직선을 추가하지 않음", () => {
    const g = grid();
    // Keep both components in the graph/index, removing every edge across the middle.
    const adjStart = new Int32Array(g.n + 1), adjTo: number[] = [], adjLen: number[] = [], adjCost: number[] = [], adjFlags: number[] = [];
    for (let u = 0; u < g.n; u++) {
      for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
        const v = g.adjTo[k];
        if ((g.x[u] < 475) !== (g.x[v] < 475)) continue;
        adjTo.push(v); adjLen.push(g.adjLen[k]); adjCost.push(g.adjCost[k]); adjFlags.push(g.adjFlags[k]);
      }
      adjStart[u + 1] = adjTo.length;
    }
    const disconnected: RoadGraph = {
      ...g, adjStart, adjTo: Int32Array.from(adjTo), adjLen: Float32Array.from(adjLen),
      adjCost: Float32Array.from(adjCost), adjFlags: Uint8Array.from(adjFlags),
    };
    const result = findStrokeRoutes(disconnected, singleGroup(shape([[-0.5, 0], [0.5, 0]])), {
      region: { ...region, minY: 449, maxY: 551 }, minMeters: 850, maxMeters: 1000, budget: new StepBudget(100_000),
    });
    expect(result.candidates).toEqual([]);
  });

  it("시간·단계 예산을 소진하면 탐색 중단을 표시", () => {
    const g = grid(), input = singleGroup(shape([[-0.5, 0], [0.5, 0]]));
    const budget = new StepBudget(12);
    const result = findStrokeRoutes(g, input, { region, minMeters: 700, maxMeters: 1000, budget });
    expect(result.partial).toBe(true);
    expect(budget.spent).toBeLessThanOrEqual(12);
    expect(findStrokeRoutes(g, input, { region, minMeters: 700, maxMeters: 1000, timeBudgetMs: -1 })).toMatchObject({
      candidates: [], partial: true, evaluated: 0,
    });
  });

  it("배치할 수 없거나 유효하지 않은 거리 범위에는 후보 없음", () => {
    const g = grid(), input = singleGroup(shape([[-0.5, 0], [0.5, 0]]));
    for (const [minMeters, maxMeters] of [[3000, 4000], [1000, 500], [0, 500]]) {
      expect(findStrokeRoutes(g, input, { region, minMeters, maxMeters, budget: new StepBudget(1000) }).candidates).toEqual([]);
    }
  });
});
