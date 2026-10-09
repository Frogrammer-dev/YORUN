import { saveRoomSchema } from "@/lib/contracts/schemas";
import { assertUuid, assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** expectedRevision 및 전체 배치·배경 저장 (원자적 비교·갱신). */
export function PUT(req: Request, ctx: Ctx) {
  return handle("PUT /api/rooms/[id]", async () => {
    const { id } = await ctx.params;
    assertUuid(id);
    assertWriteRequest(req);
    const { supabase, user } = await requireUser();
    limit(`rooms:${user.id}`, 60);
    const body = await readJson(req, saveRoomSchema);
    const { data, error } = await supabase.rpc("save_room", { p_room_id: id, p_payload: body });
    if (error) throw mapDbError(error);
    return ok(data);
  });
}
