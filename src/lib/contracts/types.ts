import type { Frame, Theme } from "./limits";

/** 작품 상대 좌표 [u, v] ∈ [0.05, 0.95]. */
export type Pt = [number, number];

export interface ArtGeometry {
  schemaVersion: 1;
  normalizationVersion: "local-plane-v1";
  sourceSegments: Pt[][];
  renderIndices: number[][];
  renderMethod: "rdp";
  toleranceMeters: number;
}

export interface ArtStats {
  distanceEstimateMeters: number;
  recordedDate: string | null;
  pointCount: number;
  segmentCount: number;
}

export type SourceKind = "provided_gpx" | "demo";

export interface CreateArtworkRequest {
  clientRequestId: string;
  title: string;
  sourceKind: SourceKind;
  geometry: ArtGeometry;
  stats: ArtStats;
}

export interface ItemStyle {
  strokeColor: string;
  strokeWidth: number;
  frame: Frame;
}

export interface RoomItem {
  id: string;
  artworkId: string;
  x: number;
  y: number;
  size: number;
  rotationDeg: number;
  zIndex: number;
  style: ItemStyle;
}

export interface SaveRoomRequest {
  expectedRevision: number;
  theme: Theme;
  items: RoomItem[];
}

/** 화면이 들고 있는 작품 정보. 전체 기준선은 상세 조회·로컬 작품에만 있다. */
export interface ArtworkView {
  id: string;
  title: string;
  sourceKind: SourceKind;
  revision: number;
  stats: ArtStats;
  renderLines: Pt[][];
  renderPointCount: number;
  geometry?: ArtGeometry;
  /** 로그인 전 로컬 작품의 재시도용 고정 요청 ID. */
  clientRequestId?: string;
}

export interface MyRoomDto {
  room: { id: string; theme: Theme; revision: number } | null;
  items: RoomItem[];
  artworks: ArtworkView[];
  share: ShareStatusDto | null;
  artworkCount: number;
}

export interface ArtworkListItemDto {
  id: string;
  title: string;
  sourceKind: SourceKind;
  revision: number;
  distanceEstimateMeters: number;
  segmentCount: number;
  displayed: boolean;
  createdAt: string;
}

export interface ShareOptions {
  includeTitles: boolean;
  includeDistances: boolean;
  displayName: string | null;
}

export interface ShareStatusDto {
  id: string;
  expiresAt: string;
  sourceRevision: number;
  createdAt: string;
}

/** 공개 스냅샷 (11.2 공개 반환 필드). 원 위치·날짜·owner·내부 작품 ID 없음. */
export interface ShareSnapshot {
  schemaVersion: 1;
  theme: Theme;
  displayName?: string;
  items: Array<{
    x: number;
    y: number;
    size: number;
    rotationDeg: number;
    zIndex: number;
    style: ItemStyle;
    title?: string;
    distanceEstimateMeters?: number;
    lines: Pt[][];
  }>;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  requestId: string;
}
