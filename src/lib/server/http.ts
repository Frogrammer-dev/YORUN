// 공통 HTTP 처리 (10.1): 오류 구조 {code, message, requestId}, no-store 캐시, 동일 출처·JSON 검사,
// 본문 크기 제한, 서버에서 검증한 사용자 주체. 로그에는 본문·좌표·토큰을 남기지 않는다.
import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { z } from "zod";
import { API_LIMITS } from "@/lib/contracts/limits";
import { zodMessage } from "@/lib/contracts/schemas";
import { appOrigin } from "./env";
import { rateLimit } from "./rateLimit";
import { createUserClient } from "./supabase";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}

const NO_STORE = { "Cache-Control": "private, no-store" };

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function noContent() {
  return new NextResponse(null, { status: 204, headers: NO_STORE });
}

type Handler = (requestId: string) => Promise<Response>;

export async function handle(route: string, fn: Handler): Promise<Response> {
  const requestId = crypto.randomUUID();
  try {
    return await fn(requestId);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status >= 500) console.error(`[${route}] ${e.code} requestId=${requestId}`);
      return NextResponse.json(
        { code: e.code, message: e.message, requestId },
        { status: e.status, headers: { ...NO_STORE, ...e.headers } },
      );
    }
    // 예외 메시지에 사용자 데이터가 섞일 수 있으므로 이름만 기록한다.
    console.error(`[${route}] unexpected ${(e as Error)?.name ?? "Error"} requestId=${requestId}`);
    return NextResponse.json(
      { code: "internal", message: "요청을 처리하지 못했어요.", requestId },
      { status: 500, headers: NO_STORE },
    );
  }
}

/** 쿠키 기반 쓰기: 동일 출처 Origin과 JSON Content-Type 검사. */
export function assertWriteRequest(req: Request, { json = true } = {}) {
  const origin = req.headers.get("origin");
  const allowed = new Set([new URL(req.url).origin]);
  const configured = appOrigin();
  if (configured) allowed.add(configured);
  if (!origin || !allowed.has(origin)) throw new HttpError(403, "forbidden_origin", "허용되지 않은 출처의 요청이에요.");
  if (json) {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.toLowerCase().startsWith("application/json")) {
      throw new HttpError(400, "invalid_content_type", "JSON 요청만 받을 수 있어요.");
    }
  }
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>, maxBytes: number = API_LIMITS.maxBodyBytes): Promise<T> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new HttpError(413, "payload_too_large", "요청 크기가 한도(2 MiB)를 넘어요.");
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) throw new HttpError(413, "payload_too_large", "요청 크기가 한도(2 MiB)를 넘어요.");
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, "invalid_json", "JSON 형식이 올바르지 않아요.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, "invalid_input", zodMessage(parsed.error));
  return parsed.data;
}

export function clientKey(req: Request) {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export function limit(key: string, max: number, windowMs = 60_000) {
  const r = rateLimit(key, max, windowMs);
  if (!r.ok) {
    throw new HttpError(429, "rate_limited", `요청이 많아요. ${r.retryAfterSec}초 뒤에 다시 시도해 주세요.`, {
      "Retry-After": String(r.retryAfterSec),
    });
  }
}

/**
 * 서버가 getUser로 검증한 주체만 인정한다 (11.1). getSession·클라이언트 user_id는 쓰지 않는다.
 * 인증 조회 실패는 성공으로 간주하지 않는다.
 */
export async function requireUser(): Promise<{ supabase: SupabaseClient; user: User }> {
  const supabase = await createUserClient();
  if (!supabase) throw new HttpError(503, "storage_unavailable", "저장 서비스가 설정되지 않았어요. 현재 편집 내용은 이 기기에만 있어요.");
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "unauthenticated", "로그인이 필요해요.");
  return { supabase, user: data.user };
}

/** DB 함수가 올린 사용자 정의 SQLSTATE → HTTP. 나머지는 503(저장 서비스 이용 불가). */
export function mapDbError(error: { code?: string; message?: string } | null): HttpError {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  switch (code) {
    case "RC400":
      return new HttpError(400, "invalid_input", msg || "입력이 올바르지 않아요.");
    case "RC401":
      return new HttpError(401, "unauthenticated", "로그인이 필요해요.");
    case "RC404":
      return new HttpError(404, "not_found", "찾을 수 없어요.");
    case "RC409":
      return new HttpError(409, msg || "conflict", conflictMessage(msg));
    case "RC422":
      return new HttpError(422, msg || "unprocessable", limitMessage(msg));
    case "42501":
      return new HttpError(404, "not_found", "찾을 수 없어요.");
    case "PGRST301":
    case "PGRST302":
      return new HttpError(401, "unauthenticated", "로그인이 필요해요.");
    default:
      return new HttpError(503, "storage_unavailable", "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.");
  }
}

function conflictMessage(code: string) {
  if (code === "request_id_reused") return "같은 요청 ID로 다른 내용을 보냈어요.";
  return "다른 창에서 방이 바뀌었어요.";
}

function limitMessage(code: string) {
  switch (code) {
    case "artwork_limit":
      return "보관 작품이 한도(50개)에 도달했어요.";
    case "display_limit":
      return "전시 한도(20개)에 도달했어요.";
    case "snapshot_limit":
      return "공유 스냅샷 한도(점 40,000개·2 MiB)를 넘어 링크를 만들지 않았어요.";
    case "room_not_saved":
      return "먼저 방을 저장해 주세요.";
    default:
      return "처리할 수 없는 요청이에요.";
  }
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function assertUuid(s: string) {
  // 형식이 틀린 ID는 타인 자원과 같은 404로 처리한다.
  if (!isUuid(s)) throw new HttpError(404, "not_found", "찾을 수 없어요.");
}
