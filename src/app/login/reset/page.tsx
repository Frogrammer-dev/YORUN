"use client";
// 재설정 메일의 링크로 도착하는 화면. 콜백에서 만든 세션으로 새 비밀번호를 저장한다.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icon } from "@/components/Icon";
import { MIN_PASSWORD_LENGTH, authErrorMessage } from "@/lib/client/authMessages";
import { browserSupabase } from "@/lib/client/supabaseBrowser";

export default function ResetPasswordPage() {
  const supabase = browserSupabase();
  const [ready, setReady] = useState<boolean | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!supabase) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 저장 서비스 설정은 브라우저에서 확인한다
      setReady(false);
      return;
    }
    void supabase.auth.getUser().then(({ data }) => setReady(!!data.user));
  }, [supabase]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !supabase) return;
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (failure) setError(authErrorMessage(failure));
    else setDone(true);
  }

  return (
    <main className="hub-page auth-page">
      <header className="appbar">
        <Link href="/login" className="icon-btn appbar-back" aria-label="로그인으로 돌아가기">
          <Icon name="back" size={24} />
        </Link>
        <span className="appbar-title">
          <h1>새 비밀번호</h1>
        </span>
      </header>
      <div className="hub-body">
        <section className="hub-card">
          {ready === undefined && <p className="hint">링크를 확인하고 있어요.</p>}
          {ready === false && (
            <>
              <p>재설정 링크가 만료됐거나 이미 사용됐어요. 재설정 메일을 다시 받아 주세요.</p>
              <Link href="/login" className="btn btn-secondary wide">로그인 화면으로</Link>
            </>
          )}
          {ready && done && (
            <div role="status">
              <p>비밀번호를 바꿨어요.</p>
              <Link href="/" className="btn btn-primary wide">메인으로</Link>
            </div>
          )}
          {ready && !done && (
            <form onSubmit={(e) => void save(e)}>
              <label className="field">
                <span>새 비밀번호 ({MIN_PASSWORD_LENGTH}자 이상)</span>
                <input type="password" name="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? "reset-error" : undefined} />
              </label>
              {error && <p id="reset-error" className="auth-error" role="alert">{error}</p>}
              <button type="submit" className="btn btn-primary wide" disabled={busy} aria-busy={busy}>{busy ? "저장하는 중" : "비밀번호 저장"}</button>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
