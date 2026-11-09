import { describe, expect, it } from "vitest";
import { DIRECTOR_PLAN, directorCut, shotFrame, type Cut, type Shot } from "@/components/derby/raceCamera";
import { TRACK } from "@/lib/battle/stadiumTrack";

const target = (lane: number, progress: number) => ({ lane, progress, size: 8, eye: { along: 0.25, height: 0.6 } });
const planTotal = DIRECTOR_PLAN.reduce((sum, item) => sum + item.ms, 0);
const cutOf = (shot: Shot, progress = 0.5): Cut => ({ id: "x", shot, subject: "leader", progress });
const moving: Shot[] = ["chase", "tele", "closeup", "low", "flank", "follow"];

describe("자동 중계 컷 편집", () => {
  it("결승선 직전에만 카메라를 세우고, 고정 카메라는 선수를 따라가지 않는다", () => {
    expect(directorCut(30_000, 11.69).shot).not.toBe("finish");
    expect(directorCut(30_000, 11.7).shot).toBe("finish");
    expect(directorCut(30_000, 12).shot).toBe("finish");
    expect(shotFrame(cutOf("finish"), target(1, 11.8))).toEqual(shotFrame(cutOf("finish"), target(8, 12)));
  });

  it("출발 직후에는 출발 장면이고, 마지막 직전은 로우앵글이다", () => {
    expect(directorCut(0, 0).shot).toBe("start");
    expect(directorCut(1000, 0.69).shot).toBe("start");
    expect(directorCut(30_000, 11.2).shot).toBe("low");
  });

  it("경기 중 샷은 모두 2~3초이고, 같은 샷이 연달아 나오지 않는다", () => {
    for (const item of DIRECTOR_PLAN) {
      expect(item.ms).toBeGreaterThanOrEqual(2000);
      expect(item.ms).toBeLessThanOrEqual(3000);
    }
    DIRECTOR_PLAN.forEach((item, i) => expect(item.shot).not.toBe(DIRECTOR_PLAN[(i + 1) % DIRECTOR_PLAN.length].shot));
    expect(new Set(DIRECTOR_PLAN.map((item) => item.shot))).toEqual(new Set(["chase", "tele", "closeup", "low", "flank"]));
  });

  it("샷이 바뀔 때만 컷 번호가 바뀌고 계획이 반복된다", () => {
    const first = DIRECTOR_PLAN[0].ms;
    expect(directorCut(first - 1, 5).id).toBe(directorCut(0, 5).id);
    expect(directorCut(first, 5).id).not.toBe(directorCut(0, 5).id);
    expect(directorCut(planTotal, 5).shot).toBe(DIRECTOR_PLAN[0].shot);
    expect(directorCut(planTotal, 5).id).not.toBe(directorCut(0, 5).id);
  });

  it("로우앵글은 선수가 카메라로 다가오고, 종이가 선으로 보이는 정면은 피한다", () => {
    // 200m 지점은 방향이 x축인 직선 위다
    const near = shotFrame(cutOf("low", 1), target(4, 2)), far = shotFrame(cutOf("low", 0), target(4, 2));
    const distance = (f: typeof near) => Math.hypot(f.position[0] - f.look[0], f.position[2] - f.look[2]);
    expect(distance(near)).toBeLessThan(distance(far));
    const offAxis = Math.atan2(Math.abs(far.position[2] - far.look[2]), Math.abs(far.position[0] - far.look[0]));
    expect(offAxis).toBeGreaterThan((30 * Math.PI) / 180);
  });

  it("어느 레인, 어느 지점에서도 카메라가 관중석이나 땅속으로 들어가지 않는다", () => {
    const standEdge = 52 - 1.2, half = TRACK.straight / 2;
    let worst = 0, lowest = Infinity;
    for (const shot of moving) for (let lane = 1; lane <= 8; lane++) for (let progress = 0; progress <= 12; progress += 0.05) {
      const [x, y, z] = shotFrame(cutOf(shot, (progress * 7) % 1), target(lane, progress)).position;
      worst = Math.max(worst, Math.abs(x) <= half ? Math.abs(z) : Math.hypot(Math.abs(x) - half, z));
      lowest = Math.min(lowest, y);
    }
    expect(worst).toBeLessThan(standEdge);
    expect(lowest).toBeGreaterThan(0.2);
  });
});
