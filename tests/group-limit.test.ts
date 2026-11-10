import { describe, expect, it } from "vitest";
import { groupFromLoops } from "@/lib/route/shapes";
import { groupBudgetMs } from "@/lib/route/groupBudget";

const square = (x: number, y: number): [number, number][] => [[x, y], [x + 20, y], [x + 20, y + 20], [x, y + 20]];

describe("여러 획 그림: 획 수 제한 없음", () => {
  it("획 10개를 모두 남긴다 (예전에는 6개에서 말없이 잘렸다)", () => {
    const loops = Array.from({ length: 10 }, (_, i) => square(i * 30, 0));
    // 획 하나가 전체 폭의 약 7%라 작은 획 거르기 기준(minPartRatio)을 낮춰 둔다
    expect(groupFromLoops(loops, { order: "leftToRight", minPartRatio: 0.05 })?.parts.length).toBe(10);
  });
  it("탐색 시간: 6획까지는 예전과 같고, 더 많으면 획 수에 비례해 늘되 150초를 넘지 않는다", () => {
    expect(groupBudgetMs(1)).toBe(35_000);
    expect(groupBudgetMs(6)).toBe(35_000);
    expect(groupBudgetMs(6, 4)).toBe(75_000);
    expect(groupBudgetMs(12)).toBe(70_000);
    expect(groupBudgetMs(100)).toBe(150_000);
  });
});
