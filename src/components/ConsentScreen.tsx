"use client";
// 첫 로그인 동의. 동의 없이는 계정 기능을 쓰지 못하고, 로그아웃하거나 계정을 지울 수 있다.

import Link from "next/link";
import { useState } from "react";
import { ConsentFields } from "./ConsentFields";
import { BrandMark } from "./Icon";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { CONSENT_REQUIRED_MESSAGE, FEATURES, INITIAL_AGE, consentRecord, type AgeGroup } from "@/lib/legal/policy";

export function ConsentScreen({ next }: { next: string }) {
  const [age, setAge] = useState<AgeGroup | null>(INITIAL_AGE);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    if (busy) return;
    if (age !== "14+" || !agreed) {
      setError(CONSENT_REQUIRED_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await browserSupabase()?.auth.updateUser({ data: { consent: consentRecord(age) } });
    if (!result || result.error) {
      setError("동의를 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
      setBusy(false);
      return;
    }
    window.location.assign(next);
  }

  async function signOut() {
    setBusy(true);
    await browserSupabase()?.auth.signOut();
    window.location.assign("/");
  }

  return (
    <main className="hub-page auth-page">
      <div className="hub-body">
        <div className="auth-head">
          <BrandMark size={44} />
          <h1>시작하기 전에 확인해 주세요</h1>
          <p>요런 계정을 쓰려면 {FEATURES.signupAgeAndTerms ? "나이 확인과 " : ""}개인정보 동의가 필요해요.</p>
        </div>
        <section className="hub-card">
          <ConsentFields age={age} onAge={(value) => { setAge(value); setError(null); }} agreed={agreed} onAgreed={setAgreed} />
          {error && <p className="auth-error" role="alert">{error}</p>}
          {age !== "under14" && <button type="button" className="btn btn-primary wide" disabled={busy} aria-busy={busy} onClick={() => void agree()}>동의하고 계속하기</button>}
          <button type="button" className="btn btn-secondary wide" disabled={busy} onClick={() => void signOut()}>로그아웃</button>
          <Link href="/settings" className="btn btn-link wide">계정 삭제</Link>
        </section>
      </div>
    </main>
  );
}
