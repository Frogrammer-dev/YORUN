// samples/의 합성 GPX를 실제 파이프라인(파싱 → 정규화 → 요청 스키마)에 통과시켜 본다.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildArtwork } from "@/lib/art/artwork";
import { createArtworkSchema } from "@/lib/contracts/schemas";
import { ImportError } from "@/lib/gpx/errors";
import { parse } from "./helpers";

const read = (f: string) => readFileSync(join(__dirname, "..", "samples", f), "utf8");
const codeOf = async (f: string) => {
  try {
    const r = await parse(read(f));
    buildArtwork(r.tracks[0]);
    return "ok";
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
};

describe("합성 샘플 GPX", () => {
  it("하트: 한 구간, 날짜 후보, 서버 계약 통과", async () => {
    const r = await parse(read("01-heart-single-segment.gpx"));
    const { request } = buildArtwork(r.tracks[0], { recordedDate: "2026-10-01" });
    expect(request.stats.segmentCount).toBe(1);
    expect(createArtworkSchema.safeParse(request).success).toBe(true);
  });

  it("별: 끊긴 구간 2개 + 단일점 구간 1개를 연결하지 않음", async () => {
    const r = await parse(read("02-star-two-segments-gap.gpx"));
    const { request, view } = buildArtwork(r.tracks[0]);
    expect(request.geometry.sourceSegments).toHaveLength(3);
    expect(view.renderLines[2]).toHaveLength(1);
    expect(createArtworkSchema.safeParse(request).success).toBe(true);
  });

  it("접두사 네임스페이스·여러 트랙·시간 없음", async () => {
    const r = await parse(read("03-multi-track-prefixed-ns.gpx"));
    expect(r.tracks.map((t) => t.name)).toEqual(["네모", null]);
    for (const t of r.tracks) expect(createArtworkSchema.safeParse(buildArtwork(t).request).success).toBe(true);
  });

  it("오류 파일은 명확한 코드로 거절", async () => {
    expect(await codeOf("e1-route-only.gpx")).toBe("route_only");
    expect(await codeOf("e2-doctype-entity.gpx")).toBe("doctype_forbidden");
    expect(await codeOf("e3-bad-coordinate.gpx")).toBe("invalid_coordinate");
    expect(await codeOf("e4-too-wide-60km.gpx")).toBe("out_of_range");
    expect(await codeOf("e5-broken-xml.gpx")).toBe("not_xml");
  });
});
