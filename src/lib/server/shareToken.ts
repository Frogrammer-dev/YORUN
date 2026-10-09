// 11.2: 암호학적 난수 32바이트 base64url 토큰. DB에는 SHA-256 해시만 저장한다.
import { createHash, randomBytes } from "node:crypto";
import { SHARE } from "@/lib/contracts/limits";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newShareToken(): { token: string; hash: string } {
  const token = randomBytes(SHARE.tokenBytes).toString("base64url");
  return { token, hash: hashShareToken(token) };
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
