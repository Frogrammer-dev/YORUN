// 로그인 복귀 (이메일 링크·Google). 복귀 주소는 같은 출처의 상대 경로만 허용한다(열린 리다이렉트 방지).
import { NextResponse } from "next/server";
import { createUserClient } from "@/lib/server/supabase";

export const dynamic = "force-dynamic";

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/room";
  return next;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  const supabase = await createUserClient();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const fail = new URL(next, url.origin);
  fail.searchParams.set("login", "failed");
  return NextResponse.redirect(fail);
}
