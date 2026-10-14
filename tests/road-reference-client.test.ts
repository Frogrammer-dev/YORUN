import { describe, expect, it, vi } from "vitest";
import { nameRoadDiscoveries, selectRoadReferenceInputs, validateRoadReferenceResponse } from "@/lib/art/roadReferenceClient";
import { ROAD_REFERENCE_COORDINATE_SPACE, parseRoadReferenceProposal } from "@/lib/art/roadReference";
import { courseBadge, courseTitle } from "@/lib/route/present";
import { makeCandidate } from "./helpers/candidate";

const bounds = { minMeters: 3000, maxMeters: 8000 };
const model = "test-model";
const rawLoop = (i = 0) => makeCandidate({ shapeId: "doodle", shapeName: "동네 고리", outline: [], outlines: [], similarity: 0 }, [37.5 + i * .05, 127]);
function rawProposal(candidateId: string) {
  return { candidateId, decision: "interpretation" as const, label: { ko: "말풍선", en: "Speech bubble" }, reference: {
    coordinateSpace: ROAD_REFERENCE_COORDINATE_SPACE,
    commands: [{ op: "M" as const, to: [.2, .2] }, { op: "L" as const, to: [.8, .2] }, { op: "L" as const, to: [.8, .8] }, { op: "Z" as const }],
    observedParts: [{ name: "넓은 몸통", routeSpan: [.1, .8] }], imaginedParts: [],
  }, missingFeatures: ["둥근 테두리"], explanation: "넓은 부분을 말풍선으로 볼 수 있어요." };
}
function parsed(input: ReturnType<typeof selectRoadReferenceInputs>[number], none = false) {
  return parseRoadReferenceProposal(input.packet, none ? { candidateId: input.packet.candidateId, decision: "none", explanation: "명확한 대상이 떠오르지 않아요." } : rawProposal(input.packet.candidateId), {
    mode: "server-provider", provider: "openai", model, promptVersion: "test-v1", generatedAt: "2026-10-14T00:00:00Z", sourceFingerprint: input.packet.fingerprint,
  });
}
function provider(pool: ReturnType<typeof rawLoop>[], none = false) {
  const inputs = selectRoadReferenceInputs(pool, bounds);
  return vi.fn<typeof fetch>(async (_url, options) => options?.method === "POST"
    ? Response.json({ proposals: inputs.map(input => parsed(input, none)), model })
    : Response.json({ configured: true, provider: "openai", model, maxCandidates: 3 }));
}

describe("road-first reference client", () => {
  it("sends only anonymous normalized points, preserving all native vertices and all completed routes", async () => {
    const road = rawLoop(), templ = makeCandidate(), original = structuredClone(road);
    const fetcher = provider([road]), recognize = vi.fn(async () => []);
    const result = await nameRoadDiscoveries([templ], [templ, road], recognize, { ...bounds, fetcher });
    const body = JSON.parse(String(fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!.body));
    expect(Object.keys(body)).toEqual(["candidates"]);
    expect(Object.keys(body.candidates[0])).toEqual(["packet", "renderLine"]);
    expect(body.candidates[0].packet.candidateId).toBe("road-01");
    expect(body.candidates[0].renderLine).toHaveLength(road.latlngs.length);
    expect(JSON.stringify(body)).not.toMatch(/latlng|latitude|longitude|동네|127|37\.5|shapeName|similarity/);
    expect(body.candidates[0].renderLine.flat().every((coordinate: number) => coordinate >= 0 && coordinate <= 1)).toBe(true);
    expect(recognize).not.toHaveBeenCalled();
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[1]).toBe(templ);
    const named = result.candidates[0];
    expect(named.id).toBe(road.id);
    expect(named.latlngs).toBe(road.latlngs);
    expect(named.lengthMeters).toBe(road.lengthMeters);
    expect(named.similarity).toBe(0);
    expect(named.outline).toBe(road.outline);
    expect(named.semanticExplanation?.validation.semantic).toBe("unverified");
    expect(courseTitle(named, true)).toBe("말풍선처럼 보이는 코스");
    expect(courseBadge(named)).toBe("AI 해석 · 참고 그림");
    expect(road).toEqual(original);
  });

  it("keeps none as abstention without invoking CLIP or removing finished routes", async () => {
    const road = rawLoop(), templ = makeCandidate(), recognize = vi.fn(async () => []);
    const result = await nameRoadDiscoveries([templ], [road], recognize, { ...bounds, fetcher: provider([road], true) });
    expect(result).toMatchObject({ candidates: [templ], interpretationMode: "server", abstained: 1, referenceError: false, doodleError: false });
    expect(recognize).not.toHaveBeenCalled();
  });

  it("skips the external provider entirely when the admin toggle is off", async () => {
    const road = rawLoop(), templ = makeCandidate(), fetcher = provider([road]);
    const recognize = vi.fn(async () => [{ name: "phone", label: "전화기", model: "clip" as const, accepted: true, prob: .35 }]);
    const result = await nameRoadDiscoveries([templ], [road], recognize, { ...bounds, fetcher, server: false });
    expect(fetcher).not.toHaveBeenCalled();
    expect(recognize).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ interpretationMode: "clip", referenceError: false });
  });

  it("falls back to existing local recognition when the external provider is unconfigured or fails", async () => {
    const road = rawLoop(), templ = makeCandidate();
    for (const configured of [false, true]) {
      const fetcher = vi.fn<typeof fetch>(async (_url, options) => options?.method === "POST" ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ configured, provider: "openai" }));
      const recognize = vi.fn(async () => [{ name: "phone", label: "전화기", model: "clip" as const, accepted: true, prob: .35 }]);
      const result = await nameRoadDiscoveries([templ], [road], recognize, { ...bounds, fetcher });
      expect(recognize).toHaveBeenCalledOnce();
      expect(result.interpretationMode).toBe("clip");
      expect(result.referenceError).toBe(configured);
      expect(result.candidates.some(candidate => candidate.id === templ.id)).toBe(true);
      expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(configured ? 1 : 0);
    }
  });

  it("rejects unknown, duplicate, stale and mismatched provider proposals", () => {
    const inputs = selectRoadReferenceInputs([rawLoop()], bounds), good = parsed(inputs[0]);
    expect(validateRoadReferenceResponse(inputs, { model, proposals: [{ ...good, validation: { semantic: "verified", similarity: 100 } }] })[0].validation.semantic).toBe("unverified");
    for (const bad of [
      { ...good, candidateId: "other-road" },
      { ...good, similarity: 100 },
      { ...good, provenance: { ...good.provenance, sourceFingerprint: "old-route" } },
      { ...good, provenance: { ...good.provenance, mode: "manual-agent" } },
      { ...good, provenance: { ...good.provenance, model: "other-model" } },
    ]) expect(() => validateRoadReferenceResponse(inputs, { model, proposals: [bad] })).toThrow();
    expect(() => validateRoadReferenceResponse(inputs, { model, proposals: [good, good] })).toThrow();
  });

  it("chooses at most three diverse natural loops without using prior names or geometric scores", () => {
    const a = rawLoop(), b = rawLoop(1), c = rawLoop(2), d = rawLoop(3);
    b.latlngs[2][1] += .006;
    c.latlngs[1][0] += .007;
    d.latlngs.splice(2, 0, [d.latlngs[2][0] + .006, d.latlngs[2][1] - .004]);
    const pool = [a, b, c, d];
    const selected = selectRoadReferenceInputs(pool, bounds, 20);
    expect(selected).toHaveLength(3);
    expect(new Set(selected.map(input => input.packet.fingerprint)).size).toBe(3);
    expect(selected.map(input => input.packet.candidateId)).toEqual(["road-01", "road-02", "road-03"]);
    const relabeled = pool.map((candidate, i) => ({ ...candidate, shapeName: `old-name-${i}`, similarity: 100 - i }));
    expect(selectRoadReferenceInputs(relabeled, bounds).map(input => input.candidate.id)).toEqual(selected.map(input => input.candidate.id));
    const open = rawLoop(); open.latlngs = open.latlngs.slice(0, -1);
    expect(selectRoadReferenceInputs([makeCandidate(), open, rawLoopWithBranch(), rawLoopOutOfRange()], bounds)).toEqual([]);
    function rawLoopWithBranch() { return { ...rawLoop(), branchMeters: 200 }; }
    function rawLoopOutOfRange() { return { ...rawLoop(), lengthMeters: 9000 }; }
  });

  it("retains full normalized line when numeric packet is capped at 256 points", () => {
    const road = rawLoop();
    road.latlngs = Array.from({ length: 400 }, (_, i) => [37.5 + .006 * Math.cos(i * 2 * Math.PI / 400), 127 + .008 * Math.sin(i * 2 * Math.PI / 400)]);
    road.latlngs.push([...road.latlngs[0]]);
    const input = selectRoadReferenceInputs([road], bounds)[0];
    expect(input.renderLine).toHaveLength(401);
    expect(input.packet.route).toHaveLength(256);
    expect(road.latlngs).toHaveLength(401);
    expect(selectRoadReferenceInputs([{ ...road, latlngs: Array(10_001).fill(road.latlngs[0]) }], bounds)).toEqual([]);
  });

  it("rejects a response arriving after its request timeout without retrying the external generation", async () => {
    const road = rawLoop(), inputs = selectRoadReferenceInputs([road], bounds);
    const recognize = vi.fn(async () => []);
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      if (options?.method !== "POST") return Response.json({ configured: true, provider: "openai" });
      // Deliberately ignores AbortSignal to simulate a response already in flight at the deadline.
      await new Promise(resolve => setTimeout(resolve, 15));
      return Response.json({ model, proposals: [parsed(inputs[0])] });
    });
    const result = await nameRoadDiscoveries([], [road], recognize, { ...bounds, fetcher, timeoutMs: 5 });
    expect(result.interpretationMode).toBe("clip");
    expect(result.referenceError).toBe(true);
    expect(result.candidates).toEqual([]);
    expect(recognize).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("cancels stale external requests and never starts fallback recognition after cancellation", async () => {
    const controller = new AbortController(), recognize = vi.fn(async () => []);
    const fetcher = vi.fn<typeof fetch>(async (_url, options) => {
      controller.abort();
      expect(options?.signal?.aborted).toBe(true);
      return Response.json({ configured: true, provider: "openai" });
    });
    await expect(nameRoadDiscoveries([], [rawLoop()], recognize, { ...bounds, fetcher, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(recognize).not.toHaveBeenCalled();
  });
});
