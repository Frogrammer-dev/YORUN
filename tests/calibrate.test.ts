import { describe, expect, it } from "vitest";
import { calibrate, pickThreshold, reliabilityTable, wilsonLower, type Judged } from "@/lib/eval/calibrate";

describe("점수 기준선 보정", () => {
  it("윌슨 하한: 표본이 적으면 비율보다 많이 낮게, 많으면 가깝게", () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(5, 5)).toBeLessThan(0.6); // 5개 다 맞아도 확실하다고 하지 않는다
    expect(wilsonLower(900, 1000)).toBeCloseTo(0.88, 2);
    expect(wilsonLower(900, 1000)).toBeLessThan(0.9);
  });

  it("점수 이상 구간마다 알아본 비율", () => {
    const items: Judged[] = [
      { score: 90, recognized: true },
      { score: 80, recognized: true },
      { score: 70, recognized: false },
      { score: 60, recognized: false },
    ];
    const t = reliabilityTable(items, [60, 80]);
    expect(t[0]).toMatchObject({ threshold: 60, n: 4, precision: 0.5 });
    expect(t[1]).toMatchObject({ threshold: 80, n: 2, precision: 1 });
  });

  it("점수가 높을수록 잘 알아보는 자료 → 등급 기준선이 차례로 올라간다", () => {
    // 점수 s일 때 알아볼 확률 = (s-20)/80 를 흉내 (점수마다 20건)
    const items: Judged[] = [];
    for (let s = 20; s <= 100; s += 2) for (let k = 0; k < 20; k++) items.push({ score: s, recognized: k < Math.round(((s - 20) / 80) * 20) });
    const { grades, table } = calibrate(items, { show: 35, fair: 50, clear: 70 });
    expect(grades.show).toBeLessThan(grades.fair);
    expect(grades.fair).toBeLessThan(grades.clear);
    // 고른 기준선 이상에서는 실제로 목표 비율 이상을 알아본다 (95% 하한 기준), 한 칸 아래는 못 미친다
    const at = (t: number) => table.find((r) => r.threshold === t)!;
    expect(at(grades.clear).lower).toBeGreaterThanOrEqual(0.8);
    expect(at(grades.clear - 1).lower).toBeLessThan(0.8);
    expect(at(grades.show).lower).toBeGreaterThanOrEqual(0.4);
  });

  it("자료가 없으면 유지, 자료가 있으나 목표를 못 맞추면 표시 거절", () => {
    const few: Judged[] = [{ score: 90, recognized: true }];
    expect(calibrate([], { show: 35, fair: 50, clear: 70 })).toMatchObject({ grades: { show: 35, fair: 50, clear: 70 }, status: "unobserved" });
    expect(calibrate(few, { show: 35, fair: 50, clear: 70 })).toMatchObject({ grades: { show: 101, fair: 101, clear: 101 }, status: "unavailable" });
    expect(pickThreshold(reliabilityTable(Array.from({ length: 50 }, () => ({ score: 99, recognized: false })), [50]), 0.4)).toBeNull();
  });
});
