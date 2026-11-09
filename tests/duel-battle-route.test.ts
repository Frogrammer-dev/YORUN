import { beforeEach, expect, it, vi } from "vitest";
import { startBattle } from "@/lib/battle/turnBattle";

const { db, updates } = vi.hoisted(() => {
  const updates: { row: Record<string, unknown>; filters: [string, unknown][] }[] = [];
  const db = { battle: null as unknown, saved: true, inserted: [] as unknown[], players: new Map<string, unknown>() };
  return { db, updates };
});

vi.mock("@/lib/server/http", () => {
  class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
  return {
    HttpError,
    assertWriteRequest: vi.fn(), limit: vi.fn(), mapDbError: (e: unknown) => e,
    requireUser: async () => ({ user: { id: "me" } }),
    readJson: async (req: Request) => req.json(),
    ok: (data: unknown, status = 200) => Response.json(data, { status }),
    handle: async (_: string, run: () => Promise<Response>) => {
      try { return await run(); } catch (e) { return Response.json({ code: (e as { code?: string }).code }, { status: (e as { status?: number }).status ?? 500 }); }
    },
  };
});
vi.mock("@/lib/server/battle", () => ({
  playerNames: async () => () => "상대 이름",
  battleDatabase: () => ({
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const chain: Record<string, unknown> = {
        select: () => chain,
        neq: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (field: string, value: unknown) => { filters.push([field, value]); return chain; },
        maybeSingle: async () => {
          if (table === "duel_battles") return { data: db.battle, error: null };
          return { data: null, error: null };
        },
        single: async () => ({ data: { id: "battle-1" }, error: null }),
        insert: (row: unknown) => { db.inserted.push(row); return chain; },
        update: (row: Record<string, unknown>) => {
          const entry = { row, filters };
          updates.push(entry);
          const result = { select: async () => ({ data: db.saved ? [{ id: "battle-1" }] : [], error: null }), eq: (f: string, v: unknown) => { filters.push([f, v]); return result; } };
          return result;
        },
      };
      return chain;
    },
  }),
}));
import { POST } from "@/app/api/duel/battle/route";

const send = (body: unknown) => POST(new Request("http://localhost/api/duel/battle", { method: "POST", body: JSON.stringify(body) }));
const sheet = { maxHp: 100, attack: 20 };

beforeEach(() => {
  updates.length = 0;
  db.saved = true;
  db.inserted.length = 0;
  db.battle = { opponent_name: "봇 꾸준이", state: startBattle(sheet, sheet) };
});

it("봇 대결을 시작하면 사용자가 정할 수 없는 능력치로 저장한다", async () => {
  const response = await send({ action: "start", opponent: "bot-artist" });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ id: "battle-1", opponent: "봇 그림쟁이" });
  expect(db.inserted).toHaveLength(1);
});

it("없는 봇 이름은 거절한다", async () => {
  expect((await send({ action: "start", opponent: "bot-cheat" })).status).toBe(400);
});

it("턴을 저장할 때 이전 턴 번호를 조건으로 걸어 같은 턴을 두 번 처리하지 않는다", async () => {
  const response = await send({ action: "turn", id: "11111111-1111-4111-8111-111111111111", choice: "rock" });
  expect(response.status).toBe(200);
  expect((await response.json()).state.turn).toBe(1);
  expect(updates[0].filters).toContainEqual(["state->>turn", "0"]);
  expect(updates[0].filters).toContainEqual(["owner_id", "me"]);
});

it("이미 처리된 턴을 다시 보내면 결과를 돌려주지 않는다", async () => {
  db.saved = false;
  const response = await send({ action: "turn", id: "11111111-1111-4111-8111-111111111111", choice: "rock" });
  expect(response.status).toBe(409);
  expect((await response.json()).state).toBeUndefined();
});

it("끝난 대결은 더 진행하지 않는다", async () => {
  db.battle = { opponent_name: "봇", state: { ...startBattle(sheet, sheet), winner: 0 } };
  expect((await send({ action: "turn", id: "11111111-1111-4111-8111-111111111111", choice: "rock" })).status).toBe(409);
});

it("다른 사람의 대결은 찾을 수 없다", async () => {
  db.battle = null;
  expect((await send({ action: "turn", id: "11111111-1111-4111-8111-111111111111", choice: "rock" })).status).toBe(404);
});

it("고른 기본 캐릭터의 능력치로 대결을 시작한다", async () => {
  const response = await send({ action: "start", opponent: "bot-artist", style: "corner" });
  expect((await response.json()).state.sheets[0]).toEqual({ maxHp: 108, attack: 18 });
});
