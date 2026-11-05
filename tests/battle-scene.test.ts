import { describe, expect, it, vi } from "vitest";
vi.mock("./battle.css", () => ({}));
import { ENTER_MS, HIT_MS, REVEAL_MS, idleView, introView, outroView, turnView, type SceneFighter } from "@/components/battle/scene";
import { deform, josa, makeCreature, toRenderLine } from "@/lib/battle/creature";
import type { TurnLog } from "@/lib/battle/turnBattle";
import { turnFx } from "@/lib/battle/turnFx";

const dogLike = [[0, 0], [4, 0], [4, -2], [3, -2], [3, -1], [1, -1], [1, -2], [0, -2]];
const fighter = (name: string): SceneFighter => ({ name, creature: makeCreature([toRenderLine(dogLike)]), maxHp: 100, attack: 20 });
const fs: [SceneFighter, SceneFighter] = [fighter("토끼"), fighter("거북")];
const log = (patch: Partial<TurnLog>): TurnLog => ({ turn: 1, choices: ["rock", "scissors"], damage: [0, 0], critical: [false, false], missed: [false, false], ...patch });

describe("생명체 그림", () => {
  it("코스 선을 0.9 상자에 맞추고 발을 0.95에 두며 닫는다", () => {
    const line = toRenderLine(dogLike);
    const ys = line.map((p) => p[1]), xs = line.map((p) => p[0]);
    expect(Math.max(...ys)).toBeCloseTo(0.95);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.9);
    expect(line[line.length - 1]).toEqual(line[0]);
  });
  it("y가 위로 가는 선의 위쪽이 화면 위쪽으로 간다", () => {
    const line = toRenderLine([[0, 10], [1, 10], [0.5, 0]]);
    expect(line[0][1]).toBeLessThan(line[2][1]);
  });
  it("머리·손·발 다섯 부위를 찾고, 부위를 옮기면 근처 선만 크게 움직인다", () => {
    const c = fs[0].creature;
    expect(Object.keys(c.parts).sort()).toEqual(["footL", "footR", "handL", "handR", "head"]);
    // 그림에 실제로 있는 부위(막대가 아닌 곳)를 옮기면 그 근처 선이 따라온다
    const name = (Object.keys(c.parts) as (keyof typeof c.parts)[]).find((k) => !c.parts[k].stub)!;
    const part = c.parts[name].at;
    const moved = deform(c, { [name]: [0.2, 0] })[0];
    const distance = (p: number[]) => Math.hypot(p[0] - part[0], p[1] - part[1]);
    const nearest = c.lines[0].reduce((best, p, i) => (distance(p) < distance(c.lines[0][best]) ? i : best), 0);
    const farthest = c.lines[0].reduce((best, p, i) => (distance(p) > distance(c.lines[0][best]) ? i : best), 0);
    expect(moved[nearest][0] - c.lines[0][nearest][0]).toBeGreaterThan(0.1);
    expect(moved[farthest][0] - c.lines[0][farthest][0]).toBeLessThan(0.05);
  });
  it("받침에 맞는 조사를 붙인다", () => {
    expect(josa("거북", "이", "가")).toBe("거북이");
    expect(josa("토끼", "이", "가")).toBe("토끼가");
    expect(josa("Bot", "이", "가")).toBe("Bot이(가)");
  });
});

describe("대결 장면", () => {
  it("상대가 먼저 등장하고 그동안 나는 보이지 않으며, 다음에 내가 등장한다", () => {
    expect(introView(fs, 100).poses[0].opacity).toBe(0);
    expect(introView(fs, 100).say).toContain("거북");
    expect(introView(fs, ENTER_MS + 100).poses[0].opacity).toBe(1);
    expect(introView(fs, ENTER_MS + 100).say).toContain("토끼");
  });
  const normal = log({ damage: [0, 20] });
  it("공개 단계에서는 낸 것을 보여 주고 체력은 그대로다", () => {
    const v = turnView(fs, 100, normal, turnFx(normal, null), [100, 100], [100, 80]);
    expect(v.picks).toEqual(["바위", "가위"]);
    expect(v.hp).toEqual([100, 100]);
  });
  it("맞는 순간부터 체력이 줄고 피해 숫자와 흔들림이 나온다", () => {
    const before = turnView(fs, REVEAL_MS + HIT_MS * 0.2, normal, turnFx(normal, null), [100, 100], [100, 80]);
    expect(before.hp).toEqual([100, 100]);
    expect(before.pop).toBeNull();
    const after = turnView(fs, REVEAL_MS + HIT_MS * 0.45, normal, turnFx(normal, null), [100, 100], [100, 80]);
    expect(after.hp).toEqual([100, 80]);
    expect(after.pop?.text).toBe("-20");
    expect(Math.hypot(after.shake[0], after.shake[1])).toBeGreaterThan(0);
  });
  const critical = log({ choices: ["allin", "rock"], damage: [0, 60], critical: [true, false] });
  it("이판사판 성공은 경직 뒤 크게 흔들리고 카메라를 당긴다", () => {
    const fx = turnFx(critical, null);
    expect(turnView(fs, REVEAL_MS + HIT_MS * 0.55, critical, fx, [40, 100], [40, 40]).impact?.stop).toBe(true);
    const later = turnView(fs, REVEAL_MS + HIT_MS * 0.7, critical, fx, [40, 100], [40, 40]);
    expect(later.impact?.stop).toBe(false);
    expect(later.cam?.z).toBeGreaterThan(1);
    expect(Math.hypot(later.shake[0], later.shake[1])).toBeGreaterThan(5);
  });
  it("이판사판 실패는 대사로 알려 주고 치명타 연출이 없다", () => {
    const failed = log({ choices: ["allin", "rock"], damage: [20, 0], missed: [true, false] });
    const v = turnView(fs, REVEAL_MS + HIT_MS * 0.3, failed, turnFx(failed, null), [100, 100], [80, 100]);
    expect(v.say).toContain("이판사판 실패");
    expect(turnView(fs, REVEAL_MS + HIT_MS * 0.6, failed, turnFx(failed, null), [100, 100], [80, 100]).impact).toBeNull();
  });
  it("비기면 체력이 그대로이고 피해 숫자가 없다", () => {
    const tie = log({ choices: ["rock", "rock"] });
    const v = turnView(fs, REVEAL_MS + HIT_MS * 0.5, tie, turnFx(tie, null), [100, 90], [100, 90]);
    expect(v.hp).toEqual([100, 90]);
    expect(v.pop).toBeNull();
    expect(v.say).toContain("비겼다");
  });
  it("승부가 나면 진 쪽이 쓰러지고 이긴 쪽 이름을 말한다", () => {
    const end = outroView(fs, 2000, 0, [40, 0]);
    expect(Math.abs(end.poses[1].rot)).toBe(90);
    expect(end.say).toContain("토끼 승리");
    expect(outroView(fs, 100, 0, [40, 0]).say).toContain("쓰러졌다");
    expect(outroView(fs, 100, "draw", [10, 10]).say).toBe("무승부!");
  });
  it("기다릴 때는 체력을 유지하고 다음 선택을 묻는다", () => {
    expect(idleView(fs, 500, [40, 70]).hp).toEqual([40, 70]);
    expect(idleView(fs, 500, [40, 70]).say).toBe("무엇을 낼까?");
  });
});
