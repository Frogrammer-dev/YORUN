import { describe, expect, it } from "vitest";
import { seededRandom } from "@/lib/battle/seed";
import { BATTLE_BOTS, BATTLE_CHOICES, BATTLE_STYLE_SHEETS, TRIAL_STATS, battleSheet, botChoice, criticalDamage, resolveTurn, startBattle, type BattleChoice, type BattleState } from "@/lib/battle/turnBattle";

const sheet = { maxHp: 100, attack: 20 };
const fresh = (hp: [number, number] = [100, 100]): BattleState => ({ ...startBattle(sheet, sheet), hp });
const play = (me: BattleChoice, foe: BattleChoice, rolls: [number, number] = [0.9, 0.9], state = fresh()) => resolveTurn(state, [me, foe], rolls);

describe("턴 판정", () => {
  it("가위바위보를 이긴 쪽만 공격하고, 비기면 아무 일도 없다", () => {
    expect(play("scissors", "paper").log.damage).toEqual([0, 20]);
    expect(play("rock", "scissors").log.damage).toEqual([0, 20]);
    expect(play("paper", "rock").log.damage).toEqual([0, 20]);
    expect(play("paper", "scissors").log.damage).toEqual([20, 0]);
    expect(play("rock", "rock").log.damage).toEqual([0, 0]);
  });
  it("이판사판 성공은 피해 없이 치명타를 넣고, 실패는 공격을 맞는다", () => {
    const success = play("allin", "rock", [0.29, 0.9]);
    expect(success.log.damage).toEqual([0, 30]);
    expect(success.log.critical[0]).toBe(true);
    const failure = play("allin", "rock", [0.3, 0.9]);
    expect(failure.log.damage).toEqual([20, 0]);
    expect(failure.log.missed[0]).toBe(true);
  });
  it("치명타는 뒤처진 체력 차이만큼 세지고, 앞설 때는 기본값이다", () => {
    expect(criticalDamage(fresh([40, 100]), 0)).toBe(60);
    expect(criticalDamage(fresh([100, 40]), 0)).toBe(30);
    expect(play("allin", "rock", [0, 0.9], fresh([40, 100])).state.hp).toEqual([40, 40]);
  });
  it("둘 다 이판사판: 혼자 성공한 쪽만 때리고, 둘 다 성공하거나 실패하면 피해가 없다", () => {
    expect(play("allin", "allin", [0, 0.9]).log.damage).toEqual([0, 30]);
    expect(play("allin", "allin", [0.9, 0]).log.damage).toEqual([30, 0]);
    expect(play("allin", "allin", [0, 0]).log.damage).toEqual([0, 0]);
    expect(play("allin", "allin", [0.9, 0.9]).log.damage).toEqual([0, 0]);
  });
  it("체력이 0이 되면 끝나고, 끝난 대결은 더 진행할 수 없다", () => {
    const finished = play("rock", "scissors", [0.9, 0.9], fresh([100, 10])).state;
    expect(finished.winner).toBe(0);
    expect(finished.hp[1]).toBe(0);
    expect(() => resolveTurn(finished, ["rock", "rock"], [0, 0])).toThrow();
  });
  it("턴 제한에 닿으면 남은 체력 비율로 승부를 낸다", () => {
    const near = { ...fresh([50, 60]), turn: 29 };
    expect(play("rock", "rock", [0.9, 0.9], near).state.winner).toBe(1);
    expect(play("rock", "rock", [0.9, 0.9], { ...fresh([60, 60]), turn: 29 }).state.winner).toBe("draw");
  });
});

describe("능력치와 봇", () => {
  it("달린 기록의 영향은 체력 90~110, 공격 18~22 안에 머문다", () => {
    expect(battleSheet({ distanceM: 0, adherence: 0 })).toEqual({ maxHp: 90, attack: 18 });
    expect(battleSheet({ distanceM: 100000, adherence: 5 })).toEqual({ maxHp: 110, attack: 22 });
  });

  const fight = (policy: (s: BattleState, r: () => number) => BattleChoice, seed: string, foe = TRIAL_STATS) => {
    const random = seededRandom(seed);
    let state = startBattle(battleSheet(TRIAL_STATS), battleSheet(foe));
    while (state.winner === null) state = resolveTurn(state, [policy(state, random), botChoice(state, 1, random)], [random(), random()]).state;
    return state;
  };
  const rate = (policy: (s: BattleState, r: () => number) => BattleChoice, foe = TRIAL_STATS) => {
    let wins = 0, turns = 0;
    const games = 20000;
    for (let i = 0; i < games; i++) {
      const end = fight(policy, `g${i}`, foe);
      if (end.winner === 0) wins++;
      else if (end.winner === "draw") wins += 0.5;
      turns += end.turn;
    }
    return { win: wins / games, turns: turns / games };
  };
  const rps = (r: () => number) => BATTLE_CHOICES[Math.floor(r() * 3)];

  // 사전 기준: 봇 상대로 가위바위보만 내도 40~60%, 이판사판만 내면 불리, 뒤처질 때만 이판사판하면 가위바위보만보다 나쁘지 않다
  it("봇 상대로 어떤 단순 전략도 압도하지 않고, 이판사판 남발은 불리하다", () => {
    const onlyRps = rate((_, r) => rps(r));
    const spam = rate(() => "allin");
    const reversal = rate((s, r) => (s.hp[1] - s.hp[0] >= 40 ? "allin" : rps(r)));
    expect(onlyRps.win).toBeGreaterThan(0.4);
    expect(onlyRps.win).toBeLessThan(0.6);
    expect(spam.win).toBeLessThan(onlyRps.win);
    expect(reversal.win).toBeGreaterThanOrEqual(onlyRps.win - 0.01);
    expect(onlyRps.turns).toBeGreaterThan(6);
    expect(onlyRps.turns).toBeLessThan(20);
  });
  it.each(BATTLE_BOTS)("$name 상대로 체험 캐릭터가 지나치게 불리하지 않다", ({ stats }) => {
    const { win } = rate((_, r) => rps(r), stats);
    expect(win).toBeGreaterThan(0.3);
    expect(win).toBeLessThan(0.7);
  });
  it("봇은 결과를 보고 고를 수 없다: 함수가 사용자의 이번 선택을 받지 않는다", () => {
    expect(botChoice.length).toBe(3);
  });
});

describe("기본 캐릭터 능력치", () => {
  // 사전 기준: 세 유형이 서로 가위바위보만 낼 때 승률이 40~60%를 벗어나지 않는다
  it.each([["speed", "corner"], ["speed", "balance"], ["balance", "corner"]] as const)("%s와 %s의 승률이 크게 기울지 않는다", (a, b) => {
    let wins = 0;
    const games = 20000;
    for (let i = 0; i < games; i++) {
      const random = seededRandom(a + b + i);
      let state = startBattle(BATTLE_STYLE_SHEETS[a], BATTLE_STYLE_SHEETS[b]);
      while (state.winner === null) state = resolveTurn(state, [BATTLE_CHOICES[Math.floor(random() * 3)], BATTLE_CHOICES[Math.floor(random() * 3)]], [random(), random()]).state;
      wins += state.winner === 0 ? 1 : state.winner === "draw" ? 0.5 : 0;
    }
    expect(wins / games).toBeGreaterThan(0.4);
    expect(wins / games).toBeLessThan(0.6);
  });
  it("달린 기록과 같은 범위에 있다", () => {
    for (const sheet of Object.values(BATTLE_STYLE_SHEETS)) {
      expect(sheet.maxHp).toBeGreaterThanOrEqual(90);
      expect(sheet.maxHp).toBeLessThanOrEqual(110);
      expect(sheet.attack).toBeGreaterThanOrEqual(18);
      expect(sheet.attack).toBeLessThanOrEqual(22);
    }
  });
});
