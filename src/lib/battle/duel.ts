// 모드 A: 1대1 아티스틱 듀얼 (턴제, 양쪽이 5턴 행동을 미리 낸다)
// 일치도 = 공격력, 코스 오르막 = 쉴드, 거리 = 체력. 페이스는 쓰지 않는다.

import { seededRandom } from "./seed";
import type { RunStats } from "./analysis";

export const DUEL_TURNS = 5;
export type DuelAction = "strike" | "pierce" | "guard";
export type DuelPlan = readonly DuelAction[];
export const DUEL_ACTIONS: readonly DuelAction[] = ["strike", "pierce", "guard"];

export const DUEL_RULES = {
  hpBase: 90, hpRange: 60, hpCapKm: 12,
  attackBase: 12, attackRange: 24,
  shieldBase: 6, shieldRange: 12, shieldCapMPerKm: 25,
  /** 꿰뚫기: 쉴드를 무시하는 대신 약하다. 방어 중인 상대에게는 강하다 */
  pierceRate: 0.4, pierceVsGuardRate: 0.8,
  /** 방어: 강타를 줄여 받고 되받아친다. 턴이 끝나면 쉴드 일부를 회복한다 */
  guardTakenRate: 0.25, counterRate: 0.8, guardShieldRestore: 0.5,
  /** 같은 행동을 연달아 쓸 때마다 효과에 곱한다. 한 행동만 반복하는 계획이 정답이 되지 않게 한다 */
  repeatDecay: 0.7,
  variance: 0.08,
} as const;

/** 능력치에 필요한 값만 받는다. 페이스가 결과에 닿을 수 없게 하는 경계다. */
export type DuelStats = Pick<RunStats, "distanceM" | "adherence" | "climbMPerKm">;
export interface DuelFighter { id: string; stats: DuelStats; plan: DuelPlan }
export interface FighterSheet { maxHp: number; attack: number; maxShield: number }

export interface DuelTurnLog {
  turn: number;
  actions: [DuelAction, DuelAction];
  /** 체력에 들어간 피해 */
  hpDamage: [number, number];
  hp: [number, number];
  shield: [number, number];
}
export interface DuelResult {
  /** 이긴 쪽 번호. 비기면 null */
  winner: 0 | 1 | null;
  /** ko: 체력 0, ratio: 5턴 뒤 남은 체력 비율 비교 */
  endedBy: "ko" | "ratio";
  sheets: [FighterSheet, FighterSheet];
  turns: DuelTurnLog[];
}

export function fighterSheet(stats: DuelStats): FighterSheet {
  const r = DUEL_RULES;
  const km = Math.max(0, Math.min(stats.distanceM / 1000, r.hpCapKm));
  // 제곱근: 오래 달릴수록 체력은 늘지만 차이는 줄어든다
  const maxHp = r.hpBase + r.hpRange * Math.sqrt(km / r.hpCapKm);
  const attack = r.attackBase + r.attackRange * Math.max(0, Math.min(stats.adherence, 1));
  // 고도를 모르는 코스는 오르막 보너스 없이 기본 쉴드만 준다
  const climb = Math.max(0, Math.min(stats.climbMPerKm ?? 0, r.shieldCapMPerKm));
  const maxShield = r.shieldBase + (r.shieldRange * climb) / r.shieldCapMPerKm;
  return { maxHp, attack, maxShield };
}

function assertPlan(plan: DuelPlan) {
  if (plan.length !== DUEL_TURNS || plan.some((a) => !DUEL_ACTIONS.includes(a))) throw new Error(`행동 계획은 ${DUEL_TURNS}턴이어야 합니다`);
}

export function simulateDuel(a: DuelFighter, b: DuelFighter, seed: string): DuelResult {
  assertPlan(a.plan);
  assertPlan(b.plan);
  const r = DUEL_RULES;
  const sheets: [FighterSheet, FighterSheet] = [fighterSheet(a.stats), fighterSheet(b.stats)];
  const hp: [number, number] = [sheets[0].maxHp, sheets[1].maxHp];
  const shield: [number, number] = [sheets[0].maxShield, sheets[1].maxShield];
  const random = seededRandom(`duel:${seed}`);
  const turns: DuelTurnLog[] = [];
  const streak: [number, number] = [0, 0];

  for (let t = 0; t < DUEL_TURNS && hp[0] > 0 && hp[1] > 0; t++) {
    const actions: [DuelAction, DuelAction] = [a.plan[t], b.plan[t]];
    // 난수를 항상 두 번 뽑아 행동이 달라져도 뒤 턴의 흔들림이 밀리지 않게 한다
    const swing: [number, number] = [1 + (random() * 2 - 1) * r.variance, 1 + (random() * 2 - 1) * r.variance];
    if (t > 0) {
      streak[0] = actions[0] === a.plan[t - 1] ? streak[0] + 1 : 0;
      streak[1] = actions[1] === b.plan[t - 1] ? streak[1] + 1 : 0;
    }
    const power: [number, number] = [r.repeatDecay ** streak[0], r.repeatDecay ** streak[1]];
    const hpDamage: [number, number] = [0, 0];
    for (const me of [0, 1] as const) {
      const foe = (1 - me) as 0 | 1;
      const atk = sheets[me].attack * swing[me] * power[me];
      const mine = actions[me], theirs = actions[foe];
      let incoming = 0, ignoresShield = false;
      if (mine === "strike") incoming = theirs === "guard" ? atk * Math.min(1, r.guardTakenRate / power[foe]) : atk;
      else if (mine === "pierce") {
        incoming = atk * (theirs === "guard" ? r.pierceVsGuardRate : r.pierceRate);
        ignoresShield = true;
      } else if (theirs === "strike") incoming = atk * r.counterRate; // 방어 중 되받아치기
      if (!ignoresShield) {
        const absorbed = Math.min(shield[foe], incoming);
        shield[foe] -= absorbed;
        incoming -= absorbed;
      }
      hpDamage[foe] += incoming;
    }
    hp[0] = Math.max(0, hp[0] - hpDamage[0]);
    hp[1] = Math.max(0, hp[1] - hpDamage[1]);
    for (const me of [0, 1] as const) {
      if (actions[me] === "guard") shield[me] = Math.min(sheets[me].maxShield, shield[me] + sheets[me].maxShield * r.guardShieldRestore * power[me]);
    }
    turns.push({ turn: t + 1, actions, hpDamage, hp: [hp[0], hp[1]], shield: [shield[0], shield[1]] });
  }

  const ko = hp[0] <= 0 || hp[1] <= 0;
  const ratio: [number, number] = [hp[0] / sheets[0].maxHp, hp[1] / sheets[1].maxHp];
  const winner = Math.abs(ratio[0] - ratio[1]) < 1e-3 ? null : ratio[0] > ratio[1] ? 0 : 1;
  return { winner, endedBy: ko ? "ko" : "ratio", sheets, turns };
}
