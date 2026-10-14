import { describe, expect, test, vi } from "vitest";
vi.mock("server-only", () => ({}));
import {
  createRoadReferenceProvider,
  ROAD_REFERENCE_PROVIDER_OUTPUT_SCHEMA,
  roadReferenceProviderStatus,
  validateRoadReferenceProviderRequest,
} from "@/lib/art/roadReferenceProvider";
import { normalizeRoadReferenceInput, normalizeRoadReferenceRenderLine } from "@/lib/art/roadReference";

function candidate(id = "private-cat-37.123-127.456", width = .01) {
  const latlngs: [number, number][] = [[37, 127], [37, 127 + width], [37.006, 127 + width], [37.006, 127], [37, 127]];
  const source = { id, latlngs };
  return { packet: normalizeRoadReferenceInput(source), renderLine: normalizeRoadReferenceRenderLine(source) };
}
const none = { candidateId: "road", decision: "none", explanation: "알아볼 만한 대상이 없어요." };
const interpretation = {
  candidateId: "road", decision: "interpretation", label: { ko: "봉우리", en: "peak" },
  reference: {
    coordinateSpace: "normalized-route-xy-v1",
    commands: [{ op: "M", to: [.2, .8] }, { op: "L", to: [.5, .2] }, { op: "L", to: [.8, .8] }, { op: "Z" }],
    observedParts: [{ name: "솟은 부분", routeSpan: [.1, .7] }],
    imaginedParts: [{ name: "눈", commands: [{ op: "M", to: [.4, .45] }, { op: "L", to: [.6, .45] }] }],
  },
  missingFeatures: ["눈은 실제 경로에 없어요"], explanation: "솟은 부분을 봉우리로 해석했어요.",
};
function response(proposal: unknown = none, extra: Record<string, unknown> = {}) {
  return Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ proposal }) }] }], usage: { input_tokens: 120, output_tokens: 40, total_tokens: 160 }, ...extra });
}
const configured = () => ({ OPENAI_API_KEY: "test-secret-do-not-display", ROAD_REFERENCE_MODEL: "gpt-5.4-mini" });

describe("normalized road provider trust boundary", () => {
  test("validates exact corners, closure, frame, fingerprint and packet/render-line agreement", () => {
    const input = candidate();
    expect(validateRoadReferenceProviderRequest({ candidates: [input] })).toEqual([input]);
    const cases = [
      { candidates: [{ ...input, packet: { ...input.packet, latlngs: [[37, 127]] } }] },
      { candidates: [{ ...input, renderLine: input.renderLine.slice(0, -1) }] },
      { candidates: [{ ...input, packet: { ...input.packet, fingerprint: "wrong" } }] },
      { candidates: [{ ...input, renderLine: input.renderLine.map(([x, y]) => [x, 1 - y]) }] },
      { candidates: [{ ...input, packet: { ...input.packet, candidateId: " leading" } }] },
      { candidates: [{ ...input, renderLine: [[.1, .5], [.3, .5], [.9, .5], [.1, .5]] }] },
      { candidates: [input, input] },
      { candidates: [input], location: "Seoul" },
    ];
    for (const value of cases) expect(() => validateRoadReferenceProviderRequest(value)).toThrow();
  });

  test("checks arc-length resampling for dense lines without replacing full rendering geometry", () => {
    const latlngs: [number, number][] = Array.from({ length: 400 }, (_, i) => [37 + .005 * Math.sin(i * Math.PI / 200), 127 + .01 * Math.cos(i * Math.PI / 200)]);
    latlngs.push([...latlngs[0]]);
    const source = { id: "dense", latlngs };
    const input = { packet: normalizeRoadReferenceInput(source), renderLine: normalizeRoadReferenceRenderLine(source) };
    expect(input.packet.route).toHaveLength(256);
    expect(input.renderLine).toHaveLength(401);
    expect(validateRoadReferenceProviderRequest({ candidates: [input] })).toEqual([input]);
    const modified = structuredClone(input); modified.renderLine[100][0] += .001;
    expect(() => validateRoadReferenceProviderRequest({ candidates: [modified] })).toThrow();
  });

  test("accepts the normalizer's six-decimal frame extrema near a rounding boundary", () => {
    const source = { id: "rounding-boundary", latlngs: [[0, 0], [0, .01], [.002500012499997726, .01], [.002500012499997726, 0], [0, 0]] as [number, number][] };
    const input = { packet: normalizeRoadReferenceInput(source), renderLine: normalizeRoadReferenceRenderLine(source) };
    expect(input.renderLine[0]).toEqual([.1, .600001]);
    expect(validateRoadReferenceProviderRequest({ candidates: [input] })).toEqual([input]);
  });

  test("schema has an object root, strict objects and typed numeric drawing commands", () => {
    expect(ROAD_REFERENCE_PROVIDER_OUTPUT_SCHEMA.type).toBe("object");
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (object.type === "object") {
        expect(object.additionalProperties).toBe(false);
        expect(object.required).toEqual(Object.keys(object.properties as object));
      }
      Object.values(object).forEach(walk);
    };
    walk(ROAD_REFERENCE_PROVIDER_OUTPUT_SCHEMA);
  });
});

describe("external road reference generation", () => {
  test("sends anonymous normalized image+coordinates, preserves native data and treats semantics as unverified", async () => {
    const input = candidate(), before = JSON.stringify(input);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(interpretation));
    const provider = createRoadReferenceProvider({ fetch: fetcher, env: configured, now: () => Date.parse("2026-10-14T03:00:00Z") });
    const result = await provider.generate({ candidates: [input] });
    expect(result.proposals[0].candidateId).toBe(input.packet.candidateId);
    expect(result.proposals[0].validation).toEqual({ structural: true, semantic: "unverified", nativeRouteModified: false, exactRouteTraceCopy: false });
    expect(result.proposals[0].provenance).toMatchObject({ mode: "server-provider", provider: "openai", model: "gpt-5.4-mini", sourceFingerprint: input.packet.fingerprint });
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 40, totalTokens: 160 });
    expect(JSON.stringify(input)).toBe(before);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const request = JSON.parse(options!.body as string);
    expect(request.store).toBe(false);
    expect(request.max_output_tokens).toBe(4000);
    expect(request.text.format).toMatchObject({ type: "json_schema", strict: true });
    const sent = JSON.stringify(request);
    expect(sent).not.toContain(input.packet.candidateId);
    expect(sent).not.toContain(input.packet.fingerprint);
    expect(sent).not.toContain("latlngs");
    expect(sent).not.toContain("127.456");
    expect(request.input[0].content[0].text).toBe(JSON.stringify({ candidateId: "road", coordinateSpace: input.packet.coordinateSpace, route: input.packet.route }));
    const image = request.input[0].content[1];
    expect(image.type).toBe("input_image"); expect(image.detail).toBe("high");
    expect(Buffer.from(image.image_url.split(",")[1], "base64").subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    expect(result.proposals[0]).not.toHaveProperty("similarity");
  });

  test("keeps none as a normal result and reuses exact geometry with a new private ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    let clock = 1000;
    const provider = createRoadReferenceProvider({ fetch: fetcher, env: configured, now: () => clock });
    const first = await provider.generate({ candidates: [candidate("first")] });
    const second = await provider.generate({ candidates: [candidate("second")] });
    expect(first.proposals[0].decision).toBe("none");
    expect(second.proposals[0].candidateId).toBe("second");
    expect(second.proposals[0].provenance.generatedAt).toBe(first.proposals[0].provenance.generatedAt);
    expect(second.cached).toBe(1);
    expect(second.usage.totalTokens).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    clock += 30 * 60_000 + 1;
    await provider.generate({ candidates: [candidate("third")] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("cache includes full rendering corners even when dense packets and fingerprint coincide", async () => {
    const latlngs: [number, number][] = Array.from({ length: 300 }, (_, i) => [37 + .005 * Math.sin(i * Math.PI / 150), 127 + .01 * Math.cos(i * Math.PI / 150)]);
    latlngs.push([...latlngs[0]]);
    const source = { id: "dense", latlngs };
    const input = { packet: normalizeRoadReferenceInput(source), renderLine: normalizeRoadReferenceRenderLine(source) };
    const extraCorner = structuredClone(input);
    const a = extraCorner.renderLine[0], b = extraCorner.renderLine[1];
    // Duplicate an existing vertex: full data differs while arc-length samples remain exact.
    extraCorner.renderLine.splice(1, 0, [...a]);
    expect(b).toBeDefined();
    expect(validateRoadReferenceProviderRequest({ candidates: [extraCorner] })).toBeDefined();
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
    const provider = createRoadReferenceProvider({ fetch: fetcher, env: configured });
    await provider.generate({ candidates: [input] });
    await provider.generate({ candidates: [extraCorner] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("missing key and malformed configuration never call an external model", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const env of [() => ({}), () => ({ OPENAI_API_KEY: "secret", ROAD_REFERENCE_MODEL: "https://attacker.test" })]) {
      const provider = createRoadReferenceProvider({ fetch: fetcher, env });
      await expect(provider.generate({ candidates: [candidate()] })).rejects.toMatchObject({ code: "not_configured", status: 503 });
    }
    expect(roadReferenceProviderStatus({})).toMatchObject({ configured: false, model: "gpt-5.4-mini", maxCandidates: 3 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("rejects wrong IDs, markup, self-scores, malformed/refused/incomplete responses without retry", async () => {
    const cases = [
      response({ ...none, candidateId: "private" }), response({ ...none, similarity: 100 }),
      response({ ...none, explanation: "<svg/>" }), response(none, { status: "incomplete" }),
      response(none, { output: [{ content: [{ type: "refusal", refusal: "refused" }] }] }),
      response(none, { usage: { input_tokens: 120, output_tokens: 40, total_tokens: 999 } }),
      new Response("not json"), new Response("secret upstream diagnostic", { status: 401 }),
      new Response("x".repeat(200_001)),
    ];
    for (const output of cases) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(output);
      const provider = createRoadReferenceProvider({ fetch: fetcher, env: configured });
      await expect(provider.generate({ candidates: [candidate()] })).rejects.toMatchObject({ code: expect.any(String) });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });

  test("aborts on timeout, releases the batch lock, and never retries a billed attempt", async () => {
    let observedSignal: AbortSignal | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation((_url, options) => {
      observedSignal = options?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => { observedSignal!.addEventListener("abort", () => reject(new Error("secret transport error"))); });
    });
    const provider = createRoadReferenceProvider({ fetch: fetcher, env: configured, timeoutMs: 150 });
    await expect(provider.generate({ candidates: [candidate()] })).rejects.toMatchObject({ code: "timeout", status: 504 });
    expect(observedSignal?.aborted).toBe(true); expect(fetcher).toHaveBeenCalledTimes(1);
    fetcher.mockResolvedValue(response());
    await expect(provider.generate({ candidates: [candidate()] })).resolves.toMatchObject({ cached: 0 });
  });

  test("caller cancellation and concurrent batches do not schedule additional calls", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(() => new Promise<Response>(resolve => { resolveFetch = resolve; }));
    const provider = createRoadReferenceProvider({ fetch: fetcher, env: configured });
    const controller = new AbortController();
    const pending = provider.generate({ candidates: [candidate()] }, controller.signal);
    await expect(provider.generate({ candidates: [candidate("other")] })).rejects.toMatchObject({ code: "busy" });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled", status: 408 });
    resolveFetch!(response());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("hourly process allowance counts failed misses, permits cache hits, and expires after one hour", async () => {
    let clock = 1000;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response()).mockResolvedValueOnce(new Response("busy", { status: 429 })).mockResolvedValue(response());
    const provider = createRoadReferenceProvider({ fetch: fetcher, env: () => ({ ...configured(), ROAD_REFERENCE_MAX_CALLS_PER_HOUR: "2" }), now: () => clock });
    await provider.generate({ candidates: [candidate("one")] });
    await expect(provider.generate({ candidates: [candidate("two", .02)] })).rejects.toMatchObject({ code: "provider_rate_limit" });
    await expect(provider.generate({ candidates: [candidate("three", .03)] })).rejects.toMatchObject({ code: "budget_exceeded" });
    await expect(provider.generate({ candidates: [candidate("cached")] })).resolves.toMatchObject({ cached: 1 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    clock += 60 * 60_000 + 1;
    await provider.generate({ candidates: [candidate("later", .03)] });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
});
