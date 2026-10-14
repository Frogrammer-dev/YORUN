import { describe, expect, it } from "vitest";
import { DAILY_POINT_CAP, cappedPoints, collectedCount, emptyRewards, isMissed, kstDay, placeCheckpoints, stepRewards, type Checkpoint, type RewardState } from "@/lib/run/rewards";

const LAT0 = 35.15, LON0 = 129.1;
const ll = (x: number, y: number): [number, number] => [LAT0 + y / 111_195, LON0 + x / (111_195 * Math.cos((LAT0 * Math.PI) / 180))];
// 한 변 410m 네모 코스 (경위도 변환 오차로 객체 수가 경계에서 흔들리지 않게 100m 배수를 피한다)
const square: [number, number][] = [ll(0, 0), ll(410, 0), ll(410, 410), ll(0, 410), ll(0, 0)];

/** 점들을 차례로 지나가며 (초속 3m) 보상을 갱신한다 */
function runThrough(pts: [number, number][], cps: Checkpoint[], s: RewardState = emptyRewards(cps.length), t0 = 0, speed = 3) {
  let t = t0, prev: [number, number] | null = null, gained = 0;
  for (const p of pts) {
    const d = prev ? Math.hypot(p[0] - prev[0], p[1] - prev[1]) : 0;
    t += (d / speed) * 1000;
    const [lat, lon] = ll(p[0], p[1]);
    const r = stepRewards(s, cps, { lat, lon, time: t }, d, prev === null);
    s = r.state;
    gained += r.gained;
    prev = p;
  }
  return { state: s, gained, time: t };
}

/** (x0,y0)→(x1,y1)을 step m 간격 점으로 */
const line = (x0: number, y0: number, x1: number, y1: number, step = 10): [number, number][] => {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
  return Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n] as [number, number]);
};
const squarePath = [...line(0, 0, 410, 0), ...line(410, 0, 410, 410).slice(1), ...line(410, 410, 0, 410).slice(1), ...line(0, 410, 0, 0).slice(1)];

describe("포인트 객체 배치", () => {
  it("그림 구간 100m마다, 끝의 나머지에는 두지 않는다", () => {
    const cps = placeCheckpoints(square);
    expect(cps).toHaveLength(16);
    expect(cps[0].atMeters).toBe(100);
    expect(cps[15].atMeters).toBe(1600);
    // 1,640m + 50m 코스 → 16개 (나머지는 버림)
    expect(placeCheckpoints([...square, ll(0, -50)])).toHaveLength(16);
    // 첫 객체는 출발점에서 동쪽 100m
    const [lat, lon] = ll(100, 0);
    expect(cps[0].lat).toBeCloseTo(lat, 6);
    expect(cps[0].lon).toBeCloseTo(lon, 6);
  });

  it("이동 구간에는 두지 않는다", () => {
    // 0→1 그림(410m), 1→2 이동(410m), 2→3 그림(410m)
    const cps = placeCheckpoints(square.slice(0, 4), [[1, 2]]);
    expect(cps).toHaveLength(8);
    // 이동 구간(동쪽 변)을 건너뛰고, 다음 그림 구간 시작에서 100m 지점에 이어 둔다
    expect(cps[4].lat).toBeCloseTo(ll(320, 410)[0], 5);
    expect(cps[4].lon).toBeCloseTo(ll(320, 410)[1], 5);
  });
});

describe("코스 달리기 적립", () => {
  const cps = placeCheckpoints(square);

  it("코스를 한 바퀴 따라 달리면 모든 객체를 줍는다", () => {
    const { state } = runThrough(squarePath, cps);
    expect(collectedCount(state)).toBe(16);
  });

  it("위치 갱신 사이에 객체 옆을 지나쳐도 줍는다 (선분 판정)", () => {
    // 40m 간격으로 띄엄띄엄: 객체(100m) 바로 위에 위치가 찍히지 않는다
    const { state } = runThrough(line(0, 0, 410, 0, 41), cps);
    expect(state.got.slice(0, 4)).toEqual([true, true, true, true]);
  });

  it("코스에서 25m 넘게 떨어져 지나가면 줍지 못하고, 놓친 객체로 남는다", () => {
    // 100m 지점 객체 주변을 40m 떨어져 돌아간다
    const path: [number, number][] = [...line(0, 0, 60, 0), ...line(60, 0, 60, 40).slice(1), ...line(60, 40, 140, 40).slice(1), ...line(140, 40, 140, 0).slice(1), ...line(140, 0, 230, 0).slice(1)];
    const { state } = runThrough(path, cps);
    expect(state.got[0]).toBe(false);
    expect(state.got[1]).toBe(true);
    expect(isMissed(state, 0)).toBe(true);
    // 다시 돌아가면 주울 수 있다
    const back = runThrough(line(220, 0, 90, 0), cps, state, 1e6);
    expect(back.state.got[0]).toBe(true);
  });

  it("코스가 겹치는 곳에서 먼 뒤쪽 객체를 미리 줍지 않는다", () => {
    // 230m 지점까지 따라간 뒤 북쪽으로 가로질러(410m) 1,000m 지점 객체(10번째, (230,410))에 닿아도,
    // 건너뛴 객체 수만큼(70m × 8) 달리지 않았으므로 무효
    const shortcut: [number, number][] = [...line(0, 0, 230, 0), ...line(230, 0, 230, 410).slice(1)];
    const { state } = runThrough(shortcut, cps);
    expect(state.got[1]).toBe(true);
    expect(state.got[9]).toBe(false);
  });

  it("너무 빠르면(자전거·차량) 적립하지 않는다", () => {
    const { state } = runThrough(line(0, 0, 410, 0), cps, undefined, 0, 9);
    expect(collectedCount(state)).toBe(0);
  });
});

describe("자유 달리기 적립", () => {
  it("100m마다 1개, 나머지는 다음으로 넘긴다", () => {
    const { state } = runThrough(line(0, 0, 350, 0), []);
    expect(state.freeCount).toBe(3);
    expect(state.freeCarry).toBeCloseTo(50, 0);
    expect(collectedCount(state)).toBe(3);
  });

  it("너무 빠른 100m는 적립하지 않는다", () => {
    const { state } = runThrough(line(0, 0, 300, 0), [], undefined, 0, 9);
    expect(state.freeCount).toBe(0);
  });
});

describe("하루 상한", () => {
  it("100P 단위, 하루 10,000P까지", () => {
    expect(cappedPoints(48, 0)).toBe(4800);
    expect(cappedPoints(48, 6000)).toBe(4000);
    expect(cappedPoints(10, DAILY_POINT_CAP)).toBe(0);
  });

  it("한국 시간 0시 기준으로 날짜가 바뀐다", () => {
    expect(kstDay(Date.parse("2026-10-14T14:59:00Z"))).toBe("2026-10-14");
    expect(kstDay(Date.parse("2026-10-14T15:00:00Z"))).toBe("2026-10-15");
  });
});
