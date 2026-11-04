"use client";
// 로그인·회원가입 입력. Google과 이메일 방식을 함께 고른다. 비밀번호는 Supabase Auth만 다루고 앱은 저장하지 않는다.

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MIN_PASSWORD_LENGTH, authErrorMessage } from "@/lib/client/authMessages";

type Mode = "signin" | "signup" | "reset" | "link";

const SUBMIT: Record<Mode, string> = { signin: "로그인", signup: "회원가입", reset: "재설정 메일 받기", link: "로그인 링크 받기" };
const SENT: Record<Exclude<Mode, "signin">, string> = {
  signup: "인증 메일을 보냈어요. 메일의 링크를 누르면 가입이 끝나요. 이미 가입한 이메일이라면 로그인해 주세요.",
  reset: "가입한 이메일이라면 재설정 메일이 도착해요. 메일의 링크를 눌러 새 비밀번호를 정해 주세요.",
  link: "메일로 로그인 링크를 보냈어요. 같은 브라우저에서 링크를 열어 주세요.",
};

export function AuthForm({ supabase, prepareNext, onNavigate, keepNotice, draftLost }: {
  supabase: SupabaseClient;
  /** 로그인 뒤 돌아갈 상대 경로 */
  prepareNext: () => Promise<string>;
  /** 세션을 쿠키에 쓴 뒤 화면 전체를 새로 연다 */
  onNavigate: (path: string) => void;
  /** 임시 작품을 이어받을 때의 안내 */
  keepNotice?: string;
  /** 메일 전송 뒤 임시 작품을 보관하지 못했다는 안내 */
  draftLost?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Exclude<Mode, "signin"> | null>(null);

  const needsPassword = mode === "signin" || mode === "signup";
  const tooShort = mode === "signup" && password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  function choose(next: Mode) {
    setMode(next);
    setError(null);
    setSent(null);
    if (next !== "signin" && next !== "signup") setPassword("");
  }

  const callback = (next: string) => `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

  async function google() {
    setBusy(true);
    setError(null);
    const { error: failure } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback(await prepareNext()) } });
    // 성공하면 구글 화면으로 이동했다가 /auth/callback으로 돌아온다
    if (failure) {
      setError("Google 로그인을 시작하지 못했어요. 이메일로 계속하거나 다시 시도해 주세요.");
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) {
      setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`);
      return;
    }
    setBusy(true);
    setError(null);
    const address = email.trim();
    try {
      const next = await prepareNext();
      if (mode === "signin") {
        const { error: failure } = await supabase.auth.signInWithPassword({ email: address, password });
        if (failure) throw failure;
        onNavigate(next);
        return;
      }
      if (mode === "signup") {
        const { data, error: failure } = await supabase.auth.signUp({ email: address, password, options: { emailRedirectTo: callback(next) } });
        if (failure) throw failure;
        // 메일 인증을 끈 프로젝트에서는 가입과 동시에 로그인된다
        if (data.session) {
          onNavigate(next);
          return;
        }
      } else if (mode === "reset") {
        const { error: failure } = await supabase.auth.resetPasswordForEmail(address, { redirectTo: callback("/login/reset") });
        if (failure) throw failure;
      } else {
        const { error: failure } = await supabase.auth.signInWithOtp({ email: address, options: { emailRedirectTo: callback(next) } });
        if (failure) throw failure;
      }
      setPassword("");
      setSent(mode);
    } catch (failure) {
      setError(authErrorMessage(failure as { code?: string }));
    }
    setBusy(false);
  }

  if (sent) {
    return (
      <div className="auth-sent" role="status">
        <p>{SENT[sent]}</p>
        {draftLost && <p className="auth-error">이 기기에 임시 작품을 보관하지 못했어요. 로그인 후 파일을 다시 선택해야 할 수 있어요.</p>}
        <button type="button" className="btn btn-secondary wide" onClick={() => choose("signin")}>로그인 화면으로</button>
      </div>
    );
  }

  return (
    <div className="auth-form">
      <button type="button" className="btn btn-secondary wide" onClick={() => void google()} disabled={busy}>
        Google로 계속하기
      </button>
      <p className="auth-divider"><span>또는 이메일로</span></p>

      {needsPassword ? (
        <div className="seg" role="radiogroup" aria-label="이메일로 로그인 또는 회원가입">
          {(["signin", "signup"] as const).map((m) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={`seg-btn ${mode === m ? "seg-on" : ""}`} onClick={() => choose(m)}>
              {SUBMIT[m]}
            </button>
          ))}
        </div>
      ) : (
        <h3 className="auth-mode-title">{mode === "reset" ? "비밀번호 재설정" : "메일 링크로 로그인"}</h3>
      )}

      <form onSubmit={(e) => void submit(e)} noValidate={false}>
        <label className="field">
          <span>이메일</span>
          <input type="email" name="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" aria-invalid={error ? true : undefined} aria-describedby={error ? "auth-error" : undefined} />
        </label>
        {needsPassword && (
          <div className="field">
            <label htmlFor="auth-password">비밀번호{mode === "signup" ? ` (${MIN_PASSWORD_LENGTH}자 이상)` : ""}</label>
            <div className="auth-password">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                name="password"
                required
                minLength={mode === "signup" ? MIN_PASSWORD_LENGTH : undefined}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                aria-invalid={error || tooShort ? true : undefined}
                aria-describedby={error ? "auth-error" : undefined}
              />
              <button type="button" className="btn btn-ghost btn-sm" aria-pressed={showPassword} aria-label="입력한 글자 표시" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? "숨기기" : "보기"}
              </button>
            </div>
          </div>
        )}
        {keepNotice && <p className="hint">{keepNotice}</p>}
        {error && <p id="auth-error" className="auth-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn-primary wide" disabled={busy} aria-busy={busy}>
          {busy ? "처리하는 중" : SUBMIT[mode]}
        </button>
      </form>

      <div className="auth-links">
        {mode === "signin" ? (
          <>
            <button type="button" className="btn btn-link" onClick={() => choose("reset")}>비밀번호를 잊었어요</button>
            <button type="button" className="btn btn-link" onClick={() => choose("link")}>메일 링크로 로그인</button>
          </>
        ) : !needsPassword ? (
          <button type="button" className="btn btn-link" onClick={() => choose("signin")}>비밀번호로 로그인</button>
        ) : null}
      </div>
    </div>
  );
}
