import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, deleteUser, signOut, user } = vi.hoisted(() => ({
  rpc: vi.fn(), deleteUser: vi.fn(), signOut: vi.fn(), user: { current: { id: "owner" } as { id: string } | null },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/battle", () => ({ battleDatabase: () => ({ rpc, auth: { admin: { deleteUser } } }) }));
vi.mock("@/lib/server/supabase", () => ({
  createUserClient: async () => ({ auth: { getUser: async () => ({ data: { user: user.current }, error: user.current ? null : new Error("x") }), signOut } }),
  createServiceClientForShareRead: () => null,
}));

import { POST } from "@/app/api/me/account/route";
import { clearDeviceData, hasRunInProgress } from "@/lib/client/deviceData";

const post = (body: unknown, origin = "http://localhost") =>
  POST(new Request("http://localhost/api/me/account", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) }));

describe("계정 삭제 API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    user.current = { id: "owner-" + Math.random() }; // 요청 수 제한이 시험끼리 섞이지 않게
    rpc.mockResolvedValue({ error: null });
    deleteUser.mockResolvedValue({ error: null });
    signOut.mockResolvedValue({});
  });

  it("경주 기록을 먼저 정리한 뒤 세션 본인의 계정을 지운다", async () => {
    const id = user.current!.id;
    expect((await post({ confirm: "삭제", target: "someone-else" })).status).toBe(204);
    expect(rpc).toHaveBeenCalledWith("derby_forget", { p_owner: id });
    expect(deleteUser).toHaveBeenCalledWith(id);
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(deleteUser.mock.invocationCallOrder[0]);
  });

  it("경주 정리에 실패하면 계정을 지우지 않는다 (0005 미적용 포함)", async () => {
    rpc.mockResolvedValue({ error: { code: "42883", message: "function does not exist" } });
    expect((await post({ confirm: "삭제" })).ok).toBe(false);
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it("계정 삭제 실패를 성공으로 알리지 않는다", async () => {
    deleteUser.mockResolvedValue({ error: new Error("x") });
    expect((await post({ confirm: "삭제" })).status).toBe(503);
  });

  it("확인 문구 없음, 비로그인, 다른 출처는 아무것도 지우지 않는다", async () => {
    expect((await post({ confirm: "delete" })).ok).toBe(false);
    expect((await post({})).ok).toBe(false);
    expect((await post({ confirm: "삭제" }, "https://evil.example")).status).toBe(403);
    user.current = null;
    expect((await post({ confirm: "삭제" })).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe("기기 데이터 삭제", () => {
  const values = new Map<string, string>();
  afterEach(() => { vi.unstubAllGlobals(); values.clear(); });
  beforeEach(() => {
    const store = {
      getItem: (k: string) => values.get(k) ?? null,
      removeItem: (k: string) => { values.delete(k); },
    };
    vi.stubGlobal("localStorage", new Proxy(store, { ownKeys: () => [...values.keys()], getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }) }));
  });

  it("위치가 담긴 값은 지우고 설정은 남긴다", async () => {
    for (const key of ["runcanvas.route", "runcanvas.activeRun", "runcanvas.runLog", "runcanvas.points", "yorun.lastDerbyTrace", "yorun.battle.draft.a", "yorun.battle.ticket.1", "yorun.voice", "yorun.runVoice", "yorun.roomRoadMap", "other"]) values.set(key, "1");
    const deleted: string[] = [];
    vi.stubGlobal("indexedDB", { deleteDatabase: (name: string) => { deleted.push(name); const request: { onsuccess?: () => void } = {}; queueMicrotask(() => request.onsuccess?.()); return request; } });
    await expect(clearDeviceData()).resolves.toBe(true);
    expect([...values.keys()].sort()).toEqual(["other", "yorun.roomRoadMap", "yorun.runVoice", "yorun.voice"]);
    expect(deleted.sort()).toEqual(["runcanvas", "yorun-roadmaps"]);
  });

  it("달리는 중인 기록만 진행 중으로 본다", () => {
    expect(hasRunInProgress()).toBe(false);
    values.set("runcanvas.activeRun", JSON.stringify({ record: { resumedAt: 5 } }));
    expect(hasRunInProgress()).toBe(true);
    values.set("runcanvas.activeRun", JSON.stringify({ record: { resumedAt: null } }));
    expect(hasRunInProgress()).toBe(false);
    values.set("runcanvas.activeRun", JSON.stringify({ record: { resumedAt: 5 }, finished: { points: 0 } }));
    expect(hasRunInProgress()).toBe(false);
  });
});
