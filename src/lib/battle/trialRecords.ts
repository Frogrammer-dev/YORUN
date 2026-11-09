// 체험 완주 기록과 게스트 기본 기록. 가상으로 완주한 코스를 대결·경주 캐릭터로 쓴다.
// 실제 달리기 통계와 포인트에는 넣지 않고, 위치를 뺀 상대 모양만 이 기기에 둔다.

import { makeOrigin, project } from "@/lib/route/graph";
import type { BoothStyle } from "./boothRace";
import presets from "./guestRecords.json";

export interface TrialRecord {
  id: string;
  name: string;
  /** 위치를 뺀 코스 모양 (미터, y가 아래) */
  line: number[][];
  meters: number;
  paceSecPerKm: number;
  style: BoothStyle;
}

/** 체험 페이스 범위: 8인 경기 능력치 범위(5:00~6:35/km)와 같다 */
export const TRIAL_PACE = { min: 300, max: 395 } as const;
const STORE_KEY = "yorun.trial.records";
const MAX_RECORDS = 20;
const MAX_LINE_POINTS = 400;

/** roll은 0 이상 1 미만의 난수를 돌려준다 */
export const randomTrialPace = (roll: () => number) => Math.round(TRIAL_PACE.min + (TRIAL_PACE.max - TRIAL_PACE.min) * roll());

/** 빠르면 속도형, 느리면 코너형 */
export const styleForPace = (pace: number): BoothStyle => (pace < 330 ? "speed" : pace < 360 ? "balance" : "corner");

export const formatPace = (pace: number) => `${Math.floor(pace / 60)}:${String(Math.round(pace) % 60).padStart(2, "0")}/km`;

/** 완주 시간을 "24분 10초"로 */
export function formatDuration(seconds: number) {
  const total = Math.round(seconds), hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60);
  return `${hours ? `${hours}시간 ` : ""}${minutes}분 ${total % 60}초`;
}

/** 위경도를 첫 지점 기준 상대 좌표로 바꿔 위치를 지운다 */
export function relativeLine(latlngs: readonly (readonly [number, number])[]): number[][] {
  if (!latlngs.length) return [];
  const origin = makeOrigin(latlngs[0][0], latlngs[0][1]);
  const step = Math.max(1, Math.ceil(latlngs.length / MAX_LINE_POINTS));
  const kept = latlngs.filter((_, i) => i % step === 0 || i === latlngs.length - 1);
  return kept.map(([lat, lon]) => {
    const [x, y] = project(origin, lat, lon);
    return [Math.round(x) + 0, Math.round(-y) + 0];
  });
}

export function makeTrialRecord(course: { id: string; name: string; latlngs: readonly (readonly [number, number])[]; meters: number }, roll: () => number, now: number): TrialRecord {
  const paceSecPerKm = randomTrialPace(roll);
  return { id: `${course.id}-${now}`, name: course.name, line: relativeLine(course.latlngs), meters: Math.round(course.meters), paceSecPerKm, style: styleForPace(paceSecPerKm) };
}

export function loadTrialRecords(): TrialRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((r) => typeof r?.id === "string" && Array.isArray(r.line) && r.line.length > 1) : [];
  } catch {
    return [];
  }
}

export function saveTrialRecord(record: TrialRecord) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([record, ...loadTrialRecords()].slice(0, MAX_RECORDS)));
    return true;
  } catch {
    return false;
  }
}

/** 게스트에게 기본으로 주는 다섯 모양 */
export const GUEST_RECORDS = presets as TrialRecord[];
