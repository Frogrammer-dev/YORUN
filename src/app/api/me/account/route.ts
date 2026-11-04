import { z } from "zod";
import { battleDatabase } from "@/lib/server/battle";
import { HttpError, assertWriteRequest, handle, limit, mapDbError, noContent, readJson, requireUser } from "@/lib/server/http";

/**
 * 로그인한 본인의 계정을 삭제한다. 대상은 항상 세션의 사용자이고, 요청으로 다른 사람을 지정할 수 없다.
 * derby_forget이 실패하면 계정을 지우지 않는다. 같은 요청을 다시 보내도 안전하다.
 */
export function POST(req: Request) {
  return handle("POST account delete", async () => {
    assertWriteRequest(req);
    const { supabase, user } = await requireUser();
    limit("account-delete:" + user.id, 3);
    await readJson(req, z.object({ confirm: z.literal("삭제") }));
    const db = battleDatabase();
    const forgotten = await db.rpc("derby_forget", { p_owner: user.id });
    if (forgotten.error) throw mapDbError(forgotten.error);
    const removed = await db.auth.admin.deleteUser(user.id);
    if (removed.error) throw new HttpError(503, "account_delete_failed", "계정을 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    // 계정은 이미 없으므로 세션 쿠키 정리 실패는 결과에 영향을 주지 않는다
    await supabase.auth.signOut().catch(() => undefined);
    return noContent();
  });
}
