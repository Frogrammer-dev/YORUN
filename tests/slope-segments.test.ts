import { describe, expect, it } from "vitest";
import { slopeSegments } from "@/lib/route/elevation";

// 남북 직선 2km (위도 0.018° ≈ 2000m)
const line: [number, number][] = Array.from({ length: 41 }, (_, i) => [37 + (0.018 * i) / 40, 127]);
const dist = Array.from({ length: 21 }, (_, i) => i * 100);

describe("코스 경사 구간", () => {
  it("처음 1km는 평지, 다음 0.5km 오르막(6%), 마지막 0.5km 내리막(6%)", () => {
    const elev = dist.map((d) => (d <= 1000 ? 10 : d <= 1500 ? 10 + (d - 1000) * 0.06 : 40 - (d - 1500) * 0.06));
    const s = slopeSegments(line, { dist, elev });
    expect(s.map((x) => x.kind)).toEqual(["flat", "up", "down"]);
    // 경계는 120m 묶음 때문에 한 칸(100m) 안쪽으로 흔들릴 수 있다
    expect(Math.abs(s[0].meters - 1000)).toBeLessThanOrEqual(100);
    // 구간을 이으면 코스 전체를 빠짐없이 덮는다
    expect(s[0].latlngs[0]).toEqual(line[0]);
    expect(s.at(-1)!.latlngs.at(-1)![0]).toBeCloseTo(line.at(-1)![0], 6);
    for (let i = 1; i < s.length; i++) expect(s[i].latlngs[0]).toEqual(s[i - 1].latlngs.at(-1));
  });
  it("2m 안팎 잡음은 평지로 본다", () => {
    const elev = dist.map((_, i) => 20 + (i % 2 ? 2 : -2));
    expect(slopeSegments(line, { dist, elev }).map((x) => x.kind)).toEqual(["flat"]);
  });
  it("자료가 없으면 빈 목록", () => {
    expect(slopeSegments(line, { dist: [0], elev: [1] })).toEqual([]);
  });
});
