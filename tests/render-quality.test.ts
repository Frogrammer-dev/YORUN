import { describe, expect, it } from "vitest";
import { SHARP_RATIO, qualityGuard, startRatio } from "@/components/derby/renderQuality";

const feed = (guard: (ms: number) => boolean, ms: number, frames: number) => {
  let hits = 0;
  for (let i = 0; i < frames; i++) if (guard(ms)) hits++;
  return hits;
};

describe("3D 중계 화면 배율", () => {
  it("기기 배율을 넘지 않고 2에서 멈춘다", () => {
    expect(startRatio(1)).toBe(1);
    expect(startRatio(2.625)).toBe(SHARP_RATIO);
  });

  it("부드러운 기기에서는 낮추지 않는다", () => {
    expect(feed(qualityGuard(), 16, 600)).toBe(0);
  });

  it("느린 구간이 연달아 나오면 한 번만 낮춘다", () => {
    expect(feed(qualityGuard(), 40, 600)).toBe(1);
  });

  it("잠깐 느려진 구간 하나로는 낮추지 않는다", () => {
    const guard = qualityGuard();
    expect(feed(guard, 40, 60) + feed(guard, 16, 60) + feed(guard, 40, 60)).toBe(0);
  });

  it("탭을 내렸다 올린 긴 공백은 세지 않는다", () => {
    expect(feed(qualityGuard(), 2000, 600)).toBe(0);
  });
});
