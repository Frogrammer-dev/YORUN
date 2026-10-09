import { describe, expect, it } from "vitest";
import { buildArtwork, buildDemoArtwork } from "@/lib/art/artwork";
import { normalizeSegments, renderLines } from "@/lib/art/normalize";
import { rdpIndices } from "@/lib/art/rdp";
import { ImportError } from "@/lib/gpx/errors";
import type { GpxPoint } from "@/lib/gpx/parser";
import { m } from "./helpers";

const P = ([lat, lon]: [number, number]): GpxPoint => ({ lat, lon });
const code = (f: () => unknown) => {
  try {
    f();
    return "ok";
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
};

describe("ArtNormalizer", () => {
  it("가로·세로 비율을 유지하고 북쪽이 위 (AT-06)", () => {
    const g = normalizeSegments([[m(0, 0), m(2000, 0), m(2000, 1000), m(0, 1000), m(0, 0)].map(P)]);
    const pts = g.sourceSegments[0];
    const w = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
    const h = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
    expect(w).toBeCloseTo(0.9, 3);
    expect(h).toBeCloseTo(0.45, 2);
    expect(pts[1][0]).toBeGreaterThan(pts[0][0]); // 동쪽 → x 증가
    expect(pts[2][1]).toBeLessThan(pts[1][1]); // 북쪽 → 화면 위
  });

  it("u·v는 [0.05, 0.95] 범위", () => {
    const { view } = buildDemoArtwork();
    for (const p of view.geometry!.sourceSegments.flat()) {
      for (const c of p) {
        expect(c).toBeGreaterThanOrEqual(0.05);
        expect(c).toBeLessThanOrEqual(0.95);
      }
    }
  });

  it("수직선은 0폭이어도 안전하게 처리 (AT-06)", () => {
    const g = normalizeSegments([[m(0, 0), m(0, 500)].map(P)]);
    expect(g.sourceSegments[0][0][0]).toBe(0.5);
    expect(g.sourceSegments[0][1][0]).toBe(0.5);
  });

  it("모든 점이 같은 위치면 거절 (AT-06)", () => {
    expect(code(() => normalizeSegments([[m(0, 0), m(0, 0)].map(P), [m(0, 0)].map(P)]))).toBe("degenerate");
  });

  it("왕복·재방문 순서를 그대로 유지 (AT-06)", () => {
    const g = normalizeSegments([[m(0, 0), m(100, 0), m(0, 0), m(100, 0)].map(P)]);
    expect(g.sourceSegments[0].map((p) => p[0])).toEqual([0.05, 0.95, 0.05, 0.95]);
  });

  it("구간을 합치지 않고 연결선도 만들지 않음 (AT-05)", () => {
    const g = normalizeSegments([[m(0, 0), m(100, 0)].map(P), [m(500, 500), m(600, 500)].map(P)]);
    expect(g.sourceSegments).toHaveLength(2);
    expect(renderLines(g)).toHaveLength(2);
  });

  it("50km 초과·극지·날짜변경선은 거절 (AT-09)", () => {
    expect(code(() => normalizeSegments([[m(0, 0), m(60_000, 0)].map(P)]))).toBe("out_of_range");
    expect(
      code(() =>
        normalizeSegments([
          [
            { lat: 85, lon: 0 },
            { lat: 85.001, lon: 0 },
          ],
        ]),
      ),
    ).toBe("polar");
    expect(
      code(() =>
        normalizeSegments([
          [
            { lat: 0, lon: 179.99 },
            { lat: 0, lon: -179.99 },
          ],
        ]),
      ),
    ).toBe("antimeridian");
  });

  it("전시 인덱스: 오름차순·끝점 포함·단일점은 [0]", () => {
    const g = normalizeSegments([[m(0, 0), m(50, 0.5), m(100, 0), m(100, 100)].map(P), [m(300, 300)].map(P)]);
    expect(g.renderIndices[0][0]).toBe(0);
    expect(g.renderIndices[0].at(-1)).toBe(3);
    expect(g.renderIndices[0]).not.toContain(1); // 0.5m 벗어난 점은 2m 허용 오차로 생략
    expect(g.renderIndices[1]).toEqual([0]);
  });

  it("2m 기준 전시 점이 2,000개를 넘으면 오차를 늘리지 않고 거절", () => {
    const zig = Array.from({ length: 4500 }, (_, i) => P(m(i * 5, i % 2 ? 10 : 0)));
    expect(code(() => normalizeSegments([zig]))).toBe("render_limit");
  });

  it("작품 요청에 원 위경도·트랙 이름·점별 시각이 없음 (AT-11)", () => {
    const { request } = buildArtwork({
      index: 0,
      name: "집 앞 코스",
      pointCount: 2,
      segments: [
        [
          { lat: 35.123456, lon: 129.654321, time: "2026-10-01T00:00:00Z" },
          { lat: 35.124, lon: 129.655 },
        ],
      ],
    });
    const json = JSON.stringify(request);
    expect(json).not.toContain("35.12");
    expect(json).not.toContain("129.65");
    expect(json).not.toContain("2026-10-01T");
    expect(json).not.toContain("집 앞");
    expect(Object.keys(request).sort()).toEqual(["clientRequestId", "geometry", "sourceKind", "stats", "title"]);
  });
});

describe("RDP", () => {
  it("직선 위의 점은 제거하고 끝점은 보존", () => {
    expect(
      rdpIndices(
        [
          [0, 0],
          [1, 0],
          [2, 0],
          [3, 0],
        ],
        0.1,
      ),
    ).toEqual([0, 3]);
    expect(
      rdpIndices(
        [
          [0, 0],
          [1, 5],
          [2, 0],
        ],
        1,
      ),
    ).toEqual([0, 1, 2]);
    expect(rdpIndices([[0, 0]], 1)).toEqual([0]);
  });
});
