// 코스 품질 회귀 테스트: 고정한 실제 지도 데이터에서 단계 예산(결정적)으로 코스를 찾고,
// 저장된 기준선보다 품질이 나빠지면 실패한다. 알고리즘을 고친 뒤 나아졌다면 기준선을 갱신한다:
//   UPDATE_BASELINE=1 npx vitest run tests/quality-baseline.test.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import { findRoutes, type RouteCandidate } from "@/lib/route/fit";
import { hasEdge, project, type RoadGraph } from "@/lib/route/graph";
import { graphFromOverpass, type BBox, type OverpassJson } from "@/lib/route/osm";
import { SHAPES, type ShapeId } from "@/lib/route/shapes";

const FIXTURES = ["gangnam-center", "gangnam-southwest"];
const BASELINE = "tests/fixtures/quality-baseline.json";
const UPDATE = process.env.UPDATE_BASELINE === "1";
/** 유사도는 이만큼까지 떨어져도 봐준다 (점수 반올림·작은 변동) */
const SIM_TOLERANCE = 2;
const FIT_SHAPES: ShapeId[] = ["heart", "star", "square", "cat"];

interface Metrics {
  fit: Record<string, { similarity: number; zigzagPerKm: number }>;
  discover: { count: number; top: number; top5: number };
}

const baseline: Record<string, Metrics> = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : {};
const measured: Record<string, Metrics> = {};

function load(name: string): { g: RoadGraph; region: { minX: number; minY: number; maxX: number; maxY: number } } {
  const json = JSON.parse(gunzipSync(readFileSync(`tests/fixtures/osm/${name}.json.gz`)).toString("utf8")) as OverpassJson & { bbox: BBox };
  const g = graphFromOverpass(json, json.bbox, { excludeSteps: true, detail: "simple" });
  const [minX, minY] = project(g.origin, json.bbox.south, json.bbox.west);
  const [maxX, maxY] = project(g.origin, json.bbox.north, json.bbox.east);
  return { g, region: { minX, minY, maxX, maxY } };
}

/** 모든 코스가 실제 길로만 이어진 닫힌 경로인가 (가짜 연결선 없음) */
function expectRealLoops(g: RoadGraph, cs: RouteCandidate[]) {
  for (const c of cs) {
    expect(c.latlngs[0]).toEqual(c.latlngs[c.latlngs.length - 1]);
    const idx = (ll: [number, number]) => g.nodeIndex.nearest(...project(g.origin, ll[0], ll[1]), 0.5);
    for (let i = 1; i < c.latlngs.length; i++) expect(hasEdge(g, idx(c.latlngs[i - 1]), idx(c.latlngs[i]))).toBe(true);
  }
}

describe.each(FIXTURES)("코스 품질 기준선: %s", (name) => {
  const { g, region } = load(name);
  const m: Metrics = { fit: {}, discover: { count: 0, top: 0, top5: 0 } };
  measured[name] = m;
  const base = baseline[name];

  it("그림 맞추기 (하트·별·네모·고양이)", () => {
    const r = findRoutes(g, { shapes: FIT_SHAPES, minMeters: 3000, maxMeters: 8000, region, resultsPerShape: 1, budget: new StepBudget(400) });
    expectRealLoops(g, r.candidates);
    for (const id of FIT_SHAPES) {
      const c = r.candidates.find((x) => x.shapeId === id);
      m.fit[id] = { similarity: c?.similarity ?? 0, zigzagPerKm: c?.zigzagPerKm ?? 99 };
      if (!UPDATE && base) expect(m.fit[id].similarity, `${id} 유사도`).toBeGreaterThanOrEqual(base.fit[id].similarity - SIM_TOLERANCE);
    }
  }, 180_000);

  it("동네 추천", () => {
    const r = discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: 3000, maxMeters: 8000, region, budget: new StepBudget(2500) });
    expectRealLoops(g, r.candidates);
    for (const c of r.candidates) expect(c.repeatRatio).toBe(0);
    const sims = r.candidates.map((c) => c.similarity).sort((a, b) => b - a);
    m.discover = { count: sims.length, top: sims[0] ?? 0, top5: Math.round((sims.slice(0, 5).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(5, sims.length))) * 10) / 10 };
    if (!UPDATE && base) {
      expect(m.discover.top, "최고 유사도").toBeGreaterThanOrEqual(base.discover.top - SIM_TOLERANCE);
      expect(m.discover.top5, "상위 5개 평균").toBeGreaterThanOrEqual(base.discover.top5 - SIM_TOLERANCE);
      expect(m.discover.count, "코스 수").toBeGreaterThanOrEqual(base.discover.count - 2);
    }
  }, 180_000);
});

afterAll(() => {
  if (UPDATE || !existsSync(BASELINE)) writeFileSync(BASELINE, JSON.stringify(measured, null, 2) + "\n");
});
