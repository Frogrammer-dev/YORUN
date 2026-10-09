import { describe, expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { cleanClosedLoop, findRoutes, findThinSpikes, removeSpurs } from "@/lib/route/fit";
import { PathFinder, hasEdge, project } from "@/lib/route/graph";
import { buildOverpassQuery, graphFromOverpass, type OverpassJson } from "@/lib/route/osm";
import { SHAPES, anchorsOf, SHAPE_BY_ID } from "@/lib/route/shapes";

const LAT0 = 35.15, LON0 = 129.1;
const dLat = (m: number) => m / 111_195;
const dLon = (m: number) => m / (111_195 * Math.cos((LAT0 * Math.PI) / 180));

/** n×n 격자 도로망 (간격 step m). 가로·세로 길이 교차점에서 노드를 공유한다. */
function grid(n: number, step: number, extraWays: OverpassJson["elements"] = []): { json: OverpassJson; bbox: { south: number; west: number; north: number; east: number } } {
  const els: OverpassJson["elements"] = [];
  const id = (i: number, j: number) => 1 + i * n + j;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) els.push({ type: "node", id: id(i, j), lat: LAT0 + dLat(i * step), lon: LON0 + dLon(j * step) } as never);
  let w = 100_000;
  for (let i = 0; i < n; i++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, j) => id(i, j)), tags: { highway: "residential", name: `가로${i}` } } as never);
  for (let j = 0; j < n; j++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, i) => id(i, j)), tags: { highway: "footway", name: `세로${j}` } } as never);
  els.push(...extraWays);
  const span = (n - 1) * step;
  return { json: { osm3s: { timestamp_osm_base: "2026-10-01T00:00:00Z" }, elements: els }, bbox: { south: LAT0 - dLat(10), west: LON0 - dLon(10), north: LAT0 + dLat(span + 10), east: LON0 + dLon(span + 10) } };
}

describe("OSM → 보행 그래프", () => {
  it("격자에서 노드·간선 수", () => {
    const { json, bbox } = grid(5, 100);
    const g = graphFromOverpass(json, bbox);
    expect(g.n).toBe(25);
    expect(g.edgeCount).toBe(2 * 5 * 4);
    expect(g.dataTimestamp).toBe("2026-10-01T00:00:00Z");
  });

  it("고속도로·보행 금지·사유지·(옵션) 계단 제외", () => {
    const { json, bbox } = grid(3, 100);
    const extra = (tags: Record<string, string>, k: number) => [
      { type: "node", id: 900 + k * 2, lat: LAT0 + dLat(50), lon: LON0 + dLon(50) },
      { type: "node", id: 901 + k * 2, lat: LAT0 + dLat(150), lon: LON0 + dLon(150) },
      { type: "way", id: 5000 + k, nodes: [1, 900 + k * 2, 901 + k * 2, 9], tags },
    ];
    const els = [...json.elements];
    ([{ highway: "motorway" }, { highway: "residential", foot: "no" }, { highway: "service", access: "private" }] as Record<string, string>[]).forEach((t, k) => els.push(...(extra(t, k) as never[])));
    const g = graphFromOverpass({ ...json, elements: els }, bbox);
    expect(g.n).toBe(9); // 제외된 길의 노드는 연결되지 않아 사라짐
    const steps = [...json.elements, ...(extra({ highway: "steps" }, 5) as never[])];
    expect(graphFromOverpass({ ...json, elements: steps }, bbox, { excludeSteps: true, detail: "detailed" }).n).toBe(9);
    expect(graphFromOverpass({ ...json, elements: steps }, bbox, { excludeSteps: false, detail: "detailed" }).n).toBe(11);
  });

  it("길 단순화: 보도·횡단보도·진입로·짧은 무명 골목 제외, 막다른 길 정리", () => {
    const { json, bbox } = grid(3, 100);
    const way = (id: number, tags: Record<string, string>) => [
      { type: "node", id: id * 10, lat: LAT0 + dLat(50), lon: LON0 + dLon(50) },
      { type: "way", id, nodes: [1, id * 10, 5], tags },
    ];
    const extra = [
      ...way(31, { highway: "footway", footway: "sidewalk" }),
      ...way(32, { highway: "footway", footway: "crossing" }),
      ...way(33, { highway: "service", service: "driveway" }),
      ...way(34, { highway: "service" }),
      ...way(35, { highway: "residential" }), // 이름 없고 짧은 골목
    ];
    const els = [...json.elements, ...(extra as never[])];
    expect(graphFromOverpass({ ...json, elements: els }, bbox, { excludeSteps: true, detail: "simple" }).n).toBe(9);
    // 보통: 일반 service·짧은 생활도로는 유지, 보도·횡단보도·진입로는 제외
    expect(graphFromOverpass({ ...json, elements: els }, bbox, { excludeSteps: true, detail: "normal" }).n).toBe(11);
    expect(graphFromOverpass({ ...json, elements: els }, bbox, { excludeSteps: true, detail: "detailed" }).n).toBe(14);
    // 이름 있는 생활도로는 짧아도 큰길 위주에 포함
    const named = [...json.elements, ...(way(36, { highway: "residential", name: "광안해변로" }) as never[])];
    expect(graphFromOverpass({ ...json, elements: named }, bbox, { excludeSteps: true, detail: "simple" }).n).toBe(10);
    // 막다른 길은 잘라냄
    const dead = [...json.elements, { type: "node", id: 77, lat: LAT0 - dLat(80), lon: LON0 }, { type: "way", id: 78, nodes: [1, 77], tags: { highway: "primary" } }];
    expect(graphFromOverpass({ ...json, elements: dead as never[] }, bbox, { excludeSteps: true, detail: "simple" }).n).toBe(9);
  });

  it("교량처럼 겹쳐 보여도 노드를 공유하지 않으면 연결되지 않음 (15.1)", () => {
    // 격자 위를 가로지르는 다리: 양 끝만 격자 바깥 노드, 격자 노드와 공유 없음 → 별도 요소라 제거됨
    const { json, bbox } = grid(4, 100);
    const bridge = [
      { type: "node", id: 800, lat: LAT0 + dLat(150), lon: LON0 - dLon(5) },
      { type: "node", id: 801, lat: LAT0 + dLat(150), lon: LON0 + dLon(305) },
      { type: "way", id: 7000, nodes: [800, 801], tags: { highway: "primary", bridge: "yes", layer: "1" } },
    ];
    const g = graphFromOverpass({ ...json, elements: [...json.elements, ...(bridge as never[])] }, bbox);
    expect(g.n).toBe(16);
  });

  it("Overpass 질의는 영역과 길 종류만 담음", () => {
    const q = buildOverpassQuery({ south: 35.1, west: 129.1, north: 35.12, east: 129.13 });
    expect(q).toContain("(35.100000,129.100000,35.120000,129.130000)");
    expect(q).not.toContain("motorway");
  });
});

describe("경로 탐색", () => {
  it("A*: 격자 맨해튼 거리, 연속 간선", () => {
    const { json, bbox } = grid(6, 100);
    const g = graphFromOverpass(json, bbox);
    const f = new PathFinder(g);
    const a = g.nodeIndex.nearest(...project(g.origin, LAT0, LON0), 5);
    const b = g.nodeIndex.nearest(...project(g.origin, LAT0 + dLat(500), LON0 + dLon(300)), 5);
    const p = f.route(a, b)!;
    let len = 0;
    for (let i = 1; i < p.length; i++) {
      expect(hasEdge(g, p[i - 1], p[i])).toBe(true);
      len += Math.hypot(g.x[p[i]] - g.x[p[i - 1]], g.y[p[i]] - g.y[p[i - 1]]);
    }
    expect(len).toBeCloseTo(800, -1);
  });

  it("얇은 막대(나란한 길로 나갔다 돌아오기) 감지, 넓은 돌출(귀)은 아님", () => {
    // 가로 400m 위를 가다가 x=200에서 위로 100m 나가 10m 옆 길로 돌아옴
    const stub: [number, number][] = [[0, 0], [100, 0], [200, 0], [200, 100], [210, 100], [210, 0], [300, 0], [2000, 0]];
    const sp = findThinSpikes(stub);
    expect(sp).toHaveLength(1);
    expect(sp[0]).toMatchObject({ i: 2, j: 5 });
    // 폭 150m 귀 모양 돌출은 막대가 아님
    const ear: [number, number][] = [[0, 0], [100, 0], [175, 200], [250, 0], [2000, 0]];
    expect(findThinSpikes(ear)).toHaveLength(0);
  });

  it("닫힌 코스 시작·끝에 걸친 되돌이도 정리", () => {
    // 1에서 출발해 9로 나갔다 돌아온 뒤 고리를 돌고, 마지막에 다시 9를 거쳐 1로
    expect(cleanClosedLoop([1, 9, 1, 2, 3, 4, 1])).toEqual([3, 4, 1, 2, 3]);
    const p = cleanClosedLoop([9, 1, 2, 3, 4, 1, 9]);
    expect(p[0]).toBe(p[p.length - 1]);
    expect(p).not.toContain(9);
  });

  it("되돌이 가시 제거", () => {
    expect(removeSpurs([1, 2, 3, 2, 4])).toEqual([1, 2, 4]);
    expect(removeSpurs([1, 2, 3, 4, 3, 2, 5])).toEqual([1, 2, 5]);
    expect(removeSpurs([1, 1, 2])).toEqual([1, 2]);
  });

  it("격자에서 네모 코스: 높은 유사도, 연결된 닫힌 한붓 경로, 반복 없음", () => {
    const { json, bbox } = grid(21, 50); // 1km × 1km
    const g = graphFromOverpass(json, bbox);
    const [minX, minY] = project(g.origin, bbox.south, bbox.west);
    const [maxX, maxY] = project(g.origin, bbox.north, bbox.east);
    const r = findRoutes(g, { shapes: ["square"], minMeters: 1500, maxMeters: 3500, region: { minX, minY, maxX, maxY }, budget: new StepBudget(1_000_000) });
    expect(r.candidates.length).toBeGreaterThan(0);
    const c = r.candidates[0];
    expect(c.similarity).toBeGreaterThanOrEqual(80);
    expect(c.repeatRatio).toBe(0);
    expect(c.latlngs[0]).toEqual(c.latlngs[c.latlngs.length - 1]);
    expect(c.lengthMeters).toBeGreaterThan(1200);
    expect(c.lengthMeters).toBeLessThan(4200);
    // 모든 연속 점이 실제 길(간선)로 이어져 있음: 가짜 연결선 없음
    const idx = (ll: [number, number]) => g.nodeIndex.nearest(...project(g.origin, ll[0], ll[1]), 0.5);
    for (let i = 1; i < c.latlngs.length; i++) expect(hasEdge(g, idx(c.latlngs[i - 1]), idx(c.latlngs[i]))).toBe(true);
  });

  it("영역이 거리 조건을 담기에 작으면 후보 없음", () => {
    const { json, bbox } = grid(5, 50); // 200m
    const g = graphFromOverpass(json, bbox);
    const [minX, minY] = project(g.origin, bbox.south, bbox.west);
    const [maxX, maxY] = project(g.origin, bbox.north, bbox.east);
    const r = findRoutes(g, { shapes: ["heart"], minMeters: 8000, maxMeters: 16000, region: { minX, minY, maxX, maxY }, budget: new StepBudget(1_000_000) });
    expect(r.candidates).toHaveLength(0);
  });

  it("모든 모양은 닫힌 한붓 외곽선, 기준점은 꼭짓점 포함", () => {
    for (const s of SHAPES) {
      const f = s.points[0], l = s.points[s.points.length - 1];
      expect(f).toEqual(l);
      expect(s.perimeter).toBeGreaterThan(1);
    }
    const star = SHAPE_BY_ID.star;
    const anchors = anchorsOf(star, 40);
    for (const v of star.points) expect(anchors.some((a) => Math.hypot(a[0] - v[0], a[1] - v[1]) < 1e-9)).toBe(true);
  });
});
