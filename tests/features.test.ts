import { describe, expect, it } from "vitest";
import { binarize, traceOutlines } from "@/lib/art/trace";
import { ascentOf, sampleAlong } from "@/lib/route/elevation";
import { EDGE_LIT, EDGE_MAJOR, EDGE_STEPS, EDGE_UNPAVED, hasEdge, project, roadStats } from "@/lib/route/graph";
import { findGroupRoutes } from "@/lib/route/group";
import { graphFromOverpass, mergeOverpass, splitBBox, wayFlags, type OverpassJson } from "@/lib/route/osm";
import { groupFromLoops } from "@/lib/route/shapes";

const LAT0 = 35.15, LON0 = 129.1;
const dLat = (m: number) => m / 111_195;
const dLon = (m: number) => m / (111_195 * Math.cos((LAT0 * Math.PI) / 180));

function gridJson(n: number, step: number, tags: (i: number, horizontal: boolean) => Record<string, string> = () => ({ highway: "residential", name: "길" })) {
  const els: OverpassJson["elements"] = [];
  const id = (i: number, j: number) => 1 + i * n + j;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) els.push({ type: "node", id: id(i, j), lat: LAT0 + dLat(i * step), lon: LON0 + dLon(j * step) } as never);
  let w = 100_000;
  for (let i = 0; i < n; i++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, j) => id(i, j)), tags: tags(i, true) } as never);
  for (let j = 0; j < n; j++) els.push({ type: "way", id: w++, nodes: Array.from({ length: n }, (_, i) => id(i, j)), tags: tags(j, false) } as never);
  const span = (n - 1) * step;
  const bbox = { south: LAT0 - dLat(10), west: LON0 - dLon(10), north: LAT0 + dLat(span + 10), east: LON0 + dLon(span + 10) };
  return { json: { elements: els } as OverpassJson, bbox };
}

describe("길 정보", () => {
  it("OSM 태그 → 길 성격", () => {
    expect(wayFlags({ highway: "secondary" }) & EDGE_MAJOR).toBeTruthy();
    expect(wayFlags({ highway: "residential" }) & EDGE_MAJOR).toBe(0);
    expect(wayFlags({ highway: "path", surface: "gravel" }) & EDGE_UNPAVED).toBeTruthy();
    expect(wayFlags({ highway: "footway", surface: "asphalt" }) & EDGE_UNPAVED).toBe(0);
    expect(wayFlags({ highway: "footway", lit: "yes" }) & EDGE_LIT).toBeTruthy();
    expect(wayFlags({ highway: "steps" }) & EDGE_STEPS).toBeTruthy();
  });

  it("비포장 빼기·코스 길 성격 비율", () => {
    // 짝수 번째 가로줄은 비포장, 세로줄은 큰길+가로등
    const { json, bbox } = gridJson(5, 100, (i, h): Record<string, string> => (h ? { highway: "residential", name: "가", ...(i % 2 ? {} : { surface: "dirt" }) } : { highway: "tertiary", name: "세", lit: "yes" }));
    const all = graphFromOverpass(json, bbox, { excludeSteps: true, detail: "detailed" });
    const paved = graphFromOverpass(json, bbox, { excludeSteps: true, detail: "detailed", avoidUnpaved: true });
    expect(paved.edgeCount).toBeLessThan(all.edgeCount);
    // 왼쪽 아래 한 칸 둘레: 가로 2변(0번 줄 비포장, 1번 줄 포장) + 세로 2변(큰길·가로등)
    const at = (i: number, j: number) => all.nodeIndex.nearest(...project(all.origin, LAT0 + dLat(i * 100), LON0 + dLon(j * 100)), 1);
    const loop = [at(0, 0), at(0, 1), at(1, 1), at(1, 0), at(0, 0)];
    for (let k = 1; k < loop.length; k++) expect(hasEdge(all, loop[k - 1], loop[k])).toBe(true);
    const s = roadStats(all, loop);
    expect(s.unpaved).toBeCloseTo(0.25, 2);
    expect(s.major).toBeCloseTo(0.5, 2);
    expect(s.lit).toBe(1); // 가로등 정보가 있는 길(세로줄)은 모두 가로등 있음
    expect(s.litKnown).toBeCloseTo(0.5, 2);
  });

  it("고도: 거리 기준 고른 표본, 잔물결은 오르막에서 뺀다", () => {
    const { pts, dist } = sampleAlong([[35, 129], [35.01, 129]], 11);
    expect(pts).toHaveLength(11);
    expect(dist[10]).toBeCloseTo(1112, -1);
    expect(pts[5][0]).toBeCloseTo(35.005, 5);
    expect(ascentOf([10, 11, 10, 11, 10, 20, 15, 30])).toBe(25); // ±1m 흔들림은 무시, 10→20, 15→30
  });
});

describe("넓은 영역", () => {
  it("영역을 5km 이하 칸으로 나눈다", () => {
    const b = { south: 37.4, west: 127.0, north: 37.4 + dLat(12_000), east: 127.0 + dLon(12_000) };
    const tiles = splitBBox(b, 5000);
    expect(tiles).toHaveLength(9);
    expect(tiles[0].south).toBe(b.south);
    expect(tiles[8].north).toBeCloseTo(b.north, 9);
  });

  it("칸 경계에 겹친 길·점은 한 번만 합친다", () => {
    const a = JSON.stringify({ osm3s: { timestamp_osm_base: "t" }, elements: [{ type: "node", id: 1 }, { type: "node", id: 2 }, { type: "way", id: 9 }] });
    const b = JSON.stringify({ elements: [{ type: "node", id: 2 }, { type: "node", id: 3 }, { type: "way", id: 9 }] });
    const m = mergeOverpass([a, b]);
    expect(m.elements).toHaveLength(4);
    expect(m.osm3s?.timestamp_osm_base).toBe("t");
  });
});

describe("글자·이미지 윤곽", () => {
  it("구멍 있는 도형(고리)은 바깥 윤곽만", () => {
    const w = 20, h = 20, m = new Uint8Array(w * h);
    for (let y = 3; y < 17; y++) for (let x = 3; x < 17; x++) m[y * w + x] = x < 7 || x > 12 || y < 7 || y > 12 ? 1 : 0;
    const out = traceOutlines(m, w, h);
    expect(out).toHaveLength(1);
    const xs = out[0].map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(3, 5); // 픽셀 경계를 따라감
    expect(Math.max(...xs)).toBeCloseTo(17, 5);
  });

  it("떨어진 두 덩어리 → 윤곽 두 개 (큰 것부터)", () => {
    const w = 30, h = 10, m = new Uint8Array(w * h);
    for (let y = 2; y < 8; y++) {
      for (let x = 2; x < 8; x++) m[y * w + x] = 1;
      for (let x = 12; x < 26; x++) m[y * w + x] = 1;
    }
    const out = traceOutlines(m, w, h);
    expect(out).toHaveLength(2);
    expect(Math.min(...out[0].map((p) => p[0]))).toBeGreaterThan(10);
  });

  it("밝은 배경의 어두운 그림을 흑백으로", () => {
    const g = new Uint8Array([250, 250, 20, 30, 240, 10]);
    expect([...binarize(g)]).toEqual([0, 0, 1, 1, 0, 1]);
  });

  it("여러 획 그림: 획 위치·크기 보존, 작은 점은 버림, 왼쪽부터", () => {
    const sq = (x: number, s: number): [number, number][] => [[x, 0], [x + s, 0], [x + s, s], [x, s]];
    const g = groupFromLoops([sq(200, 100), sq(0, 100), sq(150, 5)], { order: "leftToRight" })!;
    expect(g.parts).toHaveLength(2);
    expect(g.parts[0].ox).toBeLessThan(g.parts[1].ox);
    expect(g.parts[0].s).toBeCloseTo(100 / 300, 3);
  });
});

describe("여러 획 코스", () => {
  it("떨어진 네모 두 개: 획마다 실제 길 고리 + 이동 구간 하나", () => {
    const { json, bbox } = gridJson(31, 50); // 1.5km × 1.5km
    const g = graphFromOverpass(json, bbox, { excludeSteps: true, detail: "detailed" });
    const [minX, minY] = project(g.origin, bbox.south, bbox.west);
    const [maxX, maxY] = project(g.origin, bbox.north, bbox.east);
    const sq = (x: number): [number, number][] => [[x, 0], [x + 100, 0], [x + 100, 100], [x, 100]];
    const group = groupFromLoops([sq(0), sq(160)], { order: "given", name: "네모 둘" })!;
    const r = findGroupRoutes(g, group, { minMeters: 1500, maxMeters: 4000, region: { minX, minY, maxX, maxY }, timeBudgetMs: 120_000 });
    expect(r.candidates.length).toBeGreaterThan(0);
    const c = r.candidates[0];
    expect(c.moves).toHaveLength(1);
    expect(c.outlines).toHaveLength(2);
    expect(c.similarity).toBeGreaterThanOrEqual(70);
    expect(c.moveMeters).toBeGreaterThan(0);
    // 이동 구간 포함 모든 연속 점이 실제 길로 이어짐
    const idx = (ll: [number, number]) => g.nodeIndex.nearest(...project(g.origin, ll[0], ll[1]), 0.5);
    for (let i = 1; i < c.latlngs.length; i++) expect(hasEdge(g, idx(c.latlngs[i - 1]), idx(c.latlngs[i]))).toBe(true);
    // 첫 획은 닫힌 고리: 이동 구간 시작점 = 첫 점
    expect(c.latlngs[c.moves[0][0]]).toEqual(c.latlngs[0]);
  }, 120_000);
});
