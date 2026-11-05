import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { playerName, playerNames } from "@/lib/server/battle";

const database = (users: Record<string, unknown>) => {
  const getUserById = vi.fn(async (id: string) => users[id] ? { data: { user: users[id] }, error: null } : { data: { user: null }, error: { message: "nope" } });
  return { db: { auth: { admin: { getUserById } } } as never, getUserById };
};

describe("playerNames", () => {
  it("게스트 이름만 보여 주고, Google 계정 이름과 부적절한 이름은 익명 표시로 바꾼다", async () => {
    const { db } = database({
      guest: { is_anonymous: true, user_metadata: { guest_name: "토끼" } },
      google: { is_anonymous: false, user_metadata: { full_name: "실명", guest_name: "위장" } },
      rude: { is_anonymous: true, user_metadata: { guest_name: "씨발" } },
    });
    const nameOf = await playerNames(db, ["guest", "google", "rude", null]);
    expect(nameOf("guest")).toBe("토끼");
    expect(nameOf("google")).toBe(playerName("google"));
    expect(nameOf("rude")).toBe(playerName("rude"));
    expect(nameOf(null)).toBe("탈퇴한 러너");
  });

  it("조회에 실패해도 화면을 막지 않고, 성공한 이름은 다시 조회하지 않는다", async () => {
    const { db, getUserById } = database({ cached: { is_anonymous: true, user_metadata: { guest_name: "거북" } } });
    expect((await playerNames(db, ["missing"]))("missing")).toBe(playerName("missing"));
    await playerNames(db, ["cached"]);
    await playerNames(db, ["cached"]);
    expect(getUserById.mock.calls.filter(([id]) => id === "cached")).toHaveLength(1);
  });
});
