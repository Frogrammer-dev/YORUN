"use client";
// 선택한 코스·진행 중인 달리기를 이 기기에만 보관한다 (서버 전송 없음).
// 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 실패하고 화면 상태만 유지한다.

import type { RunRecord } from "./tracker";
import { cappedPoints, kstDay, type RewardState } from "./rewards";
import type { ShapeKey } from "@/lib/route/shapes";

export interface PlannedRoute {
  id: string;
  shapeId: ShapeKey;
  shapeName: string;
  latlngs: [number, number][];
  outline: [number, number][];
  /** 여러 획 그림의 획별 외곽선 (없으면 outline 하나) */
  outlines?: [number, number][][];
  /** latlngs 중 그림이 아닌 이동 구간 [시작, 끝] 인덱스 */
  moves?: Array<[number, number]>;
  moveMeters?: number;
  lengthMeters: number;
  similarity: number;
  /** AI 해석은 수치 유사도와 구분해 달리기 화면에서도 표시한다. */
  recognitionKind?: "reference" | "clip";
  dataTimestamp: string | null;
}

export function plannedRouteBadge(route: PlannedRoute): string {
  if (route.shapeId === "run") return `쾌적 ${route.similarity}`;
  if (route.recognitionKind === "reference" || route.recognitionKind === "clip") return "AI 해석 · 실험";
  return route.shapeId === "doodle" ? `인식 ${route.similarity}%` : `유사도 ${route.similarity}`;
}

const ROUTE_KEY = "runcanvas.route";
const RUN_KEY = "runcanvas.activeRun";
const WALLET_KEY = "runcanvas.points";

function read<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}
function write(key: string, v: unknown): boolean {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export const savePlannedRoute = (r: PlannedRoute) => write(ROUTE_KEY, r);
export const loadPlannedRoute = () => read<PlannedRoute>(ROUTE_KEY);

export interface ActiveRun {
  routeId: string | null;
  record: RunRecord;
  /** 이번 달리기에서 주운 포인트 객체 (앱이 꺼져도 이어 달리기에서 이어진다) */
  rewards?: RewardState;
  savedAt: number;
}
export const saveActiveRun = (r: ActiveRun | null) => write(RUN_KEY, r);
export const loadActiveRun = () => read<ActiveRun>(RUN_KEY);

// ───────────────────────── 포인트 (지금은 이 기기에만 보관) ─────────────────────────

export interface PointWallet {
  balance: number;
  /** 한국 시간 기준 날짜와 그날 적립한 포인트 (하루 상한 계산용) */
  day: string;
  dayPoints: number;
  /** 마지막으로 적립한 달리기 (같은 달리기를 두 번 적립하지 않게) */
  lastRunId: number | null;
}

/** 날짜가 바뀌었으면 오늘 적립량을 0으로 본다 */
export function loadWallet(now: number): PointWallet {
  const w = read<PointWallet>(WALLET_KEY) ?? { balance: 0, day: kstDay(now), dayPoints: 0, lastRunId: null };
  return w.day === kstDay(now) ? w : { ...w, day: kstDay(now), dayPoints: 0 };
}

/** 달리기 하나를 적립한다. 반환: 실제로 적립된 포인트 (하루 상한·중복 적립 반영) */
export function awardRun(runId: number, collected: number, now: number): { points: number; wallet: PointWallet } {
  const w = loadWallet(now);
  if (w.lastRunId === runId) return { points: 0, wallet: w };
  const points = cappedPoints(collected, w.dayPoints);
  const next = { ...w, balance: w.balance + points, dayPoints: w.dayPoints + points, lastRunId: runId };
  write(WALLET_KEY, next);
  return { points, wallet: next };
}
