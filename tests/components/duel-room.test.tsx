// @vitest-environment jsdom
// 친구와 하는 1대1 대결 방 화면: 기다리기 → 상대 참가 → 내 선택 → 상대 기다리기 → 다음 턴 → 상대가 나감
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RoomView } from "@/lib/battle/room";
import { startBattle } from "@/lib/battle/turnBattle";

// 연출은 브라우저 그리기가 필요하므로 바로 끝나는 대역으로 바꾼다
vi.mock("@/components/battle/BattleStage", () => ({
  BattleStage: ({ onSettled, state }: { onSettled: () => void; state: { turn: number } }) => {
    queueMicrotask(onSettled);
    return <div data-testid="stage">turn {state.turn}</div>;
  },
}));
import { DuelRoom } from "@/components/battle/DuelRoom";

const sheet = { maxHp: 100, attack: 20 };
const base: RoomView = {
  id: "11111111-1111-4111-8111-111111111111", code: "042137", role: "host", status: "waiting",
  me: { name: "방장", sheet }, foe: null, state: null, log: null, turnNo: 0, myChoice: null, foeChose: false, foeLeft: false, expired: false,
};
const playing = (over: Partial<RoomView> = {}): RoomView => ({ ...base, status: "playing", foe: { name: "손님", sheet }, state: startBattle(sheet, sheet), ...over });

let replies: RoomView[] = [];
const fetchMock = vi.fn(async (...call: [string, RequestInit?]) => (void call, Response.json(replies.shift() ?? replies[0])));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  fetchMock.mockClear();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const tick = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(1600); }); };

it("번호를 보여 주며 기다리다가, 상대가 들어오면 턴마다 고르고 기다리고, 상대가 나가면 이긴다", async () => {
  render(<DuelRoom initial={base} myLines={[[0, 0], [1, 0], [1, 1]]} onExit={() => {}} onNewRoom={() => {}} />);
  expect(screen.getByText("042137")).toBeTruthy();
  expect(screen.getByRole("button", { name: "번호 공유하기" })).toBeTruthy();

  replies = [playing()];
  await tick();
  expect(screen.getByRole("status").textContent).toContain("손님도 고르는 중");
  const rock = screen.getByRole("button", { name: /바위/ });
  expect((rock as HTMLButtonElement).disabled).toBe(false);

  replies = [playing({ myChoice: "rock" })];
  await act(async () => { fireEvent.click(rock); await vi.advanceTimersByTimeAsync(0); });
  expect(fetchMock.mock.calls.at(-1)![1]).toMatchObject({ method: "POST" });
  expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toEqual({ action: "turn", id: base.id, choice: "rock" });
  expect(screen.getByRole("status").textContent).toContain("내 선택: 바위");
  expect((screen.getByRole("button", { name: /가위/ }) as HTMLButtonElement).disabled).toBe(true);

  const after = startBattle(sheet, sheet);
  replies = [playing({ turnNo: 1, state: { ...after, turn: 1, hp: [100, 80] }, log: { turn: 1, choices: ["rock", "scissors"], damage: [0, 20], critical: [false, false], missed: [false, false] } })];
  await tick();
  expect(screen.getByTestId("stage").textContent).toBe("turn 1");
  expect((screen.getByRole("button", { name: /가위/ }) as HTMLButtonElement).disabled).toBe(false);

  replies = [playing({ status: "finished", foeLeft: true, turnNo: 1, state: { ...after, turn: 1, hp: [100, 80], winner: 0 } })];
  await tick();
  expect(screen.getByRole("heading", { name: "승리" })).toBeTruthy();
  expect(screen.getByText(/손님이\(가\) 대결을 나갔어요/)).toBeTruthy();
  // 끝나면 더 묻지 않는다
  const calls = fetchMock.mock.calls.length;
  await tick();
  expect(fetchMock.mock.calls.length).toBe(calls);
});
