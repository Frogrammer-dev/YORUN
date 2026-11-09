// 달리기 기록 요약 (순수 함수). 기록은 이 기기에만 있고, 달린 위치는 담지 않는다.

import { kstDay } from "./rewards";

export interface RunLogEntry {
  /** 달리기 시작 시각. 같은 달리기를 이어 달려도 항목이 하나로 유지된다 */
  id: number;
  finishedAt: number;
  meters: number;
  activeMs: number;
  /** 고른 그림 코스로 달렸는가 */
  onCourse: boolean;
}

export const RUN_LOG_LIMIT = 500;

/** 같은 달리기는 덮어쓰고, 오래된 항목부터 지운다 */
export function upsertRunLog(entries: readonly RunLogEntry[], next: RunLogEntry): RunLogEntry[] {
  return [...entries.filter((e) => e.id !== next.id), next]
    .sort((a, b) => a.finishedAt - b.finishedAt)
    .slice(-RUN_LOG_LIMIT);
}

const DAY_MS = 86_400_000;
const utcOfDay = (day: string) => Date.parse(`${day}T00:00:00Z`);

export interface MonthSummary {
  /** "2026.11" */
  label: string;
  km: number;
  runs: number;
  /** 초/km. 기록이 없으면 null */
  paceSecPerKm: number | null;
  onCourseRuns: number;
  /** 지난달 거리. 지난달 기록이 없으면 null */
  previousKm: number | null;
}

export function summarizeMonth(entries: readonly RunLogEntry[], now: number): MonthSummary {
  const month = kstDay(now).slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const previous = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  const inMonth = entries.filter((e) => kstDay(e.finishedAt).slice(0, 7) === month);
  const before = entries.filter((e) => kstDay(e.finishedAt).slice(0, 7) === previous);
  const meters = inMonth.reduce((sum, e) => sum + e.meters, 0);
  const seconds = inMonth.reduce((sum, e) => sum + e.activeMs / 1000, 0);
  return {
    label: month.replace("-", "."),
    km: meters / 1000,
    runs: inMonth.length,
    paceSecPerKm: meters > 0 ? seconds / (meters / 1000) : null,
    onCourseRuns: inMonth.filter((e) => e.onCourse).length,
    previousKm: before.length ? before.reduce((sum, e) => sum + e.meters, 0) / 1000 : null,
  };
}

export interface WeekSummary {
  km: number;
  /** 월요일부터 일요일까지 요일별 km */
  days: number[];
  /** 오늘의 요일 번호 (월 = 0) */
  today: number;
}

export function summarizeWeek(entries: readonly RunLogEntry[], now: number): WeekSummary {
  const today = utcOfDay(kstDay(now));
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const monday = today - weekday * DAY_MS;
  const days = new Array<number>(7).fill(0);
  for (const e of entries) {
    const index = (utcOfDay(kstDay(e.finishedAt)) - monday) / DAY_MS;
    if (index >= 0 && index < 7) days[index] += e.meters / 1000;
  }
  return { km: days.reduce((a, b) => a + b, 0), days, today: weekday };
}

/** 6.4 → "6'24"" */
export function formatPaceShort(secPerKm: number | null): string {
  if (secPerKm === null) return "–";
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}'${String(total % 60).padStart(2, "0")}"`;
}
