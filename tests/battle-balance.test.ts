// 밸런스 합격 기준 (docs/battle-engine.md). 입력은 합성 능력치이며 실제 사용자 밸런스의 근거가 아니다.
import { describe, expect, it } from "vitest";
import { simulateDerby, type DerbyRunner } from "@/lib/battle/derby";
import { DUEL_ACTIONS, simulateDuel, type DuelAction, type DuelPlan, type DuelStats } from "@/lib/battle/duel";
import { seededRandom } from "@/lib/battle/seed";

const GAMES = 2000;
const BASE: DuelStats = { distanceM: 5000, adherence: 0.75, climbMPerKm: 10 };

const ALL_PLANS: DuelPlan[] = [];
for (let n = 0; n < 3 ** 5; n++) {
  const plan: DuelAction[] = [];
  for (let k = 0, v = n; k < 5; k++, v = Math.floor(v / 3)) plan.push(DUEL_ACTIONS[v % 3]);
  ALL_PLANS.push(plan);
}

function duelRate(a: DuelStats, b: DuelStats, label: string) {
  const random = seededRandom(`balance:${label}`);
  const pick = () => ALL_PLANS[Math.floor(random() * ALL_PLANS.length)];
  let score = 0, draws = 0;
  for (let i = 0; i < GAMES; i++) {
    const { winner } = simulateDuel({ id: "a", stats: a, plan: pick() }, { id: "b", stats: b, plan: pick() }, `${label}:${i}`);
    if (winner === null) { draws++; score += 0.5; } else if (winner === 0) score++;
  }
  return { rate: score / GAMES, drawRate: draws / GAMES };
}

const racer = (id: string, pace: number, corner: number): DerbyRunner => ({
  id, stats: { paceSplits: new Array(10).fill(pace), avgPaceSecPerKm: pace, corners: [corner], cornering: corner },
});

function derbyRate(a: [number, number], b: [number, number], label: string) {
  let wins = 0;
  for (let i = 0; i < GAMES; i++) {
    const { entries } = simulateDerby([racer("a", ...a), racer("b", ...b)], `${label}:${i}`);
    if (entries[0].id === "a") wins++;
  }
  return wins / GAMES;
}

const report = (id: string, value: number) => console.log(`${id}: ${(value * 100).toFixed(1)}%`);

describe("듀얼 밸런스", () => {
  const d1 = duelRate({ ...BASE, climbMPerKm: 25 }, { ...BASE, climbMPerKm: 0 }, "d1");
  const d2 = duelRate({ ...BASE, distanceM: 10_000 }, { ...BASE, distanceM: 3000 }, "d2");
  const d3 = duelRate({ ...BASE, adherence: 0.9 }, { ...BASE, adherence: 0.6 }, "d3");

  it("D1 언덕 승률 50~65%", () => { report("D1", d1.rate); expect(d1.rate).toBeGreaterThanOrEqual(0.5); expect(d1.rate).toBeLessThanOrEqual(0.65); });
  it("D2 10km 승률 50~65%", () => { report("D2", d2.rate); expect(d2.rate).toBeGreaterThanOrEqual(0.5); expect(d2.rate).toBeLessThanOrEqual(0.65); });
  it("D3 일치도 0.9 승률 60~85%", () => { report("D3", d3.rate); expect(d3.rate).toBeGreaterThanOrEqual(0.6); expect(d3.rate).toBeLessThanOrEqual(0.85); });

  it("D4 페이스만 다르면 결과가 같다", () => {
    const withPace = (pace: number) => ({ ...BASE, avgPaceSecPerKm: pace, paceSplits: [pace] }) as DuelStats;
    const run = (pace: number) => simulateDuel({ id: "a", stats: withPace(pace), plan: ALL_PLANS[17] }, { id: "b", stats: BASE, plan: ALL_PLANS[201] }, "d4");
    expect(run(240)).toEqual(run(480));
  });

  // 같은 능력치에서 계획끼리 전수 대결 (시드는 대진마다 1개로 고정)
  const table = ALL_PLANS.map((p, i) => ALL_PLANS.map((q, j) => {
    const { winner } = simulateDuel({ id: "a", stats: BASE, plan: p }, { id: "b", stats: BASE, plan: q }, `table:${i}:${j}`);
    return winner === null ? 0.5 : winner === 0 ? 1 : 0;
  }));

  it("D5 특정 계획의 최고 승률 70% 이하", () => {
    const rates = table.map((row) => row.reduce((a: number, b) => a + b, 0) / row.length);
    const best = Math.max(...rates);
    console.log("D5 최고 계획:", ALL_PLANS[rates.indexOf(best)].join(","));
    report("D5", best);
    expect(best).toBeLessThanOrEqual(0.7);
  });

  it("D6 모든 계획에 이기는 상대 계획이 있다", () => {
    const unbeaten = ALL_PLANS.filter((_, i) => !table.some((row) => row[i] === 1));
    console.log("D6 무패 계획 수:", unbeaten.length);
    expect(unbeaten).toEqual([]);
  });

  it("D7 무승부 5% 이하", () => {
    const worst = Math.max(d1.drawRate, d2.drawRate, d3.drawRate);
    report("D7", worst);
    expect(worst).toBeLessThanOrEqual(0.05);
  });
});

describe("더비 밸런스", () => {
  it("R1 같은 페이스면 코너링 0.95 승률 65% 이상", () => { const v = derbyRate([360, 0.95], [360, 0.55], "r1"); report("R1", v); expect(v).toBeGreaterThanOrEqual(0.65); });
  it("R2 같은 코너링이면 5:00 승률 65% 이상", () => { const v = derbyRate([300, 0.75], [420, 0.75], "r2"); report("R2", v); expect(v).toBeGreaterThanOrEqual(0.65); });
  it("R3 1분 차이면 5:00 승률 90% 이하", () => { const v = derbyRate([300, 0.75], [360, 0.75], "r3"); report("R3", v); expect(v).toBeLessThanOrEqual(0.9); });
  it("R4 빠른 대신 거친 쪽과 느린 대신 정교한 쪽 모두 25% 이상", () => {
    const v = derbyRate([270, 0.55], [420, 0.95], "r4");
    report("R4", v);
    expect(v).toBeGreaterThanOrEqual(0.25);
    expect(v).toBeLessThanOrEqual(0.75);
  });

  it("R5 8인전에서 네 유형 모두 1위 5% 이상", () => {
    const types: Array<[string, number, number]> = [["fast", 270, 0.55], ["mid", 360, 0.75], ["precise", 420, 0.95], ["even", 330, 0.65]];
    const field = types.flatMap(([name, pace, corner]) => [racer(`${name}1`, pace, corner), racer(`${name}2`, pace, corner)]);
    const wins: Record<string, number> = { fast: 0, mid: 0, precise: 0, even: 0 };
    for (let i = 0; i < GAMES; i++) wins[simulateDerby(field, `r5:${i}`).entries[0].id.replace(/\d$/, "")]++;
    for (const [name] of types) { report(`R5 ${name}`, wins[name] / GAMES); expect(wins[name] / GAMES).toBeGreaterThanOrEqual(0.05); }
  });

  it("R6 거리만 다르면 결과가 같다", () => {
    const withDistance = (distanceM: number) => ({ ...racer("a", 360, 0.8), stats: { ...racer("a", 360, 0.8).stats, distanceM } });
    const run = (m: number) => simulateDerby([withDistance(m), racer("b", 360, 0.8)], "r6");
    expect(run(1000)).toEqual(run(20_000));
  });
});
