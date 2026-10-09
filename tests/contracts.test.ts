import { describe, expect, it } from "vitest";
import { buildDemoArtwork } from "@/lib/art/artwork";
import { createArtworkSchema, createShareSchema, saveRoomSchema, shareSnapshotSchema } from "@/lib/contracts/schemas";
import type { CreateArtworkRequest, RoomItem } from "@/lib/contracts/types";

const base = (): CreateArtworkRequest => structuredClone(buildDemoArtwork().request);
const valid = (r: unknown) => createArtworkSchema.safeParse(r).success;

const item = (over: Partial<RoomItem> = {}): RoomItem => ({
  id: crypto.randomUUID(),
  artworkId: crypto.randomUUID(),
  x: 0.5,
  y: 0.5,
  size: 0.24,
  rotationDeg: 0,
  zIndex: 0,
  style: { strokeColor: "#2B6CB0", strokeWidth: 0.008, frame: "plain" },
  ...over,
});

describe("작품 요청 계약 (10.1, AT-24)", () => {
  it("브라우저가 만든 작품 요청은 통과", () => {
    expect(valid(base())).toBe(true);
  });

  it("renderIndices 구간 수 불일치 거절", () => {
    const r = base();
    r.geometry.renderIndices.push([0]);
    expect(valid(r)).toBe(false);
  });

  it("순서 바뀐·중복·범위 밖 인덱스, 끝점 누락 거절", () => {
    const swap = base();
    const idx = swap.geometry.renderIndices[0];
    [idx[1], idx[2]] = [idx[2], idx[1]];
    expect(valid(swap)).toBe(false);

    const dup = base();
    dup.geometry.renderIndices[0].splice(1, 0, dup.geometry.renderIndices[0][1]);
    expect(valid(dup)).toBe(false);

    const out = base();
    out.geometry.renderIndices[0].push(999_999);
    expect(valid(out)).toBe(false);

    const noEnd = base();
    noEnd.geometry.renderIndices[0].pop();
    expect(valid(noEnd)).toBe(false);
  });

  it("pointCount·segmentCount 불일치 거절", () => {
    const r = base();
    r.stats.pointCount += 1;
    expect(valid(r)).toBe(false);
    const s = base();
    s.stats.segmentCount = 2;
    expect(valid(s)).toBe(false);
  });

  it("정규화 범위 밖 좌표·NaN·추가 필드 거절 (AT-19)", () => {
    const r = base();
    r.geometry.sourceSegments[0][0] = [0.01, 0.5];
    expect(valid(r)).toBe(false);
    const n = base();
    n.geometry.sourceSegments[0][0] = [Number.NaN, 0.5];
    expect(valid(n)).toBe(false);
    expect(valid({ ...base(), lat: 35 })).toBe(false);
    expect(valid({ ...base(), geometry: { ...base().geometry, origin: [35, 129] } })).toBe(false);
    const neg = base();
    neg.stats.distanceEstimateMeters = -1;
    expect(valid(neg)).toBe(false);
  });

  it("제목: HTML은 텍스트로 허용(렌더 시 이스케이프), 제어 문자·61자 이상은 거절", () => {
    expect(valid({ ...base(), title: "<img src=x onerror=alert(1)>" })).toBe(true);
    expect(valid({ ...base(), title: "a\u0000b" })).toBe(false);
    expect(valid({ ...base(), title: "가".repeat(61) })).toBe(false);
    expect(valid({ ...base(), title: "   " })).toBe(false);
  });
});

describe("배치 계약 (9.3)", () => {
  const save = (items: RoomItem[]) => saveRoomSchema.safeParse({ expectedRevision: 0, theme: "light", items }).success;

  it("기본 배치 통과", () => {
    expect(save([item()])).toBe(true);
  });

  it("방 경계 밖(회전 포함)·크기 범위 밖·음수 크기 거절", () => {
    expect(save([item({ x: 0.02 })])).toBe(false);
    expect(save([item({ size: 0.3, rotationDeg: 0, y: 0.25 })])).toBe(true); // 회전 없음: 위쪽 37.5px 여유
    expect(save([item({ size: 0.3, rotationDeg: 45, y: 0.25 })])).toBe(false); // 45° 회전 시 반폭 212px > 187.5px
    expect(save([item({ size: 0.31 })])).toBe(false);
    expect(save([item({ size: -0.1 })])).toBe(false);
  });

  it("스타일: 외부 URL·임의 필드·잘못된 색 거절 (AT-19)", () => {
    expect(save([item({ style: { strokeColor: "url(http://x)", strokeWidth: 0.008, frame: "plain" } })])).toBe(false);
    expect(save([item({ style: { strokeColor: "#2B6CB0", strokeWidth: 0.008, frame: "gold" as never } })])).toBe(false);
    expect(save([item({ style: { strokeColor: "#2B6CB0", strokeWidth: 0.008, frame: "plain", backgroundImage: "http://x" } as never })])).toBe(false);
  });

  it("같은 작품 중복·zIndex 중복 거절", () => {
    const a = item();
    expect(save([a, item({ artworkId: a.artworkId, zIndex: 1, x: 0.2, size: 0.1 })])).toBe(false);
    expect(save([a, item({ zIndex: 0, x: 0.2, size: 0.1 })])).toBe(false);
  });

  it("전시 최대 20개", () => {
    const items = Array.from({ length: 21 }, (_, i) => item({ zIndex: i % 20, size: 0.08 }));
    expect(save(items)).toBe(false);
  });
});

describe("공유 계약", () => {
  it("공유 요청은 허용 필드만", () => {
    expect(createShareSchema.safeParse({ expectedRevision: 1, includeTitles: true, includeDistances: false, displayName: null }).success).toBe(true);
    expect(
      createShareSchema.safeParse({ expectedRevision: 1, includeTitles: true, includeDistances: false, displayName: null, includeDate: true }).success,
    ).toBe(false);
  });

  it("공개 스냅샷에 owner·작품 ID·날짜 필드가 있으면 거절 (AT-18)", () => {
    const snap = {
      schemaVersion: 1,
      theme: "light",
      items: [{ x: 0.5, y: 0.5, size: 0.2, rotationDeg: 0, zIndex: 0, style: item().style, lines: [[[0.1, 0.1], [0.9, 0.9]]] }],
    };
    expect(shareSnapshotSchema.safeParse(snap).success).toBe(true);
    expect(shareSnapshotSchema.safeParse({ ...snap, ownerId: "x" }).success).toBe(false);
    expect(shareSnapshotSchema.safeParse({ ...snap, items: [{ ...snap.items[0], artworkId: "x" }] }).success).toBe(false);
    expect(shareSnapshotSchema.safeParse({ ...snap, items: [{ ...snap.items[0], recordedDate: "2026-10-01" }] }).success).toBe(false);
  });
});
