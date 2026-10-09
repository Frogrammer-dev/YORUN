import { createShareSchema } from "@/lib/contracts/schemas";
import { assertUuid, assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";
import { newShareToken } from "@/lib/server/shareToken";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** 저장 버전 스냅샷·새 토큰·만료시각. 토큰 원문은 이 응답에서만 전달한다. */
export function POST(req: Request, ctx: Ctx) {
  return handle("POST /api/rooms/[id]/shares", async () => {
    const { id } = await ctx.params;
    assertUuid(id);
    assertWriteRequest(req);
    const { supabase, user } = await requireUser();
    limit(`shares:${user.id}`, 10);
    const body = await readJson(req, createShareSchema);
    const { token, hash } = newShareToken();
    const { data, error } = await supabase.rpc("create_room_share", {
      p_room_id: id,
      p_expected_revision: body.expectedRevision,
      p_token_hash: hash,
      p_include_titles: body.includeTitles,
      p_include_distances: body.includeDistances,
      p_display_name: body.displayName,
    });
    if (error) throw mapDbError(error);
    const origin = process.env.APP_ORIGIN || new URL(req.url).origin;
    const d = data as { shareId: string; expiresAt: string; sourceRevision: number };
    return ok({ ...d, url: `${origin}/share/${token}` }, 201);
  });
}
