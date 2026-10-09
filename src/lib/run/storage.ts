"use client";
// 선택한 코스·진행 중인 달리기를 이 기기에만 보관한다 (서버 전송 없음).
// 저장소를 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 실패하고 화면 상태만 유지한다.

import type { RunRecord } from "./tracker";
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
  dataTimestamp: string | null;
}

const ROUTE_KEY = "runcanvas.route";
const RUN_KEY = "runcanvas.activeRun";

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
  savedAt: number;
}
export const saveActiveRun = (r: ActiveRun | null) => write(RUN_KEY, r);
export const loadActiveRun = () => read<ActiveRun>(RUN_KEY);
