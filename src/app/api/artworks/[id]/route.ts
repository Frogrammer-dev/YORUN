import { patchArtworkSchema } from "@/lib/contracts/schemas";
import { HttpError, assertUuid, assertWriteRequest, handle, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";
import { toArtworkView } from "@/lib/server/repositories";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** 본인의 정규화 기준선·메타데이터. */
export function GET(_req: Request, ctx: Ctx) {
  return handle("GET /api/artworks/[id]", async () => {
    const { id } = await ctx.params;
    assertUuid(id);
    const { supabase, user } = await requireUser();
    const { data, error } = await supabase
      .from("artworks")
      .select("id, title, source_kind, revision, stats_json, geometry_json, created_at")
      .eq("id", id)
      .eq("owner_id", user.id)
      .maybeSingle();
    if (error) throw mapDbError(error);
    const view = data ? toArtworkView(data, { includeGeometry: true }) : null;
    if (!view) throw new HttpError(404, "not_found", "찾을 수 없어요.");
    return ok(view);
  });
}

/** 제목과 expectedRevision만 수정한다. geometry는 수정할 수 없다. */
export function PATCH(req: Request, ctx: Ctx) {
  return handle("PATCH /api/artworks/[id]", async () => {
    const { id } = await ctx.params;
    assertUuid(id);
    assertWriteRequest(req);
    const { supabase } = await requireUser();
    const body = await readJson(req, patchArtworkSchema);
    const { data, error } = await supabase.rpc("update_artwork_title", {
      p_artwork_id: id,
      p_title: body.title,
      p_expected_revision: body.expectedRevision,
    });
    if (error) throw mapDbError(error);
    return ok(data);
  });
}

/** 작품·배치 삭제, 관련 공유 폐기, 방 버전 증가. */
export function DELETE(req: Request, ctx: Ctx) {
  return handle("DELETE /api/artworks/[id]", async () => {
    const { id } = await ctx.params;
    assertUuid(id);
    assertWriteRequest(req, { json: false });
    const { supabase } = await requireUser();
    const { data, error } = await supabase.rpc("delete_artwork", { p_artwork_id: id });
    if (error) throw mapDbError(error);
    return ok(data);
  });
}
