// 코스 찾기 화면의 선택지와 설정 형식

import type { RoadDetail } from "@/lib/route/osm";
import type { ShapeGroup, ShapeId } from "@/lib/route/shapes";

export const RANGES = [
  { label: "2~5km", min: 2000, max: 5000 },
  { label: "3~8km", min: 3000, max: 8000 },
  { label: "5~12km", min: 5000, max: 12000 },
  { label: "8~16km", min: 8000, max: 16000 },
] as const;

export const DETAILS: Array<{ id: RoadDetail; label: string; hint: string }> = [
  { id: "simple", label: "큰길 위주", hint: "골목·보도·진입로를 빼고 이어진 길만 써서 선이 깔끔해요 (추천)" },
  { id: "normal", label: "보통", hint: "생활도로까지 쓰되 도로 옆 보도·횡단보도·진입로는 빼요" },
  { id: "detailed", label: "상세", hint: "모든 보행로를 써요. 그림은 촘촘하지만 삐죽해질 수 있어요" },
];

/** '지금 화면'으로 찾을 수 있는 한 변 최대 길이 (m) */
export const MAX_SIDE = 9000;
export const MIN_SIDE = 500;

/** 찾을 영역: 지금 화면, 또는 지도 가운데를 중심으로 한 정사각형 (한 변 km) */
export const AREAS = [
  { id: "screen", label: "지금 화면", km: 0 },
  { id: "2", label: "2km", km: 2 },
  { id: "5", label: "5km", km: 5 },
  { id: "10", label: "10km", km: 10 },
  { id: "15", label: "15km", km: 15 },
] as const;
export type AreaId = (typeof AREAS)[number]["id"];

/** auto: 동네 고리 코스 추천, ShapeId: 기본 그림, custom: 직접 만든 그림 */
export type ShapeChoice = ShapeId | "auto" | "custom";

export interface FinderSettingsValue {
  shape: ShapeChoice;
  custom: ShapeGroup | null;
  area: AreaId;
  /** RANGES 번호 */
  range: number;
  detail: RoadDetail;
  excludeSteps: boolean;
  avoidUnpaved: boolean;
  avoidMajor: boolean;
  preferLit: boolean;
}

export const DEFAULT_SETTINGS: FinderSettingsValue = {
  shape: "auto",
  custom: null,
  area: "screen",
  range: 1,
  detail: "simple",
  excludeSteps: true,
  avoidUnpaved: false,
  avoidMajor: false,
  preferLit: false,
};

/** 탐색 진행 상태 (설정 칸의 진행 표시용) */
export type SearchProgress = { kind: "fetching"; done: number; total: number } | { kind: "searching"; fraction: number; label: string };
