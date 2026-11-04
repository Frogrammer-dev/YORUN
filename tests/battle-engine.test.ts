// 대결 엔진 동작 시험. 입력은 합성 기록이며 실제 GPS 품질이나 사용자 밸런스의 근거가 아니다.
import { describe, expect, it } from "vitest";
import { analyzeRun, MIN_BATTLE_DISTANCE_M, type BattleCourse } from "@/lib/battle/analysis";
import { DERBY_MAX_RUNNERS, derbyTrack, simulateDerby, type DerbyRunner } from "@/lib/battle/derby";
import { fighterSheet, simulateDuel, type DuelPlan, type DuelStats } from "@/lib/battle/duel";
import { emptyRecord, type RunRecord } from "@/lib/run/tracker";

const LAT = 37.5, LON = 127;
const M_LAT = 1 / 111_194.93;
const M_LON = 1 / (111_194.93 * Math.cos((LAT * Math.PI) / 180));
const at = (x: number, y: number): [number, number] => [LAT + y * M_LAT, LON + x * M_LON];

// 한 변 500m 네모, 2km
const SQUARE: [number, number][] = [[0, 0], [500, 0], [500, 500], [0, 500], [0, 0]];
const course = (extra: Partial<BattleCourse> = {}): BattleCourse => ({ latlngs: SQUARE.map(([x, y]) => at(x, y)), ascentM: 40, ...extra });

/** 꼭짓점을 따라 stepM마다 기록을 찍는다 */
function run(corners: [number, number][], secPerKm: number, stepM = 10, offset: [number, number] = [0, 0]): RunRecord {
  const seg: RunRecord["segments"][number] = [];
  let time = 1_000_000;
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1], [bx, by] = corners[i];
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.round(len / stepM));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) {
      const [lat, lon] = at(ax + ((bx - ax) * k) / n + offset[0], ay + ((by - ay) * k) / n + offset[1]);
      seg.push({ lat, lon, time });
      time += ((len / n) * secPerKm);
    }
  }
  return { ...emptyRecord(), segments: [seg] };
}

describe("analyzeRun", () => {
  it("코스를 그대로 달리면 일치도·코너링이 1이고 페이스가 맞다", () => {
    const s = analyzeRun(run(SQUARE, 360), course());
    expect(s.adherence).toBeCloseTo(1, 5);
    expect(s.corners.length).toBeGreaterThan(0);
    expect(s.cornering).toBeCloseTo(1, 5);
    expect(s.avgPaceSecPerKm).toBeCloseTo(360, 0);
    expect(s.distanceM).toBeCloseTo(2000, -1);
    expect(s.climbMPerKm).toBeCloseTo(20, 0);
    expect(s.eligible).toBe(true);
  });

  it("코스 절반만 달리면 지나간 비율이 줄고, 달린 선 자체는 코스 위다", () => {
    const s = analyzeRun(run(SQUARE.slice(0, 3), 360), course());
    expect(s.onCourse).toBeCloseTo(1, 5);
    expect(s.coverage).toBeGreaterThan(0.45);
    expect(s.coverage).toBeLessThan(0.6);
    expect(s.adherence).toBeLessThan(0.75);
  });

  it("GPS 오차 범위(10m) 치우침은 깎지 않고, 평행하게 30m 벗어나면 깎는다", () => {
    const near = analyzeRun(run(SQUARE, 360, 10, [7, 7]), course());
    const far = analyzeRun(run(SQUARE, 360, 10, [30, 30]), course());
    expect(near.adherence).toBeGreaterThan(0.95);
    expect(far.adherence).toBeLessThan(0.5);
  });

  it("코스를 벗어나 달리면 참가할 수 없다", () => {
    const away: [number, number][] = [[0, 2000], [500, 2000], [500, 2500], [0, 2500], [0, 2000]];
    const s = analyzeRun(run(away, 360), course());
    expect(s.adherence).toBe(0);
    expect(s.ineligibleReason).toBe("off-course");
  });

  it("참가 불가 사유를 구분한다", () => {
    expect(analyzeRun(run(SQUARE, 360), null).ineligibleReason).toBe("no-course");
    expect(analyzeRun(run(SQUARE, 100), course()).ineligibleReason).toBe("too-fast");
    const short = analyzeRun(run([[0, 0], [MIN_BATTLE_DISTANCE_M / 2, 0]], 360), course());
    expect(short.ineligibleReason).toBe("too-short");
    expect(analyzeRun(emptyRecord(), course()).ineligibleReason).toBe("too-short");
  });

  it("이동 구간은 지나가지 않아도 감점하지 않는다", () => {
    const withMove = course({ moves: [[2, 4]] });
    const s = analyzeRun(run(SQUARE.slice(0, 3), 360), withMove);
    expect(s.coverage).toBeCloseTo(1, 5);
  });

  it("고도를 모르면 km당 오르막은 null이다", () => {
    expect(analyzeRun(run(SQUARE, 360), course({ ascentM: null })).climbMPerKm).toBeNull();
  });

  it("앞 절반을 천천히 달리면 앞 구간 페이스가 느리다", () => {
    const slow = run([[0, 0], [500, 0]], 480).segments[0];
    const last = slow[slow.length - 1].time;
    const fast = run([[500, 0], [500, 500]], 300).segments[0].slice(1).map((f) => ({ ...f, time: f.time - 1_000_000 + last }));
    const s = analyzeRun({ ...emptyRecord(), segments: [[...slow, ...fast]] }, course());
    expect(s.paceSplits).toHaveLength(10);
    expect(s.paceSplits[0]).toBeCloseTo(480, -1);
    expect(s.paceSplits[9]).toBeCloseTo(300, -1);
  });
});

const DUEL_STATS: DuelStats = { distanceM: 5000, adherence: 0.8, climbMPerKm: 10 };
const PLAN: DuelPlan = ["strike", "pierce", "guard", "strike", "pierce"];

describe("simulateDuel", () => {
  it("같은 입력과 시드는 같은 결과, 다른 시드는 다른 수치를 낸다", () => {
    const a = { id: "a", stats: DUEL_STATS, plan: PLAN }, b = { id: "b", stats: DUEL_STATS, plan: [...PLAN].reverse() };
    expect(simulateDuel(a, b, "s1")).toEqual(simulateDuel(a, b, "s1"));
    expect(simulateDuel(a, b, "s1").turns[0].hp).not.toEqual(simulateDuel(a, b, "s2").turns[0].hp);
  });

  it("능력치는 거리·일치도·오르막에서 나오고 상한이 있다", () => {
    const low = fighterSheet({ distanceM: 1000, adherence: 0.5, climbMPerKm: 0 });
    const high = fighterSheet({ distanceM: 12_000, adherence: 1, climbMPerKm: 25 });
    expect(high.maxHp).toBeGreaterThan(low.maxHp);
    expect(high.attack).toBeGreaterThan(low.attack);
    expect(high.maxShield).toBeGreaterThan(low.maxShield);
    expect(fighterSheet({ distanceM: 99_000, adherence: 1, climbMPerKm: 999 })).toEqual(high);
  });

  it("고도를 모르면 오르막 0과 같은 기본 쉴드다", () => {
    expect(fighterSheet({ ...DUEL_STATS, climbMPerKm: null }).maxShield).toBe(fighterSheet({ ...DUEL_STATS, climbMPerKm: 0 }).maxShield);
  });

  it("상성: 방어는 강타를, 꿰뚫기는 방어를, 강타는 꿰뚫기를 이긴다", () => {
    const noShield: DuelStats = { distanceM: 5000, adherence: 0.8, climbMPerKm: 0 };
    const one = (x: DuelPlan[number], y: DuelPlan[number]) => {
      const f = (id: string, act: DuelPlan[number]) => ({ id, stats: noShield, plan: [act, act, act, act, act] as DuelPlan });
      return simulateDuel(f("x", x), f("y", y), "triangle").winner;
    };
    expect(one("guard", "strike")).toBe(0);
    expect(one("pierce", "guard")).toBe(0);
    expect(one("strike", "pierce")).toBe(0);
  });

  it("5턴이 아닌 계획은 거부한다", () => {
    expect(() => simulateDuel({ id: "a", stats: DUEL_STATS, plan: ["strike"] }, { id: "b", stats: DUEL_STATS, plan: PLAN }, "s")).toThrow();
  });
});

const runner = (id: string, pace: number, corner: number, ghost = false): DerbyRunner => ({
  id, ghost, stats: { paceSplits: new Array(10).fill(pace), avgPaceSecPerKm: pace, corners: [corner], cornering: corner },
});

describe("simulateDerby", () => {
  it("같은 입력과 시드는 같은 결과, 입력 순서도 영향이 없다", () => {
    const field = [runner("a", 300, 0.9), runner("b", 360, 0.8), runner("c", 420, 0.7)];
    expect(simulateDerby(field, "s")).toEqual(simulateDerby(field, "s"));
    expect(simulateDerby([...field].reverse(), "s").entries).toEqual(simulateDerby(field, "s").entries);
  });

  it("순위는 완주 시간 순이고 구간 기록은 늘어난다", () => {
    const { entries } = simulateDerby([runner("a", 300, 0.9), runner("b", 420, 0.5), runner("c", 360, 0.7)], "s");
    entries.forEach((e, i) => {
      expect(e.rank).toBe(i + 1);
      expect(e.splits).toHaveLength(12);
      expect(e.splits[11]).toBe(e.finishSeconds);
      e.splits.forEach((v, k) => k && expect(v).toBeGreaterThan(e.splits[k - 1]));
      if (i) expect(e.finishSeconds).toBeGreaterThanOrEqual(entries[i - 1].finishSeconds);
    });
  });

  it("트랙은 시드마다 달라도 코너 수는 같다", () => {
    const corners = (s: string) => derbyTrack(s).filter((k) => k === "corner").length;
    expect(corners("a")).toBe(6);
    expect(corners("zzz")).toBe(6);
    expect(derbyTrack("a")).not.toEqual(derbyTrack("b"));
  });

  it("고스트 표시를 유지한다", () => {
    const { entries } = simulateDerby([runner("a", 360, 0.8), runner("ghost", 360, 0.8, true)], "s");
    expect(entries.find((e) => e.id === "ghost")!.ghost).toBe(true);
    expect(entries.find((e) => e.id === "a")!.ghost).toBe(false);
  });

  it("인원 제한과 중복 id, 기록 없는 참가자를 거부한다", () => {
    expect(() => simulateDerby([runner("a", 360, 0.8)], "s")).toThrow();
    expect(() => simulateDerby(Array.from({ length: DERBY_MAX_RUNNERS + 1 }, (_, i) => runner(`r${i}`, 360, 0.8)), "s")).toThrow();
    expect(() => simulateDerby([runner("a", 360, 0.8), runner("a", 360, 0.8)], "s")).toThrow();
    expect(() => simulateDerby([runner("a", 0, 0.8), runner("b", 360, 0.8)], "s")).toThrow();
  });
});
