import { handle, ok, requireUser } from "@/lib/server/http";
import { loadMyRoom } from "@/lib/server/repositories";

export const dynamic = "force-dynamic";

/** 기존 방·전시용 선·공유 상태. 없으면 빈 상태. 전체 기준선은 상세 API에서만. */
export function GET() {
  return handle("GET /api/me/room", async () => {
    const { supabase, user } = await requireUser();
    return ok(await loadMyRoom(supabase, user.id));
  });
}
