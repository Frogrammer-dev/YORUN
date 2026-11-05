"use client";
// 8인 경기에서 고를 수 있는 내 캐릭터. 달린 코스 그림이 캐릭터의 얼굴이 된다.

import { BOOTH_STYLE_IDS, BOOTH_STYLES, type BoothStyle } from "@/lib/battle/boothRace";
import { BODY_LABELS, STYLE_BODIES, classifyBody, type BodyPlan } from "@/lib/battle/bodyPlan";
import { assessTrace } from "@/lib/battle/derbyTrace";
import { BATTLE_STYLE_SHEETS, battleSheet, type BattleSheet } from "@/lib/battle/turnBattle";
import type { BattleDraft } from "@/lib/battle/battleDraft";
import { GUEST_RECORDS, formatPace, loadTrialRecords, type TrialRecord } from "@/lib/battle/trialRecords";

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

function recordCharacter(record: TrialRecord, preset: boolean): DerbyCharacter {
  return {
    id: `trial-${record.id}`, kind: "trial", name: record.name,
    note: `${preset ? "기본 체험 기록" : "체험 완주 기록"}이에요. 페이스 ${formatPace(record.paceSecPerKm)}`,
    line: record.line, ...styleGauges(record.style), body: classifyBody(record.line, record.name), duel: BATTLE_STYLE_SHEETS[record.style], entry: { style: record.style },
  };
}

export const bodyLabel = (body: BodyPlan) => BODY_LABELS[body];

/** 인증 기록, 내 체험 완주 기록 다음에 게스트는 기본 기록 다섯, 그 밖에는 기본 유형 셋을 둔다 */
export function loadCharacters(draft: BattleDraft | null, guest = false): DerbyCharacter[] {
  return [
    ...(draft ? [verifiedCharacter(draft)] : []),
    ...loadTrialRecords().map((record) => recordCharacter(record, false)),
    ...(guest ? GUEST_RECORDS.map((record) => recordCharacter(record, true)) : STARTERS),
  ];
}
