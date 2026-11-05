import { describe, expect, it } from "vitest";
import { turnFx } from "@/lib/battle/turnFx";
import type { TurnLog } from "@/lib/battle/turnBattle";

const log = (patch: Partial<TurnLog>): TurnLog => ({ turn: 1, choices: ["rock", "scissors"], damage: [0, 0], critical: [false, false], missed: [false, false], ...patch });

describe("턴 연출 대본", () => {
  it("가위바위보를 이기면 내가 일반 공격을 한다", () => {
    expect(turnFx(log({ damage: [0, 20] }), null)).toEqual({ attacker: 0, victim: 1, damage: 20, critical: false, clash: false, knockedOut: null });
  });
  it("상대 이판사판 성공은 상대의 치명타다", () => {
    expect(turnFx(log({ damage: [60, 0], critical: [false, true] }), null)).toMatchObject({ attacker: 1, victim: 0, damage: 60, critical: true });
  });
  it("내 이판사판이 실패하면 상대의 일반 공격이고 치명타 연출이 아니다", () => {
    expect(turnFx(log({ damage: [20, 0], missed: [true, false] }), null)).toMatchObject({ attacker: 1, victim: 0, critical: false });
  });
  it("피해가 없으면 부딪치기만 한다", () => {
    expect(turnFx(log({}), null)).toMatchObject({ attacker: null, victim: null, clash: true, critical: false });
    expect(turnFx(log({ critical: [true, true] }), null)).toMatchObject({ clash: true, critical: false });
  });
  it("쓰러진 쪽을 알려 주고, 시간 제한 무승부에는 쓰러진 쪽이 없다", () => {
    expect(turnFx(log({ damage: [0, 20] }), 0).knockedOut).toBe(1);
    expect(turnFx(log({ damage: [20, 0] }), 1).knockedOut).toBe(0);
    expect(turnFx(log({}), "draw").knockedOut).toBeNull();
  });
});
