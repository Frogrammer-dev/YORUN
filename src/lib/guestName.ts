// 게스트 이름 검사. 입력 화면과, 다른 참가자에게 이름을 보여 주는 서버가 함께 쓴다.

export const GUEST_NAME_MAX = 12;

const BLOCKED = /씨발|씨팔|시발|개새끼|좆|병신|포르노|야동|깜둥이|짱깨|한남충|한녀충|fuck|shit|porn/iu;

/** 표시해도 되는 이름을 돌려준다. 비었거나 길거나 부적절하면 null. */
export function cleanGuestName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFKC").replace(/[\p{Cc}\p{Cf}]/gu, "").replace(/\s+/g, " ").trim();
  if (!name || [...name].length > GUEST_NAME_MAX) return null;
  return BLOCKED.test(name.replace(/[\s\p{P}\p{S}]/gu, "")) ? null : name;
}
