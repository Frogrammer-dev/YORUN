import { describe, expect, it } from "vitest";
import { dateCandidates, haversineMeters, segmentDistances, trackDistanceMeters } from "@/lib/gpx/metrics";
import type { GpxTrack } from "@/lib/gpx/parser";

describe("TrackMetrics", () => {
  it("적도 경도 1도 ≈ 111.19km", () => {
    expect(haversineMeters({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(111_194.9, 0);
  });

  it("경도 차이를 [-π, π]로 정리", () => {
    expect(haversineMeters({ lat: 0, lon: 179.9 }, { lat: 0, lon: -179.9 })).toBeLessThan(23_000);
  });

  it("구간 사이 공백은 합산하지 않고 단일점 구간은 0 (AT-03, AT-05)", () => {
    const t: GpxTrack = {
      index: 0,
      name: null,
      pointCount: 5,
      segments: [
        [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.001 },
        ],
        [{ lat: 10, lon: 10 }],
        [
          { lat: 0, lon: 0.002 },
          { lat: 0, lon: 0.003 },
        ],
      ],
    };
    const segs = segmentDistances(t);
    expect(segs[1]).toBe(0);
    expect(trackDistanceMeters(t)).toBeCloseTo(segs[0] + segs[2], 6);
    expect(trackDistanceMeters(t)).toBeLessThan(250);
  });

  it("날짜 후보는 유효한 고유 날짜만", () => {
    const t: GpxTrack = {
      index: 0,
      name: null,
      pointCount: 3,
      segments: [
        [
          { lat: 0, lon: 0, time: "2026-10-01T01:00:00Z" },
          { lat: 0, lon: 0, time: "2026-10-01T02:00:00Z" },
          { lat: 0, lon: 0, time: "bad" },
        ],
      ],
    };
    expect(dateCandidates(t, "UTC")).toEqual(["2026-10-01"]);
  });
});
