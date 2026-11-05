import { randomInt } from "node:crypto";
import { z } from "zod";
import { BODY_PLANS, type BodyPlan } from "@/lib/battle/bodyPlan";
import { BOOTH_STYLE_IDS, boothRaceResult, boothStats, type BoothStyle } from "@/lib/battle/boothRace";
import type { DerbyStats } from "@/lib/battle/derby";
import { assessTrace, derbyTrace } from "@/lib/battle/derbyTrace";
import { battleDatabase, playerNames } from "@/lib/server/battle";
import { HttpError, assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";
import { verifyRun } from "@/lib/server/verifyRun";

const roll = () => randomInt(1_000_000) / 1_000_000;
// 몸 유형은 연출에만 쓴다. 코스 그림은 위치를 짐작할 수 있어 다른 참가자에게 보내지 않는다
const body = z.enum(BODY_PLANS).default("biped");
const entry = z.union([
  z.object({ style: z.enum(BOOTH_STYLE_IDS as [BoothStyle, ...BoothStyle[]]), body }),
  z.object({ consent: z.literal(true), session: z.uuid(), trace: derbyTrace, body }),
]);

export function POST(req: Request) {
  return handle("POST booth race", async () => {
    assertWriteRequest(req);
    const { user } = await requireUser();
    limit("booth-race:" + user.id, 10);
    const input = await readJson(req, entry);
    let stats: DerbyStats;
    if ("style" in input) {
      stats = boothStats(input.style, roll);
    } else {
      // 인증 기록: 이 계정에서 시작하고 완료 확인을 받은 달리기만 능력치로 쓴다
      await verifyRun(user.id, input.session, input.trace);
      try {
        const { avgPaceSecPerKm, cornering, corners, paceSplits } = assessTrace(input.trace);
        stats = { avgPaceSecPerKm, cornering, corners, paceSplits };
      } catch (error) {
        throw new HttpError(422, "ineligible", (error as Error).message);
      }
    }
    const { data, error } = await battleDatabase().rpc("booth_race_enter", { p_owner: user.id, p_stats: { ...stats, body: input.body } });
    if (error) throw mapDbError(error);
    return ok({ race: data });
  });
}

export function GET(req: Request) {
  return handle("GET booth race", async () => {
    const { user } = await requireUser();
    limit("booth-race-read:" + user.id, 90);
    const race = z.uuid().safeParse(new URL(req.url).searchParams.get("race"));
    if (!race.success) throw new HttpError(400, "bad_race", "경기 번호를 확인해 주세요.");
    const db = battleDatabase();
    const entries = await db.from("booth_race_entries").select("lane,owner_id,stats").eq("race", race.data).order("lane");
    if (entries.error) throw mapDbError(entries.error);
    if (!entries.data.some((row) => row.owner_id === user.id)) throw new HttpError(404, "unknown_race", "참가한 경기를 찾을 수 없어요.");
    const status = await db.rpc("booth_race_status", { p_race: race.data });
    if (status.error) throw mapDbError(status.error);
    const { closed, secondsLeft } = status.data as { closed: boolean; secondsLeft: number };
    const nameOf = await playerNames(db, entries.data.map((row) => row.owner_id));
    const seats = entries.data.map((row) => ({ lane: row.lane, name: nameOf(row.owner_id), stats: row.stats as DerbyStats, mine: row.owner_id === user.id, body: (row.stats as { body?: BodyPlan }).body }));
    return ok({
      race: race.data,
      closed,
      secondsLeft,
      players: seats.map(({ lane, name, mine }) => ({ lane, name, mine })),
      result: closed ? boothRaceResult(race.data, seats) : null,
    });
  });
}
