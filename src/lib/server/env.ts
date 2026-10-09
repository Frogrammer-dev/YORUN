// 서버 환경 설정. service key는 서버에서만 읽으며 NEXT_PUBLIC 변수에 두지 않는다 (11.1).
import "server-only";

export function supabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && anonKey ? { url, anonKey } : null;
}

export function serviceRoleKey(): string | null {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

export function appOrigin(): string | null {
  return process.env.APP_ORIGIN || null;
}
