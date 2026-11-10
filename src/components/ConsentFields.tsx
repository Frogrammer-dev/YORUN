"use client";
// 가입 때와 Google 첫 로그인 때 함께 쓰는 나이 확인과 개인정보 동의.

import Link from "next/link";
import { CONSENT_SUMMARY, FEATURES, isPolicyDraft, type AgeGroup } from "@/lib/legal/policy";

export const UNDER14_NOTICE = "만 14세 미만은 보호자의 동의가 먼저 필요해요. 보호자 확인 방법을 준비하고 있어서 지금은 가입할 수 없어요. 로그인 없이 코스 찾기와 달리기는 할 수 있어요.";

export function ConsentFields({ age, onAge, agreed, onAgreed }: { age: AgeGroup | null; onAge: (age: AgeGroup) => void; agreed: boolean; onAgreed: (agreed: boolean) => void }) {
  // 초안 처리방침은 공개하지 않으므로 링크도 숨긴다 (lib/legal/policy.ts의 OPERATOR를 모두 채우면 다시 보인다)
  const privacyLink = isPolicyDraft() ? null : <p className="hint"><Link href="/privacy" target="_blank">개인정보 처리방침 전문 보기</Link></p>;
  if (!FEATURES.signupAgeAndTerms) {
    return (
      <div className="consent-box">
        <label className="consent">
          <input type="checkbox" checked={agreed} onChange={(e) => onAgreed(e.target.checked)} />
          <span>(필수) 개인정보 수집과 이용에 동의해요.</span>
        </label>
        {privacyLink}
      </div>
    );
  }
  return (
    <div className="consent-box">
      <fieldset className="seg-field">
        <legend>나이</legend>
        <div className="seg" role="radiogroup" aria-label="나이">
          <button type="button" role="radio" aria-checked={age === "14+"} className={`seg-btn ${age === "14+" ? "seg-on" : ""}`} onClick={() => onAge("14+")}>만 14세 이상</button>
          <button type="button" role="radio" aria-checked={age === "under14"} disabled={!FEATURES.under14Signup} className={`seg-btn ${age === "under14" ? "seg-on" : ""}`} onClick={() => onAge("under14")}>만 14세 미만</button>
        </div>
      </fieldset>
      {!FEATURES.under14Signup && <p className="hint">만 14세 미만 가입은 보호자 동의 절차를 준비하고 있어요. 로그인 없이 코스 찾기와 달리기는 할 수 있어요.</p>}
      {age === "under14" ? (
        <p className="auth-error" role="status">{UNDER14_NOTICE}</p>
      ) : (
        <>
          <dl className="consent-terms">
            <div><dt>왜 모으나요</dt><dd>{CONSENT_SUMMARY.purpose}</dd></div>
            <div><dt>무엇을 모으나요</dt><dd>{CONSENT_SUMMARY.items}</dd></div>
            <div><dt>언제까지 보관하나요</dt><dd>{CONSENT_SUMMARY.retention}</dd></div>
            <div><dt>동의하지 않으면요</dt><dd>{CONSENT_SUMMARY.refusal}</dd></div>
          </dl>
          <label className="consent">
            <input type="checkbox" checked={agreed} onChange={(e) => onAgreed(e.target.checked)} />
            <span>(필수) 위 내용을 확인했고 개인정보 수집과 이용에 동의해요.</span>
          </label>
          {privacyLink}
        </>
      )}
    </div>
  );
}
