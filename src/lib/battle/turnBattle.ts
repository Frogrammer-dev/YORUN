// 1대1 턴 대결: 사용자가 매 턴 직접 고르고, 상대 캐릭터는 인공지능이 고른다.
// 가위바위보를 이기면 공격한다. 이판사판은 30% 확률로 피해 없이 치명타를 넣고, 실패하면 공격을 맞는다.
// 치명타는 뒤처질수록 세진다. 수치 근거는 docs/booth-route-experiment.md의 실험 3.

import type { DuelStats } from "./duel";

export const BATTLE_CHOICES = ["scissors", "rock", "paper", "allin"] as const;
export type BattleChoice = (typeof BATTLE_CHOICES)[number];
export const CHOICE_LABELS: Record<BattleChoice, string> = { scissors: "가위", rock: "바위", paper: "보", allin: "이판사판" };

export const BATTLE_RULES = {
  allinChance: 0.3,
  /** 공격력 20 기준 치명타 = 30 + 상대와의 체력 차이 × 0.5 */
  critBase: 1.5, critGapRate: 0.5,
  hpBase: 90, hpRange: 20, hpCapKm: 12,
  attackBase: 18, attackRange: 4,
  maxTurns: 30,
} as const;

export interface BattleSheet { maxHp: number; attack: number }
export interface BattleState {
  turn: number;
  hp: [number, number];
  sheets: [BattleSheet, BattleSheet];
  winner: 0 | 1 | "draw" | null;
}
export interface TurnLog { turn: number; choices: [BattleChoice, BattleChoice]; damage: [number, number]; critical: [boolean, boolean]; missed: [boolean, boolean] }

/** 달린 기록은 조금만 반영한다. 격차가 크면 상성보다 능력치로 승부가 나기 때문이다 */
export function battleSheet(stats: Pick<DuelStats, "distanceM" | "adherence">): BattleSheet {
  const r = BATTLE_RULES;
  const km = Math.max(0, Math.min(stats.distanceM / 1000, r.hpCapKm));
  return {
    maxHp: Math.round(r.hpBase + r.hpRange * Math.sqrt(km / r.hpCapKm)),
    attack: Math.round(r.attackBase + r.attackRange * Math.max(0, Math.min(stats.adherence, 1))),
  };
}

export function startBattle(me: BattleSheet, foe: BattleSheet): BattleState {
  return { turn: 0, hp: [me.maxHp, foe.maxHp], sheets: [me, foe], winner: null };
}

export function criticalDamage(state: Pick<BattleState, "hp" | "sheets">, who: 0 | 1): number {
  const other = who === 0 ? 1 : 0;
  const gap = Math.max(0, state.hp[other] - state.hp[who]);
  return Math.round(state.sheets[who].attack * BATTLE_RULES.critBase + gap * BATTLE_RULES.critGapRate);
}

const BEATS: Record<string, string> = { scissors: "paper", rock: "scissors", paper: "rock" };

/** 한 턴을 푼다. rolls는 두 사람의 이판사판 판정 난수(0 이상 1 미만)다 */
export function resolveTurn(state: BattleState, choices: [BattleChoice, BattleChoice], rolls: [number, number]): { state: BattleState; log: TurnLog } {
  if (state.winner !== null) throw new Error("이미 끝난 대결입니다");
  const damage: [number, number] = [0, 0]; // 각자가 받는 피해
  const critical: [boolean, boolean] = [false, false];
  const missed: [boolean, boolean] = [false, false];
  const allin = choices.map((c) => c === "allin");
  allin.forEach((on, who) => {
    if (!on) return;
    critical[who] = rolls[who] < BATTLE_RULES.allinChance;
    missed[who] = !critical[who];
  });
  if (allin[0] && allin[1]) {
    // 둘 다 성공하면 서로 피해를 받지 않는 규칙이라 아무 일도 없다
    if (critical[0] !== critical[1]) damage[critical[0] ? 1 : 0] = criticalDamage(state, critical[0] ? 0 : 1);
  } else if (allin[0] || allin[1]) {
    const who = allin[0] ? 0 : 1, other = who === 0 ? 1 : 0;
    if (critical[who]) damage[other] = criticalDamage(state, who);
    else damage[who] = state.sheets[other].attack;
  } else if (BEATS[choices[0]] === choices[1]) {
    damage[1] = state.sheets[0].attack;
  } else if (BEATS[choices[1]] === choices[0]) {
    damage[0] = state.sheets[1].attack;
  }
  const hp: [number, number] = [Math.max(0, state.hp[0] - damage[0]), Math.max(0, state.hp[1] - damage[1])];
  const turn = state.turn + 1;
  let winner: BattleState["winner"] = null;
  if (hp[0] === 0) winner = 1;
  else if (hp[1] === 0) winner = 0;
  else if (turn >= BATTLE_RULES.maxTurns) {
    const ratio = [hp[0] / state.sheets[0].maxHp, hp[1] / state.sheets[1].maxHp];
    winner = ratio[0] === ratio[1] ? "draw" : ratio[0] > ratio[1] ? 0 : 1;
  }
  return { state: { ...state, turn, hp, winner }, log: { turn, choices, damage, critical, missed } };
}

/**
 * 상대 인공지능. 사용자의 이번 선택을 받지 않으므로 결과를 보고 고를 수 없다.
 * 계산상 40 이상 뒤지면 이판사판이 유리하므로 자주 쓰고, 그 외에는 거의 쓰지 않는다.
 */
export function botChoice(state: BattleState, who: 0 | 1, random: () => number): BattleChoice {
  const other = who === 0 ? 1 : 0;
  const behind = state.hp[other] - state.hp[who];
  if (random() < (behind >= 40 ? 0.7 : 0.03)) return "allin";
  return BATTLE_CHOICES[Math.floor(random() * 3)];
}

/** 대표 캐릭터를 등록한 사람이 없어도 바로 대결할 수 있게 하는 봇. 사람이 아님을 이름에 밝힌다 */
export const BATTLE_BOTS = [
  { id: "bot-steady", name: "봇 꾸준이", stats: { distanceM: 5000, adherence: 0.6 } },
  { id: "bot-marathon", name: "봇 지구력", stats: { distanceM: 12000, adherence: 0.35 } },
  { id: "bot-artist", name: "봇 그림쟁이", stats: { distanceM: 3000, adherence: 0.95 } },
] as const;

/** 달린 기록이 없는 캐릭터의 능력치. 범위는 달린 기록과 같아 상성이 승부를 좌우한다 */
export const BATTLE_STYLE_SHEETS = {
  speed: { maxHp: 92, attack: 21 },
  balance: { maxHp: 100, attack: 20 },
  corner: { maxHp: 108, attack: 18 },
} as const satisfies Record<string, BattleSheet>;

/** 대표 캐릭터가 아직 없는 사람의 체험 캐릭터 */
export const TRIAL_STATS = { distanceM: 5000, adherence: 0.6 };
