// 공통 런타임 스키마 (8.1, 9.3, 10.1). 클라이언트·서버가 공유하되 서버에서 반드시 재검증한다.
// 모르는 필드는 strict 객체로 거절한다.

import { z } from "zod";
import { ART_LIMITS, API_LIMITS, FRAMES, GPX_LIMITS, NORMALIZATION_VERSION, ROOM, THEMES } from "./limits";
import { fitsInRoom } from "@/lib/room/geometry";

const finite = z.number().refine(Number.isFinite, "유한한 숫자가 아님");
export const uuid = z.uuid();

const uv = finite.refine((n) => n >= ART_LIMITS.uvMin && n <= ART_LIMITS.uvMax, "정규화 범위 밖");
const point = z.tuple([uv, uv]);

const nonEmptyString = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .pipe(z.string().min(1).max(max))
    // 제어 문자 금지. HTML 문자는 텍스트로만 렌더하므로 허용하되 실행되지 않는다.
    .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "제어 문자 포함");

export const titleSchema = nonEmptyString(API_LIMITS.titleMax);

export const geometrySchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    normalizationVersion: z.literal(NORMALIZATION_VERSION),
    sourceSegments: z.array(z.array(point).min(1)).min(1).max(GPX_LIMITS.maxSegments),
    renderIndices: z.array(z.array(z.number().int().nonnegative()).min(1)).min(1).max(GPX_LIMITS.maxSegments),
    renderMethod: z.literal("rdp"),
    toleranceMeters: z.literal(ART_LIMITS.toleranceMeters),
  })
  .superRefine((g, ctx) => {
    const total = g.sourceSegments.reduce((s, a) => s + a.length, 0);
    if (total > GPX_LIMITS.maxPoints) ctx.addIssue({ code: "custom", message: "source 점 20,000개 초과" });
    if (g.renderIndices.length !== g.sourceSegments.length) {
      ctx.addIssue({ code: "custom", message: "renderIndices 구간 수 불일치" });
      return;
    }
    let renderTotal = 0;
    g.renderIndices.forEach((idx, si) => {
      const n = g.sourceSegments[si].length;
      renderTotal += idx.length;
      if (n === 1) {
        if (idx.length !== 1 || idx[0] !== 0) ctx.addIssue({ code: "custom", message: `구간 ${si}: 단일점은 [0]` });
        return;
      }
      if (idx[0] !== 0 || idx[idx.length - 1] !== n - 1) {
        ctx.addIssue({ code: "custom", message: `구간 ${si}: 처음·마지막 점 누락` });
      }
      for (let k = 1; k < idx.length; k++) {
        if (!(idx[k] > idx[k - 1])) {
          ctx.addIssue({ code: "custom", message: `구간 ${si}: 인덱스가 엄격한 오름차순이 아님` });
          break;
        }
      }
      if (idx.some((k) => k >= n)) ctx.addIssue({ code: "custom", message: `구간 ${si}: 인덱스 범위 밖` });
    });
    if (renderTotal > ART_LIMITS.maxRenderPoints) ctx.addIssue({ code: "custom", message: "render 점 2,000개 초과" });
    const xs = g.sourceSegments.flat();
    const spread = xs.some((p) => p[0] !== xs[0][0] || p[1] !== xs[0][1]);
    if (!spread) ctx.addIssue({ code: "custom", message: "모든 점이 같은 위치" });
  });

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(s)), "날짜 아님");

export const statsSchema = z.strictObject({
  distanceEstimateMeters: finite.refine((n) => n >= 0, "음수 거리"),
  recordedDate: dateString.nullable(),
  pointCount: z.number().int().positive(),
  segmentCount: z.number().int().positive(),
});

export const createArtworkSchema = z
  .strictObject({
    clientRequestId: uuid,
    title: titleSchema,
    sourceKind: z.enum(["provided_gpx", "demo"]),
    geometry: geometrySchema,
    stats: statsSchema,
  })
  .superRefine((r, ctx) => {
    // 10.1: pointCount·segmentCount는 geometry에서 다시 계산해 일치해야 한다.
    const pc = r.geometry.sourceSegments.reduce((s, a) => s + a.length, 0);
    if (r.stats.pointCount !== pc) ctx.addIssue({ code: "custom", message: "pointCount 불일치" });
    if (r.stats.segmentCount !== r.geometry.sourceSegments.length) {
      ctx.addIssue({ code: "custom", message: "segmentCount 불일치" });
    }
  });

export const styleSchema = z.strictObject({
  strokeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  strokeWidth: finite.refine((n) => n >= ROOM.strokeWidthMin && n <= ROOM.strokeWidthMax, "굵기 범위 밖"),
  frame: z.enum(FRAMES),
});

export const roomItemSchema = z
  .strictObject({
    id: uuid,
    artworkId: uuid,
    x: finite.refine((n) => n >= 0 && n <= 1),
    y: finite.refine((n) => n >= 0 && n <= 1),
    size: finite.refine((n) => n >= ROOM.sizeMin && n <= ROOM.sizeMax, "크기 범위 밖"),
    rotationDeg: finite.refine((n) => n >= -180 && n <= 180),
    zIndex: z.number().int().min(0).max(ROOM.maxDisplayed - 1),
    style: styleSchema,
  })
  .refine(fitsInRoom, "작품이 방 경계를 벗어남");

export const saveRoomSchema = z
  .strictObject({
    expectedRevision: z.number().int().nonnegative(),
    theme: z.enum(THEMES),
    items: z.array(roomItemSchema).max(ROOM.maxDisplayed),
  })
  .superRefine((r, ctx) => {
    const ids = new Set<string>();
    const arts = new Set<string>();
    const zs = new Set<number>();
    for (const it of r.items) {
      if (ids.has(it.id)) ctx.addIssue({ code: "custom", message: "배치 ID 중복" });
      if (arts.has(it.artworkId)) ctx.addIssue({ code: "custom", message: "같은 작품 중복 배치" });
      if (zs.has(it.zIndex)) ctx.addIssue({ code: "custom", message: "zIndex 중복" });
      ids.add(it.id);
      arts.add(it.artworkId);
      zs.add(it.zIndex);
    }
  });

export const patchArtworkSchema = z.strictObject({
  title: titleSchema,
  expectedRevision: z.number().int().nonnegative(),
});

export const createShareSchema = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  includeTitles: z.boolean(),
  includeDistances: z.boolean(),
  displayName: nonEmptyString(API_LIMITS.displayNameMax).nullable(),
});

/** 공개 스냅샷도 DB에서 읽은 뒤 렌더 전에 다시 검사한다 (10.1). */
export const shareSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  theme: z.enum(THEMES),
  displayName: z.string().max(API_LIMITS.displayNameMax).optional(),
  items: z
    .array(
      z.strictObject({
        x: finite,
        y: finite,
        size: finite.refine((n) => n >= ROOM.sizeMin && n <= ROOM.sizeMax),
        rotationDeg: finite.refine((n) => n >= -180 && n <= 180),
        zIndex: z.number().int().min(0).max(ROOM.maxDisplayed - 1),
        style: styleSchema,
        title: z.string().max(API_LIMITS.titleMax).optional(),
        distanceEstimateMeters: finite.optional(),
        lines: z.array(z.array(point).min(1)).min(1),
      }),
    )
    .max(ROOM.maxDisplayed),
});

/** 렌더 전 DB 값 검사용: 전시용 선만 있는 작품 뷰. */
export const renderLinesSchema = z.array(z.array(point).min(1)).min(1).max(GPX_LIMITS.maxSegments);

export function zodMessage(e: z.ZodError): string {
  return e.issues
    .slice(0, 3)
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}
