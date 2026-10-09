import { assertUuid, assertWriteRequest, handle, mapDbError, noContent, requireUser } from "@/lib/server/http";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** 소유자의 링크 폐기. */
export function DELETE(req: Request, ctx: Ctx) {
  return handle("DELETE /api/shares/[id]", async () => {
    const { id } = await ctx.params;
    assertUuid(id);
    assertWriteRequest(req, { json: false });
    const { supabase } = await requireUser();
    const { error } = await supabase.rpc("revoke_room_share", { p_share_id: id });
    if (error) throw mapDbError(error);
    return noContent();
  });
}
