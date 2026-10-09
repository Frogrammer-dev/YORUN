import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { serviceRoleKey, supabasePublicEnv } from "./env";

/** 사용자 세션 쿠키를 쓰는 서버 클라이언트. RLS와 auth.uid()가 그대로 적용된다. */
export async function createUserClient(): Promise<SupabaseClient | null> {
  const env = supabasePublicEnv();
  if (!env) return null;
  const store = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // 서버 컴포넌트에서는 쿠키를 쓸 수 없다. 세션 갱신은 라우트 핸들러에서 일어난다.
        }
      },
    },
  });
}

/**
 * 서버 권한 클라이언트. ShareService 읽기 모듈(share-read.ts)에서만 사용한다 (11.1).
 * 다른 모듈에서 import하지 않는다.
 */
export function createServiceClientForShareRead(): SupabaseClient | null {
  const env = supabasePublicEnv();
  const key = serviceRoleKey();
  if (!env || !key) return null;
  return createClient(env.url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
