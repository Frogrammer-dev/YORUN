"use client";
// 로그인 화면. 이미 로그인했다면 계정 상태와 로그아웃을 보여 준다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { AuthForm } from "./AuthForm";
import { BrandMark, Icon } from "./Icon";
import { browserSupabase } from "@/lib/client/supabaseBrowser";

export function LoginScreen({ next }: { next: string }) {
  const supabase = browserSupabase();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setEmail(data.user ? (data.user.email ?? "로그인한 계정") : null));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 복귀 주소의 실패 표시는 브라우저에서만 읽는다
    setFailed(new URLSearchParams(window.location.search).get("login") === "failed");
  }, [supabase]);

  async function signOut() {
    setBusy(true);
    await supabase?.auth.signOut();
    setEmail(null);
    setBusy(false);
  }

  return (
    <main className="hub-page auth-page">
      <header className="appbar">
        <Link href="/" className="icon-btn appbar-back" aria-label="메인으로 돌아가기">
          <Icon name="back" size={24} />
        </Link>
      </header>
      <div className="hub-body">
        <div className="auth-head">
          <BrandMark size={44} />
          <h1>{email ? "로그인했어요" : "요런 계정으로 계속하기"}</h1>
          {!email && <p>작품을 어느 기기에서나 보고, 다른 러너와 대결할 수 있어요.</p>}
        </div>

        {failed && !email && <p className="auth-error" role="alert">로그인하지 못했어요. 메일 링크가 만료됐을 수 있어요. 다시 시도해 주세요.</p>}

        {!supabase && <section className="hub-card"><p>이 실행 환경에는 저장 서비스(Supabase)가 설정되어 있지 않아요. 로그인 없이 코스 찾기와 달리기, 임시 작품방을 쓸 수 있어요.</p></section>}

        {supabase && email === undefined && <p className="hint">계정을 확인하고 있어요.</p>}

        {supabase && email === null && (
          <section className="hub-card">
            <AuthForm supabase={supabase} prepareNext={async () => next} onNavigate={(path) => window.location.assign(path)} />
          </section>
        )}

        {supabase && email && (
          <section className="hub-card">
            <h2>{email}</h2>
            <Link href={next} className="btn btn-primary wide">계속하기</Link>
            <button type="button" className="btn btn-secondary wide" disabled={busy} onClick={() => void signOut()}>로그아웃</button>
            <Link href="/settings" className="btn btn-link wide">데이터와 계정</Link>
          </section>
        )}
      </div>
    </main>
  );
}
