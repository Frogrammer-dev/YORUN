/** 로그인 뒤 돌아갈 주소. 같은 출처의 상대 경로만 허용한다 (열린 리다이렉트 방지). */
export function safeNext(next: string | null | undefined, fallback = "/room"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}
