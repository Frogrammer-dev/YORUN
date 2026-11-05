// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("three", () => ({}));
import { directorShot } from "@/components/derby/StadiumMap";

describe("자동 중계 카메라", () => {
  it("선두가 결승선 직전일 때만 결승 카메라로 간다", () => {
    expect(directorShot(11.6)).not.toBe("finish");
    expect(directorShot(11.7)).toBe("finish");
    expect(directorShot(12)).toBe("finish");
  });
  it("출발 직후에는 출발 장면이다", () => {
    expect(directorShot(0)).toBe("start");
    expect(directorShot(0.69)).toBe("start");
  });
  it("경기 중에 안쪽과 관중석 쪽 각도를 모두 쓴다", () => {
    const shots = new Set(Array.from({ length: 110 }, (_, i) => directorShot(0.7 + i * 0.1)));
    for (const shot of ["leader", "stands", "mine", "wide"] as const) expect(shots.has(shot)).toBe(true);
  });
});
