import { createArtworkSchema } from "@/lib/contracts/schemas";
import { assertWriteRequest, handle, limit, mapDbError, ok, readJson, requireUser } from "@/lib/server/http";
import { listArtworks } from "@/lib/server/repositories";

export const dynamic = "force-dynamic";

/** 보관 목록: 제목·거리·구간 수·전시 여부, 최대 20개씩. 기준선은 포함하지 않는다. */
export function GET(req: Request) {
  return handle("GET /api/artworks", async () => {
    const { supabase, user } = await requireUser();
    const url = new URL(req.url);
    const result = await listArtworks(supabase, user.id, url.searchParams.get("cursor"), Number(url.searchParams.get("limit") ?? 20));
    return ok(result);
  });
}

/** 작품 검증 → 최초 방 생성/기존 방 선택 → 작품 저장·기본 배치 (한 트랜잭션, DB RPC). */
export function POST(req: Request) {
  return handle("POST /api/artworks", async () => {
    assertWriteRequest(req);
    const { supabase, user } = await requireUser();
    limit(`artworks:${user.id}`, 30);
    const body = await readJson(req, createArtworkSchema);
    const { data, error } = await supabase.rpc("create_artwork_and_place", { p_request: body });
    if (error) throw mapDbError(error);
    return ok(data, (data as { duplicate?: boolean }).duplicate ? 200 : 201);
  });
}
