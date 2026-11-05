import { describe, expect, it } from "vitest";
import { GUEST_TTL_MS, forgetGuestExpiry, trackGuestExpiry } from "@/lib/client/guestExpiry";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};
const at = (ms: number) => new Date(ms).toISOString();

describe("trackGuestExpiry", () => {
  it("게스트는 만든 시각에서 6시간 뒤에 만료된다", () => {
    expect(trackGuestExpiry({ is_anonymous: true, created_at: at(1000) }, memory())).toBe(1000 + GUEST_TTL_MS);
  });
  it("일반 계정과 로그아웃 상태는 새로 기록하지 않는다", () => {
    const store = memory();
    expect(trackGuestExpiry(null, store)).toBeNull();
    expect(trackGuestExpiry({ is_anonymous: false, created_at: at(1000) }, store)).toBeNull();
  });
  it("로그아웃한 뒤에도 앞서 기록한 만료 시각을 돌려준다", () => {
    const store = memory();
    trackGuestExpiry({ is_anonymous: true, created_at: at(1000) }, store);
    expect(trackGuestExpiry(null, store)).toBe(1000 + GUEST_TTL_MS);
    forgetGuestExpiry(store);
    expect(trackGuestExpiry(null, store)).toBeNull();
  });
  it("같은 기기의 다음 게스트 기록이 먼저 지워지지 않게 늦은 시각을 쓴다", () => {
    const store = memory();
    trackGuestExpiry({ is_anonymous: true, created_at: at(5000) }, store);
    expect(trackGuestExpiry({ is_anonymous: true, created_at: at(1000) }, store)).toBe(5000 + GUEST_TTL_MS);
  });
});
