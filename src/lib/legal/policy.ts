// 개인정보 처리방침의 사실 값. null은 운영자가 정해야 하는 값이며, 화면에 "입력 필요"로 표시된다.
// 지어내지 않는다. 모두 채운 뒤 법률 검토를 거쳐 배포한다.

/** 내용이 바뀌면 올린다. 올리면 기존 사용자도 다시 동의한다. */
export const POLICY_VERSION = "2026-11-05-draft";

export const OPERATOR = {
  /** 개인정보처리자: 상호 또는 운영자 이름 */
  name: null as string | null,
  /** 개인정보 보호책임자 이름 또는 담당 부서 */
  officer: null as string | null,
  /** 연락처 (전화 또는 이메일) */
  contact: null as string | null,
  /** 시행일 */
  effectiveDate: null as string | null,
};

/** 프로토타입에서는 끈다. 보호자 동의 확인 방법(시행령 제17조의2)을 구현한 뒤에만 켠다. */
export const FEATURES = {
  under14Signup: false,
  /** 프로토타입에서는 가입 때 나이 선택과 수집 항목 설명을 숨긴다. 공개 출시 전에 켠다. */
  signupAgeAndTerms: false,
};

export const isPolicyDraft = () => Object.values(OPERATOR).some((value) => value === null);

/** 제15조 제2항의 고지 내용 (가입 화면과 처리방침이 같은 문구를 쓴다) */
export const CONSENT_SUMMARY = {
  purpose: "회원 확인, 작품방과 대결 기록 저장, 문의 대응",
  items: "이메일, 비밀번호(암호화해 보관), 또는 Google 계정의 이메일과 이름",
  retention: "회원 탈퇴 시까지. 탈퇴하면 바로 삭제해요",
  refusal: "동의하지 않을 수 있어요. 동의하지 않으면 계정을 만들 수 없지만, 로그인 없이 코스 찾기와 달리기, 임시 작품방은 쓸 수 있어요",
};

export type AgeGroup = "14+" | "under14";
export interface ConsentRecord { version: string; ageGroup: AgeGroup | "unconfirmed"; at: string }

/** 나이 선택을 숨기면 입력 검사만 통과시킨다. 기록에는 consentRecord가 "unconfirmed"로 남긴다 */
export const INITIAL_AGE: AgeGroup | null = FEATURES.signupAgeAndTerms ? null : "14+";
export const CONSENT_REQUIRED_MESSAGE = FEATURES.signupAgeAndTerms ? "나이를 고르고 필수 항목에 동의해 주세요." : "필수 항목에 동의해 주세요.";

/** 묻지 않은 나이를 기록하지 않는다. 나이 선택을 다시 켜면 "unconfirmed" 계정은 다시 동의한다 */
export const consentRecord = (ageGroup: AgeGroup): ConsentRecord => ({ version: POLICY_VERSION, ageGroup: FEATURES.signupAgeAndTerms ? ageGroup : "unconfirmed", at: new Date().toISOString() });

/** 만 14세 미만은 법정대리인 동의를 확인하기 전까지 동의 완료로 보지 않는다 */
export function hasValidConsent(metadata: Record<string, unknown> | undefined): boolean {
  const consent = metadata?.consent as Partial<ConsentRecord> | undefined;
  if (consent?.version !== POLICY_VERSION) return false;
  return consent.ageGroup === "14+" || (!FEATURES.signupAgeAndTerms && consent.ageGroup === "unconfirmed");
}
