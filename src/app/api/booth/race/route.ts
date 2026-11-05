import { randomInt } from "node:crypto";
import { z } from "zod";
import { BOOTH_STYLES, boothRaceResult, boothStats, type BoothStyle } from "@/lib/battle/boothRace";
import type { DerbyStats } from "@/lib/battle/derby";
import { battleDatabase, playerNames } from "@/lib/server/battle";
import { HttpError, assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";

const styles = Object.keys(BOOTH_STYLES) as [BoothStyle, ...BoothStyle[]];
const roll = () => randomInt(1_000_000) / 1_000_000;

export function POST(req: Request) {
  return handle("POST booth race", async () => {
    assertWriteRequest(req);
    const { user } = await requireUser();
    limit("booth-race:" + user.id, 10);
    const { style } = await readJson(req, z.object({ style: z.enum(styles) }));
    const { data, error } = await battleDatabase().rpc("booth_race_enter", { p_owner: user.id, p_stats: boothStats(style, roll) });
    if (error) throw mapDbError(error);
    return ok({ race: data });
  });
}

export function GET(req: Request) {
  return handle("GET booth race", async () => {
    const { user } = await requireUser();
    limit("booth-race-read:" + user.id, 60);
    const race = z.uuid().safeParse(new URL(req.url).searchParams.get("race"));
    if (!race.success) throw new HttpError(400, "bad_race", "경주 번호를 확인해 주세요.");
    const db = battleDatabase();
    const entries = await db.from("booth_race_entries").select("lane,owner_id,stats").eq("race", race.data).order("lane");
    if (entries.error) throw mapDbError(entries.error);
    if (!entries.data.some((entry) => entry.owner_id === user.id)) throw new HttpError(404, "unknown_race", "참가한 경주를 찾을 수 없어요.");
    const status = await db.rpc("booth_race_status", { p_race: race.data });
    if (status.error) throw mapDbError(status.error);
    const { closed, secondsLeft } = status.data as { closed: boolean; secondsLeft: number };
    const nameOf = await playerNames(db, entries.data.map((entry) => entry.owner_id));
    const seats = entries.data.map((entry) => ({ lane: entry.lane, name: nameOf(entry.owner_id), stats: entry.stats as DerbyStats, mine: entry.owner_id === user.id }));
    return ok({
      race: race.data,
      closed,
      secondsLeft,
      players: seats.map(({ lane, name, mine }) => ({ lane, name, mine })),
      result: closed ? boothRaceResult(race.data, seats) : null,
    });
  });
}
