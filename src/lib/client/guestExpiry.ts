// 게스트 기록의 만료 시각을 기기에 적어 둔다. 로그아웃한 뒤에도 공용 기기의 기록을 지울 수 있게 한다.
// 서버 쪽 삭제는 supabase/migrations/0006_guest_expiry.sql이 맡는다.

export const GUEST_TTL_MS = 6 * 60 * 60 * 1000;
const KEY = "yorun.guestExpiresAt";

type GuestUser = { is_anonymous?: boolean; created_at?: string } | null | undefined;
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** 게스트면 만료 시각을 기록하고, 기록된 만료 시각을 돌려준다. 없으면 null. */
export function trackGuestExpiry(user: GuestUser, store: Store): number | null {
  const saved = Number(store.getItem(KEY));
  const previous = Number.isFinite(saved) && saved > 0 ? saved : null;
  const created = user?.is_anonymous && user.created_at ? Date.parse(user.created_at) : NaN;
  if (Number.isNaN(created)) return previous;
  const expires = Math.max(created + GUEST_TTL_MS, previous ?? 0);
  store.setItem(KEY, String(expires));
  return expires;
}

export function forgetGuestExpiry(store: Store) {
  store.removeItem(KEY);
}
