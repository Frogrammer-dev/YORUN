import { beforeEach, describe, expect, it, vi } from "vitest";

// 메모리 속 가짜 DB: 이 API가 쓰는 Supabase 질의 모양(eq·neq·is·gt·or·update…select)만 흉내 낸다
const { store, who } = vi.hoisted(() => ({ store: { rooms: [] as Record<string, unknown>[], seq: 0 }, who: { id: "host-user" } }));

vi.mock("@/lib/server/http", () => {
  class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }
  return {
    HttpError,
    assertWriteRequest: vi.fn(), limit: vi.fn(), mapDbError: (e: unknown) => e,
    requireUser: async () => ({ user: { id: who.id } }),
    readJson: async (req: Request) => req.json(),
    ok: (data: unknown, status = 200) => Response.json(data, { status }),
    handle: async (_: string, run: () => Promise<Response>) => {
      try { return await run(); } catch (e) { return Response.json({ code: (e as { code?: string }).code }, { status: (e as { status?: number }).status ?? 500 }); }
    },
  };
});
vi.mock("@/lib/server/battle", () => {
  type Row = Record<string, unknown>;
  function query(table: string) {
    const filters: ((r: Row) => boolean)[] = [];
    let patch: Row | null = null, insert: Row | null = null, limitN = Infinity;
    const run = () => {
      if (table !== "duel_rooms") return { data: [], error: null };
      if (insert) {
        const row: Row = { id: crypto.randomUUID(), seq: ++store.seq, status: "waiting", turn_no: 0, guest_id: null, guest_name: null, guest_sheet: null, state: null, host_choice: null, guest_choice: null, last_turn: null, left_by: null, expires: new Date(Date.now() + 7_200_000).toISOString(), ...insert };
        if (store.rooms.some((r) => r.code === row.code && r.status !== "finished")) return { data: null, error: { code: "23505" } };
        store.rooms.push(row);
        return { data: [structuredClone(row)], error: null };
      }
      const hit = store.rooms.filter((r) => filters.every((f) => f(r))).slice(0, limitN);
      if (patch) hit.forEach((r) => Object.assign(r, structuredClone(patch)));
      return { data: hit.map((r) => structuredClone(r)), error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q, order: () => q,
      limit: (n: number) => { limitN = n; return q; },
      eq: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      neq: (k: string, v: unknown) => { filters.push((r) => r[k] !== v); return q; },
      is: (k: string, v: unknown) => { filters.push((r) => r[k] === v); return q; },
      gt: (k: string, v: string) => { filters.push((r) => String(r[k]) > v); return q; },
      or: (expr: string) => { const ids = [...expr.matchAll(/(\w+)\.eq\.([^,]+)/g)]; filters.push((r) => ids.some(([, k, v]) => r[k] === v)); return q; },
      insert: (row: Row) => { insert = row; return q; },
      update: (p: Row) => { patch = p; return q; },
      maybeSingle: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error }; },
      single: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error }; },
      then: (resolve: (v: unknown) => void) => resolve(run()),
    };
    return q;
  }
  return { battleDatabase: () => ({ from: query }), playerNames: async () => (id: string) => (id === "host-user" ? "방장" : "손님") };
});

import { GET, POST } from "@/app/api/duel/room/route";
const as = (id: string) => { who.id = id; };
const post = async (body: unknown) => { const r = await POST(new Request("http://localhost/api/duel/room", { method: "POST", body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const get = async (q = "") => (await GET(new Request("http://localhost/api/duel/room" + q))).json();

beforeEach(() => { store.rooms.length = 0; as("host-user"); });

describe("친구와 1대1 대결 방", () => {
  it("방을 만들면 6자리 번호가 생기고, 다른 사람이 번호로 들어오면 시작한다", async () => {
    const made = await post({ action: "create", style: "balance" });
    expect(made.status).toBe(201);
    expect(made.body.code).toMatch(/^\d{6}$/);
    expect(made.body.status).toBe("waiting");
    expect(made.body.foe).toBeNull();
    as("guest-user");
    const joined = await post({ action: "join", code: made.body.code, style: "speed" });
    expect(joined.body).toMatchObject({ status: "playing", role: "guest", me: { name: "손님" }, foe: { name: "방장" } });
    // 손님 화면에서는 내가 0번이다
    expect(joined.body.state.sheets[0]).toEqual(joined.body.me.sheet);
  });

  it("세 번째 사람은 못 들어오고, 자기 방 번호를 넣으면 그 방으로 돌아간다", async () => {
    const { body: room } = await post({ action: "create" });
    expect((await post({ action: "join", code: room.code })).body.role).toBe("host");
    as("guest-user");
    await post({ action: "join", code: room.code });
    as("third-user");
    expect((await post({ action: "join", code: room.code })).status).toBe(409);
    expect((await post({ action: "join", code: "000000" })).status).toBe(404);
  });

  it("한 사람이 고르면 상대에게는 '냈는지'만 보이고, 둘 다 고르면 한 번만 판정한다", async () => {
    const { body: room } = await post({ action: "create" });
    as("guest-user");
    await post({ action: "join", code: room.code });
    as("host-user");
    const first = await post({ action: "turn", id: room.id, choice: "rock" });
    expect(first.body).toMatchObject({ myChoice: "rock", foeChose: false, turnNo: 0 });
    expect((await post({ action: "turn", id: room.id, choice: "paper" })).status).toBe(409);
    as("guest-user");
    const peek = await get(`?id=${room.id}`);
    expect(peek.foeChose).toBe(true);
    expect(JSON.stringify(peek)).not.toContain("rock");
    const second = await post({ action: "turn", id: room.id, choice: "scissors" });
    // 바위가 가위를 이긴다: 손님(나)이 피해를 받는다
    expect(second.body).toMatchObject({ turnNo: 1, myChoice: null, foeChose: false, log: { choices: ["scissors", "rock"] } });
    expect(second.body.log.damage[0]).toBeGreaterThan(0);
    expect(second.body.state.hp[0]).toBeLessThan(second.body.state.sheets[0].maxHp);
    as("host-user");
    const host = await get(`?id=${room.id}`);
    expect(host.log.choices).toEqual(["rock", "scissors"]);
    expect(store.rooms[0].turn_no).toBe(1);
  });

  it("진행 중에 나가면 남은 사람이 이기고, 방에 없는 사람은 방을 볼 수 없다", async () => {
    const { body: room } = await post({ action: "create" });
    as("guest-user");
    await post({ action: "join", code: room.code });
    const left = await post({ action: "leave", id: room.id });
    expect(left.body.status).toBe("finished");
    expect(left.body.state.winner).toBe(1);
    as("host-user");
    const host = await get(`?id=${room.id}`);
    expect(host).toMatchObject({ foeLeft: true, state: { winner: 0 } });
    as("stranger");
    const r = await GET(new Request(`http://localhost/api/duel/room?id=${room.id}`));
    expect(r.status).toBe(404);
  });

  it("번호 없이 열면 내가 들어가 있는 끝나지 않은 방을 돌려준다", async () => {
    expect(await get()).toBeNull();
    const { body: room } = await post({ action: "create" });
    expect((await get()).id).toBe(room.id);
    await post({ action: "leave", id: room.id });
    expect(await get()).toBeNull();
  });
});
