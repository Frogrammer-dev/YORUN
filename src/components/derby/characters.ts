"use client";
// 8인 경기에서 고를 수 있는 내 캐릭터. 달린 코스 그림이 캐릭터의 얼굴이 된다.

import { BOOTH_STYLE_IDS, BOOTH_STYLES, type BoothStyle } from "@/lib/battle/boothRace";
import { BODY_LABELS, STYLE_BODIES, classifyBody, type BodyPlan } from "@/lib/battle/bodyPlan";
import { assessTrace } from "@/lib/battle/derbyTrace";
import { BATTLE_STYLE_SHEETS, battleSheet, type BattleSheet } from "@/lib/battle/turnBattle";
import type { BattleDraft } from "@/lib/battle/battleDraft";
import { nodes } from "@/components/booth/course";

export type CharacterKind = "verified" | "trial" | "starter";
export interface DerbyCharacter {
  id: string;
  kind: CharacterKind;
  name: string;
  note: string;
  /** 코스 그림 (지도 좌표). 기본 캐릭터는 없다 */
  line: number[][] | null;
  /** 직선과 코너 능력을 0~1로 나타낸 값. 세부 능력치는 서버가 정한다 */
  straight: number;
  corner: number;
  /** 생김새로 고른 달리는 방식 */
  body: BodyPlan;
  /** 1대1 대결 능력치 */
  duel: BattleSheet;
  entry: { style: BoothStyle } | { consent: true; session: string; trace: BattleDraft["trace"] };
  /** 참가할 수 없는 기록이면 이유 */
  blocked?: string;
}

/** 초당 페이스를 게이지 값으로. 3:30/km를 1, 7:00/km를 0으로 본다 */
const paceGauge = (pace: number) => Math.max(0, Math.min(1, (420 - pace) / 210));
const middle = ([low, high]: readonly [number, number]) => (low + high) / 2;
const styleGauges = (style: BoothStyle) => ({ straight: paceGauge(middle(BOOTH_STYLES[style].pace)), corner: middle(BOOTH_STYLES[style].cornering) });

/** 같은 체험 기록은 언제나 같은 유형으로 뛴다 */
function styleOf(id: string): BoothStyle {
  const hash = Array.from(id).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return BOOTH_STYLE_IDS[hash % BOOTH_STYLE_IDS.length];
}

const STARTERS: DerbyCharacter[] = BOOTH_STYLE_IDS.map((style) => ({
  id: `starter-${style}`, kind: "starter", name: BOOTH_STYLES[style].label, note: BOOTH_STYLES[style].hint,
  line: null, ...styleGauges(style), body: STYLE_BODIES[style], duel: BATTLE_STYLE_SHEETS[style], entry: { style },
}));

function verifiedCharacter(draft: BattleDraft): DerbyCharacter {
  const line = draft.trace.course.map(([x, y]) => [x, -y]);
  const base = { id: `verified-${draft.id}`, kind: "verified" as const, name: "내 달리기 기록", line, body: classifyBody(line), entry: { consent: true as const, session: draft.id, trace: draft.trace } };
  try {
    const stats = assessTrace(draft.trace);
    return { ...base, note: `실제로 달린 ${(stats.distanceM / 1000).toFixed(1)}km 기록이에요.`, straight: paceGauge(stats.avgPaceSecPerKm), corner: stats.cornering, duel: battleSheet(stats) };
  } catch (error) {
    return { ...base, note: "경기 조건을 채우지 못한 기록이에요.", straight: 0, corner: 0, duel: BATTLE_STYLE_SHEETS.balance, blocked: (error as Error).message };
  }
}

function boothCharacters(): DerbyCharacter[] {
  try {
    const raw = JSON.parse(localStorage.getItem("yorun.booth.v1") ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((card) => typeof card?.id === "string" && Array.isArray(card.path) && card.path.every((id: unknown) => Number.isInteger(id) && nodes[id as number])).slice(-8).reverse().map((card): DerbyCharacter => {
      const style = styleOf(card.id);
      const line = (card.path as number[]).map((id) => nodes[id]);
      return {
        id: `trial-${card.id}`, kind: "trial", name: `${card.number}번 러너의 ${String(card.shape).slice(0, 12)}`,
        note: `체험 코스예요. ${BOOTH_STYLES[style].label}으로 달려요.`,
        line, ...styleGauges(style), body: classifyBody(line, `${card.prompt ?? ""} ${card.shape}`), duel: BATTLE_STYLE_SHEETS[style], entry: { style },
      };
    });
  } catch {
    return [];
  }
}

export const bodyLabel = (body: BodyPlan) => BODY_LABELS[body];

/** 인증 기록, 체험 기록, 기본 캐릭터 순서 */
export function loadCharacters(draft: BattleDraft | null): DerbyCharacter[] {
  return [...(draft ? [verifiedCharacter(draft)] : []), ...boothCharacters(), ...STARTERS];
}
