// ShareService 읽기 모듈 (11.1): 공개 조회에 필요한 서버 권한 클라이언트는 여기서만 사용한다.
// 해시·만료·폐기 조건과 공개 DTO 스키마를 다시 검사하고, 실패는 모두 같은 "없음"으로 처리한다.
import "server-only";
import type { ShareSnapshot } from "@/lib/contracts/types";
import { shareSnapshotSchema } from "@/lib/contracts/schemas";
import { createServiceClientForShareRead } from "./supabase";
import { TOKEN_PATTERN, hashShareToken } from "./shareToken";

export type ShareReadResult = { status: "ok"; snapshot: ShareSnapshot } | { status: "not_found" } | { status: "unavailable" };

export async function readSharedSnapshot(token: string): Promise<ShareReadResult> {
  if (!TOKEN_PATTERN.test(token)) return { status: "not_found" };
  const client = createServiceClientForShareRead();
  if (!client) return { status: "unavailable" };
  const { data, error } = await client
    .from("room_shares")
    .select("snapshot_json, expires_at, revoked_at")
    .eq("token_hash", hashShareToken(token))
    .maybeSingle();
  if (error) return { status: "unavailable" };
  if (!data || data.revoked_at || !(Date.parse(data.expires_at) > Date.now())) return { status: "not_found" };
  const parsed = shareSnapshotSchema.safeParse(data.snapshot_json);
  if (!parsed.success) return { status: "not_found" };
  return { status: "ok", snapshot: parsed.data as ShareSnapshot };
}
