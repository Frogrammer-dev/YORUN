// 브라우저 → 서버 API 호출. 오류는 {code, message, requestId} 구조로 받는다.
import type { ApiErrorBody } from "@/lib/contracts/types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiError(0, "offline", "네트워크에 연결할 수 없어요.");
  }
  if (res.status === 204) return undefined as T;
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // 본문 없는 오류
  }
  if (!res.ok) {
    const e = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, e.code ?? "error", e.message ?? "요청을 처리하지 못했어요.", e.requestId);
  }
  return data as T;
}
