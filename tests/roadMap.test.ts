import { describe, expect, it } from "vitest";
import { demoTrack } from "@/lib/art/artwork";
import { normalizeSegments } from "@/lib/art/normalize";
import { artFrame, roadMapLines } from "@/lib/art/roadMap";

describe("도로망 (이 기기 전용)", () => {
  it("작품 선과 같은 u·v 좌표로 투영한다", () => {
    const t = demoTrack();
    const g = normalizeSegments(t.segments);
    const f = artFrame(t.segments)!;
    t.segments[0].forEach((p, i) => {
      const [u, v] = f.toUv(p.lat, p.lon);
      expect(u).toBeCloseTo(g.sourceSegments[0][i][0], 5);
      expect(v).toBeCloseTo(g.sourceSegments[0][i][1], 5);
    });
    // 그림 창이 덮는 범위의 모서리는 u·v 0과 1
    const [u0, v0] = f.toUv(f.bbox.north, f.bbox.west);
    expect(u0).toBeCloseTo(0, 3);
    expect(v0).toBeCloseTo(0, 3);
  });

  it("창 밖 구간은 잘라내고 창 안 부분만 남긴다", () => {
    const toUv = (lat: number, lon: number): [number, number] => [lon, lat];
    const lines = roadMapLines(
      {
        elements: [
          { type: "node", id: 1, lat: 0.5, lon: -1 },
          { type: "node", id: 2, lat: 0.5, lon: 2 },
          { type: "node", id: 3, lat: 3, lon: 3 },
          { type: "node", id: 4, lat: 4, lon: 4 },
          { type: "way", id: 10, nodes: [1, 2] },
          { type: "way", id: 11, nodes: [3, 4] },
        ],
      },
      toUv,
    );
    expect(lines).toEqual([[[0, 0.5], [1, 0.5]]]);
  });
});
