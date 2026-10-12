// 지도 장소 검색 API: 카카오 응답 → {name,address,lat,lon}, 키 없음·잘못된 검색어 처리
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server/supabase", () => ({ createUserClient: async () => null }));
const { GET } = await import("@/app/api/places/route");

const call = (q: string) => GET(new Request(`http://localhost/api/places?q=${encodeURIComponent(q)}`));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("장소 검색 API", () => {
  it("키가 없으면 503, 검색어가 비면 400", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "");
    expect((await call("광안리")).status).toBe(503);
    expect((await call("  ")).status).toBe(400);
  });

  it("카카오 결과를 좌표 숫자로 바꾸고, 키는 서버 헤더로만 보낸다", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "test-key");
    const fetchMock = vi.fn(async () =>
      Response.json({ documents: [{ place_name: "광안리해수욕장", road_address_name: "", address_name: "부산 수영구 광안동", x: "129.118", y: "35.153" }] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await call("광안리");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ places: [{ name: "광안리해수욕장", address: "부산 수영구 광안동", lat: 35.153, lon: 129.118 }] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("query=%EA%B4%91%EC%95%88%EB%A6%AC");
    expect(url).not.toContain("test-key");
    expect((init.headers as Record<string, string>).Authorization).toBe("KakaoAK test-key");
  });

  it("카카오 오류는 502", async () => {
    vi.stubEnv("KAKAO_REST_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    expect((await call("서면")).status).toBe(502);
  });
});
