"use client";
// 브라우저 인증 클라이언트: 로그인 메일 요청·로그아웃·화면 표시용 사용자 확인에만 쓴다.
// 데이터 권한은 서버(getUser)와 DB(RLS·RPC)에서 판단한다.
import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function browserSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createBrowserClient(url, key) : null;
  return client;
}
