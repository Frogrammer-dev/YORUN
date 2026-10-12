// @vitest-environment jsdom
// 코스 찾기 화면 조각 (표시 전용 컴포넌트) 테스트
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CourseList } from "@/components/route/CourseList";
import { FinderSettings } from "@/components/route/FinderSettings";
import { DEFAULT_SETTINGS } from "@/components/route/finderOptions";
import { SelectedCourse } from "@/components/route/SelectedCourse";
import { makeCandidate } from "../helpers/candidate";

describe("찾은 코스 목록", () => {
  it("낙서 인식·도형 코스를 다른 제목·배지로, 이동 구간 거리도 보여 준다", async () => {
    const doodle = makeCandidate({ shapeName: "양", similarity: 72, doodle: { name: "sheep", prob: 0.72 } });
    const multi = makeCandidate({ shapeName: '"LO"', moves: [[1, 2]], moveMeters: 1234 });
    const onChoose = vi.fn();
    render(<CourseList candidates={[doodle, multi]} selected={multi.id} discover onChoose={onChoose} onHover={() => {}} />);
    const items = screen.getAllByRole("button");
    expect(within(items[0]).getByText("양처럼 보이는 코스")).toBeTruthy();
    expect(within(items[0]).getByText("인식 · 또렷함").className).toContain("cand-ai");
    expect(within(items[1]).getByText('"LO" 닮은 코스')).toBeTruthy();
    expect(within(items[1]).getByText("· 이동 1.2km")).toBeTruthy();
    expect(items[1].getAttribute("aria-pressed")).toBe("true");
    await userEvent.click(items[0]);
    expect(onChoose).toHaveBeenCalledWith(doodle);
  });
});

describe("고른 코스", () => {
  it("도형 코스: 벗어난 정도와 원래 그림 범례", () => {
    render(<SelectedCourse c={makeCandidate({ meanDeviationMeters: 15, maxDeviationMeters: 47 })} elev="loading" onRun={() => {}} onExport={() => {}} />);
    expect(screen.getByText(/원래 그림에서 평균 15m, 최대 47m 벗어나요/)).toBeTruthy();
    expect(screen.getByText("원래 그림")).toBeTruthy();
    expect(screen.getByText("…")).toBeTruthy(); // 고도 받는 중
  });

  it("낙서 인식 코스: 모델 판정이라고 밝히고, 원래 그림 범례는 없다", () => {
    const c = makeCandidate({ shapeName: "양", similarity: 72, doodle: { name: "sheep", prob: 0.72 }, outline: [], outlines: [] });
    render(<SelectedCourse c={c} elev="error" onRun={() => {}} onExport={() => {}} />);
    expect(screen.getByText(/낙서 인식 모델.*'양'\(으\)로 봤어요 \(또렷함 · 모델 점수 72\)/)).toBeTruthy();
    expect(screen.queryByText("원래 그림")).toBeNull();
    expect(screen.getByText("확인 못 함")).toBeTruthy();
  });

  it("길 정보·고도 그래프, 달리기·GPX 버튼", async () => {
    const onRun = vi.fn(), onExport = vi.fn();
    const c = makeCandidate({ roadInfo: { major: 0.5, unpaved: 0.1, lit: 0.75, litKnown: 0.4, steps: 2 } });
    render(<SelectedCourse c={c} elev={{ dist: [0, 500, 1000], elev: [20, 50, 20], ascent: 30, min: 20, max: 50 }} onRun={onRun} onExport={onExport} />);
    const facts = screen.getByRole("list", { name: "코스 길 정보" });
    expect(within(facts).getByText("50%")).toBeTruthy();
    expect(within(facts).getByText("75%")).toBeTruthy();
    expect(within(facts).getByText("2곳")).toBeTruthy();
    expect(within(facts).getByText("30m")).toBeTruthy();
    expect(screen.getByRole("img", { name: "고도 20m부터 50m, 오르막 합계 30m" })).toBeTruthy();
    expect(screen.getByText(/가로등은 정보가 있는 40% 구간 기준/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /이 코스로 달리기/ }));
    await userEvent.click(screen.getByRole("button", { name: "GPX 내보내기 (시계용)" }));
    expect(onRun).toHaveBeenCalledOnce();
    expect(onExport).toHaveBeenCalledOnce();
  });
});

describe("찾기 조건 · 최소 유사도", () => {
  it("슬라이더를 움직이면 최소 유사도 값만 알린다", () => {
    const onChange = vi.fn();
    render(<FinderSettings value={DEFAULT_SETTINGS} onChange={onChange} onChooseArea={() => {}} progress={null} ready tooBig={false} hasResults={false} onSearch={() => {}} />);
    fireEvent.change(screen.getByLabelText("최소 유사도"), { target: { value: "70" } });
    expect(onChange).toHaveBeenCalledWith({ minSimilarity: 70 });
  });
});

describe("찾기 조건", () => {
  const base = { onChange: () => {}, onChooseArea: () => {}, progress: null, ready: true, tooBig: false, hasResults: false, onSearch: () => {} };

  it("내 그림을 고르고 아직 그리지 않았으면 찾기 버튼이 꺼져 있다", () => {
    render(<FinderSettings {...base} value={{ ...DEFAULT_SETTINGS, shape: "custom" }} />);
    expect((screen.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("tab", { name: "그리기" })).toBeTruthy();
  });

  it("지금 화면이 너무 넓으면 확대 안내", () => {
    render(<FinderSettings {...base} tooBig value={DEFAULT_SETTINGS} />);
    expect((screen.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/지도를 조금 더 확대해 주세요/)).toBeTruthy();
  });

  it("진행 표시: 칸 나눠 받기 몇 번째인지, 탐색 비율", () => {
    const { rerender } = render(<FinderSettings {...base} value={DEFAULT_SETTINGS} progress={{ kind: "fetching", done: 1, total: 4 }} />);
    expect(screen.getByRole("status").textContent).toContain("지도 길 데이터를 받는 중… (2/4)");
    rerender(<FinderSettings {...base} value={DEFAULT_SETTINGS} progress={{ kind: "searching", fraction: 0.42, label: "하트" }} />);
    expect(screen.getByRole("status").textContent).toContain("그림 맞춰 보는 중 · 하트");
    expect(screen.getByRole("status").textContent).toContain("42%");
    expect(screen.queryByRole("button", { name: "지금 보이는 지도에서 코스 찾기" })).toBeNull();
  });

  it("조건을 바꾸면 바뀐 값만 알린다", async () => {
    const onChange = vi.fn(), onChooseArea = vi.fn();
    render(<FinderSettings {...base} onChange={onChange} onChooseArea={onChooseArea} value={DEFAULT_SETTINGS} />);
    await userEvent.click(screen.getByRole("radio", { name: "하트" }));
    await userEvent.click(screen.getByRole("radio", { name: "5~12km" }));
    await userEvent.click(screen.getByRole("switch", { name: "큰 차도 피하기" }));
    await userEvent.click(screen.getByRole("radio", { name: "지도 가운데 10km 사방" }));
    expect(onChange.mock.calls.map((c) => c[0])).toEqual([{ shape: "heart" }, { range: 2 }, { avoidMajor: true }]);
    expect(onChooseArea).toHaveBeenCalledWith("10");
  });
});
