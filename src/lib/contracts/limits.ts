// 명세 6·7·9·10·11절의 시제품 한도. GPX 표준 제한이 아닌 제품 설계 목표이며 실기기 시험으로 조정한다.

export const GPX_LIMITS = {
  maxFileBytes: 5 * 1024 * 1024,
  maxTracks: 20,
  maxSegments: 200,
  maxPoints: 20_000,
  processingTimeoutMs: 10_000,
} as const;

export const ART_LIMITS = {
  maxSpanMeters: 50_000,
  maxAbsLatitude: 80,
  toleranceMeters: 2,
  maxRenderPoints: 2_000,
  uvMin: 0.05,
  uvMax: 0.95,
} as const;

export const ROOM = {
  width: 1000,
  height: 750,
  maxDisplayed: 20,
  maxArtworksPerAccount: 50,
  sizeMin: 0.08,
  sizeMax: 0.3,
  strokeWidthMin: 0.002,
  strokeWidthMax: 0.03,
  /** 액자 안쪽 여백: 작품 선은 슬롯의 이 비율만큼 안쪽에 그린다. */
  frameInset: 0.1,
  firstItemSize: 0.3,
  slotItemSize: 0.16,
} as const;

export const API_LIMITS = {
  maxBodyBytes: 2 * 1024 * 1024,
  titleMax: 60,
  displayNameMax: 20,
  pageSize: 20,
} as const;

export const SHARE = {
  tokenBytes: 32,
  defaultTtlDays: 30,
  maxSnapshotPoints: 40_000,
  maxSnapshotBytes: 2 * 1024 * 1024,
} as const;


export const FRAMES = ["plain", "paper", "neon"] as const;
export type Frame = (typeof FRAMES)[number];

export const THEMES = ["light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const DEFAULT_TITLE = "나의 러닝 그림";
export const NORMALIZATION_VERSION = "local-plane-v1";
