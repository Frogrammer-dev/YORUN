import { describe, expect, it } from "vitest";
import { ImportError } from "@/lib/gpx/errors";
import { gpx, parse } from "./helpers";

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ImportError ? e.code : String(e);
  }
};

describe("GpxParser", () => {
  it("GPX 1.1 기본 트랙·구간·점을 순서대로 추출 (AT-02)", async () => {
    const r = await parse(gpx([[[[35, 129, "2026-10-01T00:00:00Z"], [35.001, 129.001]]]]));
    expect(r.tracks).toHaveLength(1);
    expect(r.tracks[0].segments[0]).toEqual([
      { lat: 35, lon: 129, time: "2026-10-01T00:00:00Z" },
      { lat: 35.001, lon: 129.001 },
    ]);
  });

  it("GPX 1.0·네임스페이스 없음·접두사 네임스페이스에서 같은 점을 추출 (AT-02)", async () => {
    const pts: [number, number][] = [
      [35, 129],
      [35.001, 129.002],
    ];
    const v10 = await parse(gpx([[pts]], { ns: 'xmlns="http://www.topografix.com/GPX/1/0"' }));
    const none = await parse(gpx([[pts]], { ns: "" }));
    const pre = await parse(gpx([[pts]], { ns: 'xmlns:g="http://www.topografix.com/GPX/1/1"', prefix: "g" }));
    for (const r of [v10, none, pre]) expect(r.tracks[0].segments[0].map((p) => [p.lat, p.lon])).toEqual(pts);
  });

  it("다른 네임스페이스의 루트는 GPX로 읽지 않음", async () => {
    expect(await code(parse(gpx([[[[35, 129]]]], { ns: 'xmlns="http://example.com/other"' })))).toBe("not_gpx");
  });

  it("여러 트랙·여러 구간·단일점 구간을 그대로 보존 (AT-03)", async () => {
    const r = await parse(
      gpx([
        [
          [
            [35, 129],
            [35.001, 129],
          ],
          [[35.01, 129.01]],
        ],
        [
          [
            [36, 128],
            [36.001, 128],
          ],
        ],
      ]),
    );
    expect(r.tracks).toHaveLength(2);
    expect(r.tracks[0].segments).toHaveLength(2);
    expect(r.tracks[0].segments[1]).toHaveLength(1);
    expect(r.totalSegments).toBe(3);
  });

  it("시간·고도 없이도 파싱 (AT-04)", async () => {
    const r = await parse(
      gpx([
        [
          [
            [35, 129],
            [35.001, 129],
          ],
        ],
      ]),
    );
    expect(r.tracks[0].segments[0][0].time).toBeUndefined();
  });

  it("손상 XML·DOCTYPE·ENTITY·빈 파일을 거절 (AT-07)", async () => {
    expect(await code(parse("<gpx><trk>"))).toBe("not_xml");
    expect(await code(parse('<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY x SYSTEM "http://evil">]><gpx>&x;</gpx>'))).toBe("doctype_forbidden");
    expect(await code(parse('<gpx><!ENTITY a "b"></gpx>'))).toBe("doctype_forbidden");
    expect(await code(parse("   "))).toBe("empty_file");
  });

  it("계획 경로만 있는 파일은 지원 외로 거절", async () => {
    const xml = '<gpx xmlns="http://www.topografix.com/GPX/1/1"><rte><rtept lat="35" lon="129"/></rte></gpx>';
    expect(await code(parse(xml))).toBe("route_only");
  });

  it("잘못된 좌표가 하나라도 있으면 위치와 함께 파일 전체 거절 (AT-07)", async () => {
    for (const [lat, lon] of [
      ["91", "129"],
      ["35", "181"],
      ["NaN", "129"],
      ["", "129"],
      ["abc", "1"],
    ]) {
      const xml = `<gpx xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="35" lon="129"/><trkpt lat="${lat}" lon="${lon}"/></trkseg></trk></gpx>`;
      const err = await parse(xml).then(
        () => null,
        (e: unknown) => e as ImportError,
      );
      expect(err?.code).toBe("invalid_coordinate");
      expect(err?.detail).toEqual({ track: 1, segment: 1, point: 2 });
    }
  });

  it("점·구간·트랙 한도 초과는 자르지 않고 거절 (AT-08)", async () => {
    const many = Array.from({ length: 20_001 }, (_, i) => [35 + i * 1e-6, 129] as [number, number]);
    expect(await code(parse(gpx([[many]])))).toBe("too_many_points");
    const segs = Array.from({ length: 201 }, () => [[35, 129]] as [number, number][]);
    expect(await code(parse(gpx([segs])))).toBe("too_many_segments");
    const tracks = Array.from({ length: 21 }, () => [[[35, 129]]] as [number, number][][]);
    expect(await code(parse(gpx(tracks)))).toBe("too_many_tracks");
  });

  it("취소 신호를 존중", async () => {
    const ac = new AbortController();
    ac.abort();
    const xml = gpx([
      [
        [
          [35, 129],
          [35.1, 129],
        ],
      ],
    ]);
    expect(await code(parse(xml, { signal: ac.signal }))).toBe("cancelled");
  });
});
