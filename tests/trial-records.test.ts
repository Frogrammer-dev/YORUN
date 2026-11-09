// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { GUEST_RECORDS, TRIAL_PACE, formatDuration, formatPace, loadTrialRecords, makeTrialRecord, randomTrialPace, relativeLine, saveTrialRecord, styleForPace } from "@/lib/battle/trialRecords";
import { BOOTH_STYLES } from "@/lib/battle/boothRace";
import { seededRandom } from "@/lib/battle/seed";

beforeEach(() => localStorage.clear());

describe("체험 페이스", () => {
  it("언제나 정해 둔 범위 안에서 고르고, 값이 고르게 나온다", () => {
    const random = seededRandom("pace");
    const paces = Array.from({ length: 2000 }, () => randomTrialPace(random));
    expect(Math.min(...paces)).toBeGreaterThanOrEqual(TRIAL_PACE.min);
    expect(Math.max(...paces)).toBeLessThanOrEqual(TRIAL_PACE.max);
    expect(new Set(paces).size).toBeGreaterThan(50);
  });
  it("범위는 경기 능력치 범위와 같다", () => {
    expect(TRIAL_PACE.min).toBe(BOOTH_STYLES.speed.pace[0]);
    expect(TRIAL_PACE.max).toBe(BOOTH_STYLES.corner.pace[1]);
  });
  it("빠를수록 속도형, 느릴수록 코너형이다", () => {
    expect(styleForPace(300)).toBe("speed");
    expect(styleForPace(345)).toBe("balance");
    expect(styleForPace(395)).toBe("corner");
  });
  it("시간과 페이스를 읽기 좋게 쓴다", () => {
    expect(formatPace(305)).toBe("5:05/km");
    expect(formatDuration(1450)).toBe("24분 10초");
    expect(formatDuration(3725)).toBe("1시간 2분 5초");
  });
});

describe("체험 기록", () => {
  const latlngs: [number, number][] = [[37.5, 127.03], [37.501, 127.03], [37.501, 127.031], [37.5, 127.03]];
  it("위치를 지우고 첫 지점을 원점으로 둔다", () => {
    const line = relativeLine(latlngs);
    expect(line[0]).toEqual([0, 0]);
    expect(Math.max(...line.flat().map(Math.abs))).toBeLessThan(200);
    expect(JSON.stringify(line)).not.toContain("37.5");
  });
  it("긴 코스는 점을 줄이되 마지막 점을 남긴다", () => {
    const long = Array.from({ length: 5000 }, (_, i): [number, number] => [37.5 + i * 1e-5, 127]);
    const line = relativeLine(long);
    expect(line.length).toBeLessThanOrEqual(401);
    expect(line[line.length - 1]).toEqual(relativeLine([long[0], long[4999]])[1]);
  });
  it("저장하면 최신 기록이 앞에 오고, 스무 개까지만 둔다", () => {
    for (let i = 0; i < 25; i++) saveTrialRecord(makeTrialRecord({ id: `c${i}`, name: `코스 ${i}`, latlngs, meters: 3000 }, () => 0.5, i));
    const records = loadTrialRecords();
    expect(records).toHaveLength(20);
    expect(records[0].name).toBe("코스 24");
    expect(records[0].style).toBe(styleForPace(records[0].paceSecPerKm));
  });
  it("저장소가 깨져 있어도 빈 목록을 돌려준다", () => {
    localStorage.setItem("yorun.trial.records", "{깨짐");
    expect(loadTrialRecords()).toEqual([]);
  });
});

describe("게스트 기본 기록", () => {
  it("다섯 모양이 있고 경기에 쓸 수 있는 값을 갖는다", () => {
    expect(GUEST_RECORDS.map((r) => r.name)).toEqual(["하트", "별", "강아지", "고양이", "물고기"]);
    for (const record of GUEST_RECORDS) {
      expect(record.line.length).toBeGreaterThan(3);
      expect(record.meters).toBeGreaterThan(1000);
      expect(record.paceSecPerKm).toBeGreaterThanOrEqual(TRIAL_PACE.min);
      expect(record.paceSecPerKm).toBeLessThanOrEqual(TRIAL_PACE.max);
      expect(record.style).toBe(styleForPace(record.paceSecPerKm));
    }
  });
  it("닫힌 코스다", () => {
    for (const { line } of GUEST_RECORDS) expect(line[0]).toEqual(line[line.length - 1]);
  });
});
