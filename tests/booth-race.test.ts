import { describe, expect, it } from "vitest";
import { BOOTH_STYLES, boothRaceResult, boothStats, type BoothSeat, type BoothStyle } from "@/lib/battle/boothRace";
import { seededRandom } from "@/lib/battle/seed";

const STYLES = Object.keys(BOOTH_STYLES) as BoothStyle[];
const seat = (lane: number, style: BoothStyle, seed: string, mine = false): BoothSeat => ({ lane, name: `참가자 ${lane}`, stats: boothStats(style, seededRandom(seed)), mine });

describe("boothRaceResult", () => {
  it("한 명만 있어도 연습 러너로 8레인을 채우고, 연습 러너임을 밝힌다", () => {
    const placings = boothRaceResult("race-a", [seat(1, "balance", "x", true)]);
    expect(placings.map((p) => p.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(placings.map((p) => p.lane)).size).toBe(8);
    expect(placings.filter((p) => p.mine).map((p) => p.lane)).toEqual([1]);
    expect(placings.filter((p) => p.practice)).toHaveLength(7);
    expect(placings.filter((p) => p.practice).every((p) => p.name.startsWith("연습 러너"))).toBe(true);
  });

  it("같은 경주는 다시 계산해도 결과가 같다", () => {
    const seats = [seat(1, "speed", "a", true), seat(2, "corner", "b")];
    expect(boothRaceResult("race-b", seats)).toEqual(boothRaceResult("race-b", seats));
  });

  // 사전 기준: 세 유형을 거의 같은 수(3:3:2)로 8명을 이룰 때 어느 유형도 우승의 20~50%를 벗어나지 않는다
  it("어떤 유형도 우승을 독점하거나 거의 못 하지 않는다", () => {
    const wins: Record<BoothStyle, number> = { speed: 0, balance: 0, corner: 0 };
    const races = 3000;
    for (let i = 0; i < races; i++) {
      const random = seededRandom(`balance-${i}`);
      const styles = Array.from({ length: 8 }, (_, lane) => STYLES[lane % 3]);
      const seats = styles.map((style, lane) => ({ lane: lane + 1, name: "", stats: boothStats(style, random) }));
      const winner = boothRaceResult(`balance-${i}`, seats)[0];
      wins[styles[winner.lane - 1]]++;
    }
    for (const style of STYLES) {
      expect(wins[style] / races, style).toBeGreaterThanOrEqual(0.2);
      expect(wins[style] / races, style).toBeLessThanOrEqual(0.5);
    }
  });
});
