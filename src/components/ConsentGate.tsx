"use client";
// Google 로그인과 기존 계정은 가입 폼을 거치지 않으므로, 동의 기록이 없으면 동의 화면으로 보낸다.

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { hasValidConsent } from "@/lib/legal/policy";

// 동의 없이도 열려야 하는 화면: 방침 읽기, 로그인, 계정 삭제, 공유 보기, 달리는 중인 화면
const OPEN = ["/consent", "/privacy", "/login", "/settings", "/auth", "/share", "/run"];

export function ConsentGate() {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const auth = browserSupabase()?.auth;
    if (!auth || OPEN.some((path) => pathname === path || pathname.startsWith(path + "/"))) return;
    const { data } = auth.onAuthStateChange((_event, session) => {
      if (session && !hasValidConsent(session.user.user_metadata)) router.replace(`/consent?next=${encodeURIComponent(pathname)}`);
    });
    return () => data.subscription.unsubscribe();
  }, [pathname, router]);
  return null;
}
