"use client";
// 메인·콘텐츠 앱 바의 계정 입구. 저장 서비스가 없는 실행 환경에서는 숨긴다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { browserSupabase } from "@/lib/client/supabaseBrowser";

export function AccountButton() {
  const [state, setState] = useState<"unknown" | "none" | "in" | "out">("unknown");
  useEffect(() => {
    const auth = browserSupabase()?.auth;
    if (!auth) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장 서비스 설정은 브라우저에서 확인한다
      setState("none");
      return;
    }
    const { data } = auth.onAuthStateChange((_event, session) => setState(session ? "in" : "out"));
    return () => data.subscription.unsubscribe();
  }, []);
  if (state === "unknown" || state === "none") return null;
  if (state === "in") {
    return (
      <Link href="/login" className="icon-btn" aria-label="내 계정">
        <Icon name="person" size={24} />
      </Link>
    );
  }
  return <Link href="/login" className="btn btn-primary btn-sm">로그인</Link>;
}
