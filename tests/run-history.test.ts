import { describe, expect, it } from "vitest";
import { RUN_LOG_LIMIT, formatPaceShort, summarizeMonth, summarizeWeek, upsertRunLog, type RunLogEntry } from "@/lib/run/history";

const kst = (text: string) => Date.parse(`${text}+09:00`);
const entry = (at: string, km: number, minutes: number, onCourse = false): RunLogEntry => ({
  id: kst(at), finishedAt: kst(at), meters: km * 1000, activeMs: minutes * 60_000, onCourse,
});

describe("summarizeMonth", () => {
  it("기록이 없으면 0이고 페이스와 지난달은 비어 있다", () => {
    const m = summarizeMonth([], kst("2026-11-05T09:00:00"));
    expect(m).toMatchObject({ label: "2026.11", km: 0, runs: 0, paceSecPerKm: null, onCourseRuns: 0, previousKm: null });
  });

  it("이번 달만 합치고 지난달은 따로 센다", () => {
    const m = summarizeMonth(
      [entry("2026-10-30T07:00:00", 3, 20), entry("2026-11-01T07:00:00", 5, 30, true), entry("2026-11-04T07:00:00", 5, 30)],
      kst("2026-11-05T09:00:00"),
    );
    expect(m.km).toBeCloseTo(10);
    expect(m.runs).toBe(2);
    expect(m.paceSecPerKm).toBeCloseTo(360);
    expect(m.onCourseRuns).toBe(1);
    expect(m.previousKm).toBeCloseTo(3);
  });

  it("한국 시간 기준으로 달을 나누고 1월의 지난달은 작년 12월이다", () => {
    const m = summarizeMonth([entry("2025-12-31T23:30:00", 4, 24), entry("2026-01-01T00:30:00", 2, 12)], kst("2026-01-02T09:00:00"));
    expect(m.km).toBeCloseTo(2);
    expect(m.previousKm).toBeCloseTo(4);
  });
});

describe("summarizeWeek", () => {
  it("월요일부터 일요일까지 나누고 지난주와 다음 주는 뺀다", () => {
    // 2026-11-05는 목요일
    const w = summarizeWeek(
      [entry("2026-11-01T23:59:00", 9, 50), entry("2026-11-02T00:10:00", 2, 12), entry("2026-11-05T07:00:00", 3, 18), entry("2026-11-05T19:00:00", 1, 6), entry("2026-11-09T07:00:00", 7, 40)],
      kst("2026-11-05T09:00:00"),
    );
    expect(w.today).toBe(3);
    expect(w.days.map((d) => Math.round(d))).toEqual([2, 0, 0, 4, 0, 0, 0]);
    expect(w.km).toBeCloseTo(6);
  });

  it("일요일은 그 주의 마지막 날이다", () => {
    const w = summarizeWeek([entry("2026-11-08T07:00:00", 5, 30)], kst("2026-11-08T09:00:00"));
    expect(w.today).toBe(6);
    expect(w.days[6]).toBeCloseTo(5);
  });
});

describe("upsertRunLog", () => {
  it("같은 달리기는 덮어쓴다", () => {
    const a = entry("2026-11-01T07:00:00", 3, 20);
    const out = upsertRunLog([a], { ...a, meters: 5000 });
    expect(out).toHaveLength(1);
    expect(out[0].meters).toBe(5000);
  });

  it("상한을 넘으면 오래된 것부터 지운다", () => {
    let log: RunLogEntry[] = [];
    for (let i = 0; i < RUN_LOG_LIMIT + 3; i++) log = upsertRunLog(log, { id: i, finishedAt: i, meters: 1, activeMs: 1, onCourse: false });
    expect(log).toHaveLength(RUN_LOG_LIMIT);
    expect(log[0].id).toBe(3);
  });
});

describe("formatPaceShort", () => {
  it("분과 초로 표시하고 값이 없으면 대시다", () => {
    expect(formatPaceShort(384)).toBe("6'24\"");
    expect(formatPaceShort(359.6)).toBe("6'00\"");
    expect(formatPaceShort(null)).toBe("–");
  });
});
