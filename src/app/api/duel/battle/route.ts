import { randomInt } from "node:crypto";
import { z } from "zod";
import { BATTLE_BOTS, BATTLE_CHOICES, TRIAL_STATS, battleSheet, botChoice, resolveTurn, startBattle, type BattleState } from "@/lib/battle/turnBattle";
import type { DuelStats } from "@/lib/battle/duel";
import { battleDatabase, playerNames } from "@/lib/server/battle";
import { HttpError, assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";

const random = () => randomInt(1_000_000) / 1_000_000;
const command = z.discriminatedUnion("action", [
  z.object({ action: z.literal("start"), opponent: z.string().min(1).max(40) }),
  z.object({ action: z.literal("turn"), id: z.uuid(), choice: z.enum(BATTLE_CHOICES) }),
]);

export function GET() {
  return handle("GET duel battle", async () => {
    const { user } = await requireUser();
    limit("duel-battle-read:" + user.id, 60);
    const db = battleDatabase();
    const [me, others, history] = await Promise.all([
      db.from("duel_players").select("stats").eq("owner_id", user.id).maybeSingle(),
      db.from("duel_players").select("player_id,owner_id,stats").neq("owner_id", user.id).order("updated", { ascending: false }).order("player_id").limit(10),
      db.from("duel_battles").select("id,opponent_name,state,updated").eq("owner_id", user.id).eq("finished", true).order("updated", { ascending: false }).limit(10),
    ]);
    if (me.error || others.error || history.error) throw mapDbError(me.error || others.error || history.error);
    const nameOf = await playerNames(db, [user.id, ...others.data.map((p) => p.owner_id)]);
    const card = (id: string, name: string, stats: Pick<DuelStats, "distanceM" | "adherence">, bot: boolean) => ({ id, name, bot, sheet: battleSheet(stats) });
    return ok({
      me: { name: nameOf(user.id), registered: !!me.data, sheet: battleSheet((me.data?.stats as DuelStats | undefined) ?? TRIAL_STATS) },
      opponents: [
        ...others.data.map((p) => card(p.player_id, nameOf(p.owner_id), p.stats as DuelStats, false)),
        ...BATTLE_BOTS.map((b) => card(b.id, b.name, b.stats, true)),
      ],
      history: history.data.map((h) => ({ id: h.id, opponent: h.opponent_name, winner: (h.state as BattleState).winner, turns: (h.state as BattleState).turn })),
    });
  });
}

export function POST(req: Request) {
  return handle("POST duel battle", async () => {
    assertWriteRequest(req);
    const { user } = await requireUser();
    limit("duel-battle:" + user.id, 120);
    const input = await readJson(req, command);
    const db = battleDatabase();

    if (input.action === "start") {
      const me = await db.from("duel_players").select("stats").eq("owner_id", user.id).maybeSingle();
      if (me.error) throw mapDbError(me.error);
      const bot = BATTLE_BOTS.find((b) => b.id === input.opponent);
      let opponentName: string, stats: Pick<DuelStats, "distanceM" | "adherence">;
      if (bot) {
        opponentName = bot.name;
        stats = bot.stats;
      } else {
        const parsed = z.uuid().safeParse(input.opponent);
        if (!parsed.success) throw new HttpError(400, "bad_opponent", "상대를 다시 골라 주세요.");
        const foe = await db.from("duel_players").select("owner_id,stats").eq("player_id", parsed.data).neq("owner_id", user.id).maybeSingle();
        if (foe.error) throw mapDbError(foe.error);
        if (!foe.data) throw new HttpError(404, "unknown_opponent", "상대를 찾을 수 없어요. 목록을 새로고침해 주세요.");
        opponentName = (await playerNames(db, [foe.data.owner_id]))(foe.data.owner_id);
        stats = foe.data.stats as DuelStats;
      }
      const state = startBattle(battleSheet((me.data?.stats as DuelStats | undefined) ?? TRIAL_STATS), battleSheet(stats));
      const created = await db.from("duel_battles").insert({ owner_id: user.id, opponent_name: opponentName, state }).select("id").single();
      if (created.error) throw mapDbError(created.error);
      return ok({ id: created.data.id, opponent: opponentName, state, log: null }, 201);
    }

    const battle = await db.from("duel_battles").select("opponent_name,state").eq("id", input.id).eq("owner_id", user.id).maybeSingle();
    if (battle.error) throw mapDbError(battle.error);
    if (!battle.data) throw new HttpError(404, "unknown_battle", "대결을 찾을 수 없어요.");
    const state = battle.data.state as BattleState;
    if (state.winner !== null) throw new HttpError(409, "battle_over", "이미 끝난 대결이에요.");
    const foeChoice = botChoice(state, 1, random);
    const { state: next, log } = resolveTurn(state, [input.choice, foeChoice], [random(), random()]);
    // 같은 턴을 두 번 보내 결과를 고를 수 없게 한다. 먼저 저장된 턴만 인정한다
    const saved = await db.from("duel_battles")
      .update({ state: next, last_turn: log, finished: next.winner !== null, updated: new Date().toISOString() })
      .eq("id", input.id).eq("owner_id", user.id).eq("state->>turn", String(state.turn)).select("id");
    if (saved.error) throw mapDbError(saved.error);
    if (!saved.data.length) throw new HttpError(409, "stale_turn", "이미 처리된 턴이에요. 화면을 새로고침해 주세요.");
    return ok({ id: input.id, opponent: battle.data.opponent_name, state: next, log });
  });
}
