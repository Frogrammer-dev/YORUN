import { expect, it } from "vitest";
import { TRACK, outwardAt, trackPoint } from "@/lib/battle/stadiumTrack";
it("uses a 400m measurement line and eight 1.22m lanes", () => {
  expect(2 * TRACK.straight + 2 * Math.PI * (TRACK.radius + 0.3)).toBeCloseTo(400, 1);
  expect(TRACK.lanes).toBe(8);
  expect(TRACK.laneWidth).toBe(1.22);
});
it("closes continuously after each lap", () => {
  expect(trackPoint(0)).toEqual(trackPoint(3));
  const start = trackPoint(0);
  const end = trackPoint(1 - 1e-7);
  expect(Math.hypot(start.x - end.x, start.z - end.z)).toBeLessThan(0.001);
});
it("has the expected actual overall track extent", () => {
  const outer = TRACK.radius + TRACK.lanes * TRACK.laneWidth;
  expect(trackPoint(0, outer).z).toBeCloseTo(46.26);
  expect(trackPoint((TRACK.straight + Math.PI * outer / 2) / (2 * TRACK.straight + 2 * Math.PI * outer), outer).x).toBeCloseTo(TRACK.straight / 2 + outer);
});
it("카메라를 둘 바깥 방향은 직선과 곡선 모두 경기장 밖을 향한다", () => {
  expect(outwardAt(0, 40)).toEqual({ x: 0, z: 1 });
  expect(outwardAt(0, -40)).toEqual({ x: 0, z: -1 });
  const curve = outwardAt(TRACK.straight / 2 + 30, 30);
  expect(curve.x).toBeCloseTo(Math.SQRT1_2);
  expect(curve.z).toBeCloseTo(Math.SQRT1_2);
  // 트랙 안쪽 24m는 관중석에 닿지 않는다
  const p = trackPoint(0.1, TRACK.radius + 4);
  const out = outwardAt(p.x, p.z);
  expect(Math.hypot(p.x - out.x * 24, p.z - out.z * 24)).toBeLessThan(Math.hypot(p.x, p.z));
});
