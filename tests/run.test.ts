import { describe, expect, it } from "vitest";
import { RouteTracker, addFix, elapsedMs, emptyRecord, formatPace, pause, spokenDuration, startOrResume, toGpx } from "@/lib/run/tracker";
import { recoverRecord } from "@/lib/run/storage";
import { parse } from "./helpers";

const LAT0 = 35.15, LON0 = 129.1;
const ll = (x: number, y: number): [number, number] => [LAT0 + y / 111_195, LON0 + x / (111_195 * Math.cos((LAT0 * Math.PI) / 180))];
// 400m 네모 코스 (반시계: 동→북→서→남)
const square: [number, number][] = [ll(0, 0), ll(400, 0), ll(400, 400), ll(0, 400), ll(0, 0)];

describe("코스 안내", () => {
  it("진행 거리·남은 거리·다음 방향", () => {
    const t = new RouteTracker(square);
    expect(t.total).toBeCloseTo(1600, -1);
    expect(t.turns.map((x) => x.dir)).toEqual(["left", "left", "left"]);
    const g = t.update(...ll(200, 3));
    expect(g.progressMeters).toBeCloseTo(200, -1);
    expect(g.offRouteMeters).toBeLessThan(5);
    expect(g.nextTurn?.dir).toBe("left");
    expect(g.nextTurn?.inMeters).toBeCloseTo(200, -1);
  });

  it("코스 이탈 거리", () => {
    const t = new RouteTracker(square);
    t.update(...ll(100, 0));
    expect(t.update(...ll(200, 120)).offRouteMeters).toBeGreaterThan(100);
  });

  it("GPS 흔들림으로 진행이 뒤로 가지 않음, 마지막에 도착 인식", () => {
    const t = new RouteTracker(square);
    t.update(...ll(300, 0));
    expect(t.update(...ll(290, 2)).progressMeters).toBeCloseTo(300, -1);
    for (const p of [ll(400, 200), ll(200, 400), ll(0, 200), ll(0, 20)]) t.update(...p);
    expect(t.update(...ll(0, 5)).nearEnd).toBe(true);
  });
});

describe("기록", () => {
  const fix = (x: number, y: number, t: number, accuracy = 8) => ({ lat: ll(x, y)[0], lon: ll(x, y)[1], accuracy, time: t });

  it("일시정지 중·정확도 낮음·순간 이동은 버림", () => {
    let r = emptyRecord();
    expect(addFix(r, fix(0, 0, 0)).reason).toBe("paused");
    r = startOrResume(r, 0);
    r = addFix(r, fix(0, 0, 1000)).record;
    expect(addFix(r, fix(10, 0, 2000, 80)).reason).toBe("accuracy");
    expect(addFix(r, fix(500, 0, 2000)).reason).toBe("jump");
    expect(addFix(r, fix(1, 0, 2000)).reason).toBe("still");
    r = addFix(r, fix(4, 0, 2000)).record;
    expect(r.distanceMeters).toBeCloseTo(4, 0);
  });

  it("일시정지 후 재개는 새 구간 (끊긴 곳을 잇지 않음), 시간은 활동 시간만", () => {
    let r = startOrResume(emptyRecord(), 0);
    r = addFix(r, fix(0, 0, 1000)).record;
    r = addFix(r, fix(10, 0, 4000)).record;
    r = pause(r, 10_000);
    r = startOrResume(r, 60_000);
    r = addFix(r, fix(100, 0, 61_000)).record;
    expect(r.segments).toHaveLength(2);
    expect(r.distanceMeters).toBeCloseTo(10, 0);
    expect(elapsedMs(r, 70_000)).toBe(20_000);
  });

  it("앱이 꺼졌다 켜져도 마지막 저장까지 달린 시간을 잃지 않음", () => {
    // 일시정지 없이 30분 달리다 앱이 꺼짐 (마지막 저장 30분 시점)
    let r = startOrResume(emptyRecord(), 0);
    r = addFix(r, fix(0, 0, 1000)).record;
    const restored = recoverRecord({ routeId: null, record: r, savedAt: 30 * 60_000 });
    expect(restored.resumedAt).toBeNull();
    expect(elapsedMs(restored, 99 * 60_000)).toBe(30 * 60_000);
  });

  it("음성용 시간", () => {
    expect(spokenDuration(0)).toBe("0초");
    expect(spokenDuration(125_000)).toBe("2분 5초");
    expect(spokenDuration(3_600_000)).toBe("1시간");
  });

  it("페이스 표시", () => {
    expect(formatPace(6 * 60 * 1000, 1000)).toBe("6'00\"");
    expect(formatPace(1000, 10)).toBe("-'--\"");
  });

  it("GPX 내보내기를 다시 읽을 수 있음", async () => {
    const gpx = toGpx("하트 <코스> & 기록", [
      [
        { lat: 35.15, lon: 129.1, time: Date.UTC(2026, 9, 7) },
        { lat: 35.151, lon: 129.101 },
      ],
      [{ lat: 35.152, lon: 129.102 }],
    ]);
    const p = await parse(gpx);
    expect(p.tracks[0].name).toBe("하트 <코스> & 기록");
    expect(p.tracks[0].segments.map((s) => s.length)).toEqual([2, 1]);
  });
});
