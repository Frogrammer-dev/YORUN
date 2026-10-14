import { afterEach, describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { GET, POST } from "@/app/api/recognition/reference/route";
import { normalizeRoadReferenceInput, normalizeRoadReferenceRenderLine } from "@/lib/art/roadReference";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const url = "http://127.0.0.1:3002/api/recognition/reference";
function body() {
  const source = { id: "route-original", latlngs: [[37, 127], [37, 127.01], [37.006, 127.01], [37.006, 127], [37, 127]] as [number, number][] };
  return { candidates: [{ packet: normalizeRoadReferenceInput(source), renderLine: normalizeRoadReferenceRenderLine(source) }] };
}
function request(value: unknown, headers: Record<string, string> = {}) {
  return new Request(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(value) });
}

describe("road reference API", () => {
  test("exposes configuration without revealing the key and disables caching", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-server-value");
    vi.stubEnv("ROAD_REFERENCE_MODEL", "gpt-5.4-mini");
    const result = await GET();
    expect(await result.json()).toEqual({ configured: true, provider: "openai", model: "gpt-5.4-mini", maxCandidates: 3 });
    expect(result.headers.get("cache-control")).toBe("no-store");
  });

  test("returns a safe setup error without network access when no key exists", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await POST(request(body()));
    expect(result.status).toBe(503);
    expect(await result.json()).toEqual({ error: "not_configured", message: "그림 해석 모델 연결이 아직 준비되지 않았어요." });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects extra fields, GPS, mismatched line, empty or more than three inputs before calling a provider", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret");
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const input = body();
    for (const invalid of [
      { ...input, gps: [37, 127] },
      { candidates: [{ ...input.candidates[0], latlngs: [[37, 127]] }] },
      { candidates: [{ ...input.candidates[0], packet: { ...input.candidates[0].packet, shapeName: "cat" } }] },
      { candidates: [] },
      { candidates: Array.from({ length: 4 }, (_, i) => ({ ...input.candidates[0], packet: { ...input.candidates[0].packet, candidateId: `road${i}` } })) },
      { candidates: [{ ...input.candidates[0], renderLine: [[.1, .1], [.9, .1], [.9, .9], [.1, .1]] }] },
    ]) {
      const result = await POST(request(invalid)); expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({ error: "invalid_input" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("checks JSON content type and browser origin, including a non-default local port", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    const allowed = await POST(request(body(), { Origin: "http://127.0.0.1:3002", "Content-Type": "application/json; charset=utf-8" }));
    expect(allowed.status).toBe(503);
    const blockedHeaders: Record<string, string>[] = [{ Origin: "https://other.example" }, { "Sec-Fetch-Site": "cross-site" }];
    for (const headers of blockedHeaders) {
      const result = await POST(request(body(), headers)); expect(result.status).toBe(403);
    }
    const result = await POST(request(body(), { "Content-Type": "text/plain" })); expect(result.status).toBe(400);
  });

  test("rejects malformed JSON and limits streamed body bytes before parsing", async () => {
    const malformed = await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }));
    expect(malformed.status).toBe(400);
    const oversized = await POST(new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(2_000_001) }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({ error: "too_large" });
    const declared = await POST(request(body(), { "Content-Length": "2000001" })); expect(declared.status).toBe(413);
  });

  test("returns parsed server provenance and usage for a mocked complete response without leaking diagnostics", async () => {
    vi.stubEnv("OPENAI_API_KEY", "secret-server-only"); vi.stubEnv("ROAD_REFERENCE_MODEL", "gpt-5.4-mini");
    const fetcher = vi.fn().mockResolvedValue(Response.json({
      status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ proposal: { candidateId: "road", decision: "none", explanation: "닮은 대상이 없어요." } }) }] }],
      usage: { input_tokens: 90, output_tokens: 10, total_tokens: 100 },
    }));
    vi.stubGlobal("fetch", fetcher);
    const result = await POST(request(body()));
    expect(result.status).toBe(200);
    const value = await result.json();
    expect(value.proposals[0]).toMatchObject({ candidateId: "route-original", decision: "none", provenance: { mode: "server-provider", provider: "openai" }, validation: { semantic: "unverified", nativeRouteModified: false } });
    expect(value.usage).toEqual({ inputTokens: 90, outputTokens: 10, totalTokens: 100 });
    expect(JSON.stringify(value)).not.toContain("secret-server-only");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
