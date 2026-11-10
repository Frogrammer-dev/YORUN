// 친구와 하는 1대1 대결 방. 방 만들기 → 6자리 번호 공유 → 상대가 번호로 참가 → 매 턴 두 사람이 각자 선택.
// 둘 다 내면 서버가 판정한다. 상대의 선택은 판정 전까지 보내지 않고, 판정은 turn_no가 그대로일 때만 저장한다.
import { randomInt } from "node:crypto";
import { z } from "zod";
import { BATTLE_CHOICES, BATTLE_STYLE_SHEETS, TRIAL_STATS, battleSheet, resolveTurn, startBattle, type BattleState } from "@/lib/battle/turnBattle";
import type { DuelStats } from "@/lib/battle/duel";
import { ROOM_CODE, forfeitWinner, roleOf, roomCode, roomView, type RoomRow } from "@/lib/battle/room";
import { battleDatabase, playerNames } from "@/lib/server/battle";
import { HttpError, assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";

const random = () => randomInt(1_000_000) / 1_000_000;
const COLUMNS = "id,code,host_id,guest_id,host_name,guest_name,host_sheet,guest_sheet,status,state,turn_no,host_choice,guest_choice,last_turn,left_by,expires";
const style = z.enum(["speed", "balance", "corner"]).optional();
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), style }),
  z.object({ action: z.literal("join"), code: z.string().regex(ROOM_CODE), style }),
  z.object({ action: z.literal("turn"), id: z.uuid(), choice: z.enum(BATTLE_CHOICES) }),
  z.object({ action: z.literal("leave"), id: z.uuid() }),
]);
type Db = ReturnType<typeof battleDatabase>;

/** 고른 캐릭터가 있으면 그 능력치, 없으면 등록한 대표 캐릭터, 그것도 없으면 체험 능력치 */
async function sheetOf(db: Db, userId: string, chosen?: keyof typeof BATTLE_STYLE_SHEETS) {
  if (chosen) return BATTLE_STYLE_SHEETS[chosen];
  const me = await db.from("duel_players").select("stats").eq("owner_id", userId).maybeSingle();
  if (me.error) throw mapDbError(me.error);
  return battleSheet((me.data?.stats as DuelStats | undefined) ?? TRIAL_STATS);
}

async function load(db: Db, id: string, userId: string) {
  const row = await db.from("duel_rooms").select(COLUMNS).eq("id", id).maybeSingle();
  if (row.error) throw mapDbError(row.error);
  const data = row.data as RoomRow | null;
  if (!data || !roleOf(data, userId)) throw new HttpError(404, "unknown_room", "대결 방을 찾을 수 없어요.");
  return data;
}

const view = (row: RoomRow, userId: string) => ok(roomView(row, userId));
const expired = (row: RoomRow) => Date.parse(row.expires) <= Date.now();

export function GET(req: Request) {
  return handle("GET duel room", async () => {
    const { user } = await requireUser();
    // 상대 선택을 기다리는 화면이 1.5초마다 묻는다
    limit("duel-room-read:" + user.id, 120);
    const db = battleDatabase();
    const id = new URL(req.url).searchParams.get("id");
    if (id) {
      if (!z.uuid().safeParse(id).success) throw new HttpError(400, "bad_room", "대결 방을 다시 열어 주세요.");
      return view(await load(db, id, user.id), user.id);
    }
    // 번호 없이 열면 내가 들어가 있는 끝나지 않은 방으로 돌아간다
    const open = await db.from("duel_rooms").select(COLUMNS).or(`host_id.eq.${user.id},guest_id.eq.${user.id}`).neq("status", "finished").gt("expires", new Date().toISOString()).order("updated", { ascending: false }).limit(1);
    if (open.error) throw mapDbError(open.error);
    const row = (open.data?.[0] ?? null) as RoomRow | null;
    return ok(row ? roomView(row, user.id) : null);
  });
}

export function POST(req: Request) {
  return handle("POST duel room", async () => {
    assertWriteRequest(req);
    const { user } = await requireUser();
    limit("duel-room:" + user.id, 120);
    const input = await readJson(req, command);
    const db = battleDatabase();

    if (input.action === "create") {
      limit("duel-room-create:" + user.id, 10);
      const [sheet, nameOf] = await Promise.all([sheetOf(db, user.id, input.style), playerNames(db, [user.id])]);
      // 끝나지 않은 방과 번호가 겹치면 다른 번호로 몇 번 더 시도한다
      for (let attempt = 0; attempt < 6; attempt++) {
        const created = await db.from("duel_rooms").insert({ code: roomCode(randomInt(1_000_000)), host_id: user.id, host_name: nameOf(user.id), host_sheet: sheet }).select(COLUMNS).single();
        if (!created.error) return ok(roomView(created.data as RoomRow, user.id), 201);
        if (created.error.code !== "23505") throw mapDbError(created.error);
      }
      throw new HttpError(503, "room_busy", "방 번호를 만들지 못했어요. 잠시 뒤 다시 시도해 주세요.");
    }

    if (input.action === "join") {
      limit("duel-room-join:" + user.id, 20);
      const found = await db.from("duel_rooms").select(COLUMNS).eq("code", input.code).neq("status", "finished").maybeSingle();
      if (found.error) throw mapDbError(found.error);
      const room = found.data as RoomRow | null;
      if (!room || expired(room)) throw new HttpError(404, "unknown_room", "그 번호의 방이 없어요. 번호를 다시 확인해 주세요.");
      if (room.host_id === user.id) return view(room, user.id);
      if (room.guest_id === user.id) return view(room, user.id);
      if (room.status !== "waiting") throw new HttpError(409, "room_full", "이미 다른 사람과 대결 중인 방이에요.");
      const [sheet, nameOf] = await Promise.all([sheetOf(db, user.id, input.style), playerNames(db, [user.id])]);
      const state = startBattle(room.host_sheet, sheet);
      // 두 사람이 동시에 들어와도 한 사람만 들어간다
      const joined = await db.from("duel_rooms")
        .update({ guest_id: user.id, guest_name: nameOf(user.id), guest_sheet: sheet, state, status: "playing", updated: new Date().toISOString() })
        .eq("id", room.id).eq("status", "waiting").is("guest_id", null).select(COLUMNS);
      if (joined.error) throw mapDbError(joined.error);
      if (!joined.data?.length) throw new HttpError(409, "room_full", "방금 다른 사람이 먼저 들어왔어요.");
      return view(joined.data[0] as RoomRow, user.id);
    }

    const room = await load(db, input.id, user.id);
    const role = roleOf(room, user.id)!;

    if (input.action === "leave") {
      if (room.status === "finished") return view(room, user.id);
      const patch = room.status === "waiting"
        ? { status: "finished", updated: new Date().toISOString() }
        : { status: "finished", left_by: role, state: { ...(room.state as BattleState), winner: forfeitWinner(role) }, host_choice: null, guest_choice: null, updated: new Date().toISOString() };
      const left = await db.from("duel_rooms").update(patch).eq("id", room.id).neq("status", "finished").select(COLUMNS);
      if (left.error) throw mapDbError(left.error);
      return view(((left.data?.[0] as RoomRow | undefined) ?? (await load(db, room.id, user.id))), user.id);
    }

    // turn
    if (room.status !== "playing" || !room.state) throw new HttpError(409, "not_playing", room.status === "waiting" ? "아직 상대가 들어오지 않았어요." : "이미 끝난 대결이에요.");
    if (expired(room)) throw new HttpError(409, "room_expired", "대결 시간이 지났어요. 새 방을 만들어 주세요.");
    const mine = role === "host" ? "host_choice" : "guest_choice";
    if (room[mine]) throw new HttpError(409, "already_chosen", "이번 턴은 이미 골랐어요. 상대를 기다리는 중이에요.");
    const chosen = await db.from("duel_rooms").update({ [mine]: input.choice, updated: new Date().toISOString() })
      .eq("id", room.id).eq("status", "playing").eq("turn_no", room.turn_no).is(mine, null).select(COLUMNS);
    if (chosen.error) throw mapDbError(chosen.error);
    const now = (chosen.data?.[0] as RoomRow | undefined) ?? (await load(db, room.id, user.id));
    // 둘 다 냈으면 판정한다. 두 사람이 동시에 판정해도 turn_no 조건으로 한 번만 저장된다
    if (now.status === "playing" && now.state && now.host_choice && now.guest_choice && now.turn_no === room.turn_no) {
      const { state, log } = resolveTurn(now.state, [now.host_choice, now.guest_choice], [random(), random()]);
      const resolved = await db.from("duel_rooms")
        .update({ state, last_turn: log, turn_no: now.turn_no + 1, host_choice: null, guest_choice: null, status: state.winner === null ? "playing" : "finished", updated: new Date().toISOString() })
        .eq("id", room.id).eq("turn_no", now.turn_no).select(COLUMNS);
      if (resolved.error) throw mapDbError(resolved.error);
      return view(((resolved.data?.[0] as RoomRow | undefined) ?? (await load(db, room.id, user.id))), user.id);
    }
    return view(now, user.id);
  });
}
