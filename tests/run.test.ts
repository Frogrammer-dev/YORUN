import { describe, expect, it } from "vitest";
import { RouteTracker, addFix, elapsedMs, emptyRecord, formatPace, isValidFix, pause, spokenDuration, startOrResume, toGpx } from "@/lib/run/tracker";
import { recoverRecord } from "@/lib/run/storage";
import { trackDistanceMeters } from "@/lib/gpx/metrics";
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

  it("화면 잠금으로 1분간 GPS가 끊기면 공백을 거리나 GPX 직선으로 연결하지 않음", async () => {
    let r = startOrResume(emptyRecord(), 0);
    // 10m 이동 → 수신 중단 동안 1km 떨어진 곳으로 이동 → 다시 10m 이동.
    for (const f of [fix(0, 0, 1000), fix(10, 0, 4000), fix(1010, 0, 64_000), fix(1020, 0, 67_000)]) {
      r = addFix(r, f).record;
    }
    expect(r.segments.map((s) => s.length)).toEqual([2, 2]);
    expect(r.distanceMeters).toBeCloseTo(20, 0);
    expect(elapsedMs(r, 67_000)).toBe(67_000);
    const exported = await parse(toGpx("화면 잠금 시험", r.segments));
    expect(exported.tracks[0].segments.map((s) => s.length)).toEqual([2, 2]);
    expect(trackDistanceMeters(exported.tracks[0])).toBeCloseTo(20, 0);
  });

  it("정확히 30초 간격의 정상 이동은 같은 구간으로 기록", () => {
    let r = startOrResume(emptyRecord(), 0);
    r = addFix(r, fix(0, 0, 1000)).record;
    r = addFix(r, fix(100, 0, 31_000)).record;
    expect(r.segments.map((s) => s.length)).toEqual([2]);
    expect(r.distanceMeters).toBeCloseTo(100, 0);
  });

  it("서 있는 동안 GPS가 정상 수신되면 30초가 지나도 불필요하게 구간을 끊지 않음", () => {
    let r = startOrResume(emptyRecord(), 0);
    r = addFix(r, fix(0, 0, 1000)).record;
    for (const time of [10_000, 20_000, 30_000, 40_000]) {
      const result = addFix(r, fix(0, 0, time));
      expect(result.reason).toBe("still");
      r = result.record;
    }
    expect(addFix(r, fix(4, 0, 40_000)).reason).toBe("timestamp");
    r = addFix(r, fix(4, 0, 45_000)).record;
    expect(r.segments.map((s) => s.length)).toEqual([2]);
    expect(r.distanceMeters).toBeCloseTo(4, 0);
  });

  it("정확도가 낮은 수신은 GPS 공백을 숨기지 않으며 이전 저장 형식도 분리", () => {
    let r = startOrResume(emptyRecord(), 0);
    r = addFix(r, fix(0, 0, 1000)).record;
    // lastFixAt이 없던 버전에서 저장된 진행 기록.
    delete r.lastFixAt;
    delete r.lastFix;
    for (const time of [20_000, 40_000]) r = addFix(r, fix(100, 0, time, 80)).record;
    r = addFix(r, fix(200, 0, 50_000)).record;
    expect(r.segments.map((s) => s.length)).toEqual([1, 1]);
    expect(r.distanceMeters).toBe(0);
  });

  it("오래 정지한 뒤 1초 만에 150m 튄 위치를 정지 시간으로 평균 내어 채택하지 않음", () => {
    let r = startOrResume(emptyRecord(), 0);
    for (const time of [1000, 20_000, 40_000, 60_000]) r = addFix(r, fix(0, 0, time)).record;
    const jumped = addFix(r, fix(150, 0, 61_000));
    expect(jumped.reason).toBe("jump");
    expect(jumped.record).toBe(r);
    expect(jumped.record.distanceMeters).toBe(0);
    expect(jumped.record.segments[0]).toHaveLength(1);
  });

  it("정지 오차 이후 속도는 직전 정상 수신 위치로 판정하고 거리는 경로 채택점부터 누적", () => {
    let r = addFix(startOrResume(emptyRecord(), 0), fix(0, 0, 1000)).record;
    for (const time of [20_000, 40_000, 60_000]) r = addFix(r, fix(2.5, 0, time)).record;
    // 실제 직전 위치에서는 1초간 8m 이동. 경로 채택점부터의 10.5m로 속도를 재면 오판한다.
    const moved = addFix(r, fix(10.5, 0, 61_000));
    expect(moved.accepted).toBe(true);
    expect(moved.record.distanceMeters).toBeCloseTo(10.5, 0);
    expect(moved.record.segments[0]).toHaveLength(2);
  });

  it.each([
    ["NaN 위도", { lat: NaN }, "coordinate"],
    ["범위 밖 위도", { lat: 91 }, "coordinate"],
    ["무한 경도", { lon: Infinity }, "coordinate"],
    ["범위 밖 경도", { lon: -181 }, "coordinate"],
    ["음수 정확도", { accuracy: -1 }, "accuracy"],
    ["NaN 정확도", { accuracy: NaN }, "accuracy"],
    ["NaN 시각", { time: NaN }, "timestamp"],
    ["무한 시각", { time: Infinity }, "timestamp"],
    ["음수 시각", { time: -1 }, "timestamp"],
    ["날짜 범위 밖 시각", { time: 8.64e15 + 1 }, "timestamp"],
  ])("%s인 GPS는 기록과 지도에 사용하지 않음", (_label, patch, reason) => {
    const r = addFix(startOrResume(emptyRecord(), 0), fix(0, 0, 1000)).record;
    const invalid = { ...fix(4, 0, 2000), ...patch };
    expect(isValidFix(invalid)).toBe(false);
    expect(addFix(r, invalid)).toEqual({ record: r, accepted: false, reason });
  });

  it("중복·역순 시각 및 재개 전 캐시 위치는 거리나 구간을 바꾸지 않음", () => {
    let r = addFix(startOrResume(emptyRecord(), 0), fix(0, 0, 1000)).record;
    for (const time of [1000, 999]) {
      expect(addFix(r, fix(4, 0, time))).toEqual({ record: r, accepted: false, reason: "timestamp" });
    }
    r = startOrResume(pause(r, 10_000), 60_000);
    expect(addFix(r, fix(100, 0, 59_999))).toEqual({ record: r, accepted: false, reason: "timestamp" });
    r = addFix(r, fix(100, 0, 60_000)).record;
    expect(r.segments.map((s) => s.length)).toEqual([1, 1]);
    expect(r.distanceMeters).toBe(0);
  });

  it("재개·일시정지 중복 호출과 기기 시계 역행으로 기존 기록이나 활동 시간을 잃지 않음", () => {
    let r = addFix(startOrResume(emptyRecord(), 0), fix(0, 0, 1000)).record;
    r = addFix(r, fix(10, 0, 4000)).record;
    expect(startOrResume(r, 5000)).toBe(r);
    r = pause(r, 10_000);
    expect(pause(r, 20_000)).toBe(r);
    const recorded = r.segments[0];
    r = startOrResume(r, 60_000);
    expect(elapsedMs(r, 59_000)).toBe(10_000);
    r = pause(r, 59_000);
    expect(r.activeMs).toBe(10_000);
    expect(r.segments[0]).toBe(recorded);
    expect(r.distanceMeters).toBeCloseTo(10, 0);
    expect(startOrResume(r, NaN)).toBe(r);
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
