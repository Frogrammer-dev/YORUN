import { NextResponse } from "next/server";
import { HttpError, clientKey, handle, limit } from "@/lib/server/http";
import { readSharedSnapshot } from "@/lib/server/shareRead";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ token: string }> };

/** 유효한 스냅샷만 조회. 없음·만료·폐기·형식 오류는 모두 같은 404. */
export function GET(req: Request, ctx: Ctx) {
  return handle("GET /api/shared/[token]", async () => {
    limit(`shared:${clientKey(req)}`, 60);
    const { token } = await ctx.params;
    const r = await readSharedSnapshot(token);
    if (r.status === "unavailable") throw new HttpError(503, "storage_unavailable", "잠시 뒤 다시 시도해 주세요.");
    if (r.status === "not_found") throw new HttpError(404, "not_found", "공유가 종료되었거나 링크를 찾을 수 없어요.");
    return NextResponse.json(r.snapshot, {
      headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex" },
    });
  });
}
