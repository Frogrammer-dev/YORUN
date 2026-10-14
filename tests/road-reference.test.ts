import { describe, expect, test } from "vitest";
import {
  commandsToSvgPath,
  normalizeRoadReferenceInput,
  normalizeRoadReferenceRenderLine,
  parseRoadReferenceProposal,
  ROAD_REFERENCE_COORDINATE_SPACE,
  type RoadReferenceCandidate,
  type RoadReferenceCommand,
  type RoadReferenceInput,
} from "@/lib/art/roadReference";

function rectangle(id = "candidate-1", latitude = 37, longitude = 127, scale = 1): RoadReferenceCandidate {
  const width = .01 * scale / Math.cos(latitude * Math.PI / 180), height = .006 * scale;
  return { id, latlngs: [[latitude, longitude], [latitude, longitude + width], [latitude + height, longitude + width], [latitude + height, longitude], [latitude, longitude]] };
}

const provenance = (packet: RoadReferenceInput) => ({
  mode: "manual-agent",
  provider: "expert-prototype",
  model: "recorded-agent",
  promptVersion: "road-first-v1",
  generatedAt: "2026-10-14T00:00:00Z",
  sourceFingerprint: packet.fingerprint,
});
const triangle: RoadReferenceCommand[] = [
  { op: "M", to: [.2, .8] }, { op: "L", to: [.5, .2] }, { op: "L", to: [.8, .8] }, { op: "Z" },
];
const proposal = (packet: RoadReferenceInput) => ({
  candidateId: packet.candidateId,
  decision: "interpretation",
  label: { ko: "산", en: "mountain" },
  reference: {
    coordinateSpace: ROAD_REFERENCE_COORDINATE_SPACE,
    commands: triangle.map(command => ({ ...command })),
    observedParts: [{ name: "봉우리", routeSpan: [.1, .6] }],
    imaginedParts: [{ name: "눈 덮인 부분", commands: [{ op: "M", to: [.4, .4] }, { op: "L", to: [.6, .4] }] }],
  },
  missingFeatures: ["눈은 실제 경로에 없습니다"],
  explanation: "위로 솟은 부분을 산봉우리로 해석했습니다.",
});

describe("road-first normalized input", () => {
  test("retains real corners and orientation without GPS; equivalent local geometry has identical content ID", () => {
    const packet = normalizeRoadReferenceInput(rectangle());
    expect(packet.route).toEqual([[.1, .74], [.9, .74], [.9, .26], [.1, .26], [.1, .74]]);
    expect(Object.keys(packet)).toEqual(["candidateId", "coordinateSpace", "route", "fingerprint"]);
    const relocated = normalizeRoadReferenceInput(rectangle("elsewhere", 60, 15, 2));
    expect(relocated.route).toEqual(packet.route);
    expect(relocated.fingerprint).toBe(packet.fingerprint);
    const source = rectangle();
    expect(normalizeRoadReferenceRenderLine(source)).toEqual(packet.route);
    expect(source.latlngs[0]).toEqual([37, 127]);
  });

  test("bounds the numeric packet while full rendering preserves every original corner", () => {
    const latlngs: [number, number][] = [];
    for (let i = 0; i < 400; i++) {
      const angle = 2 * Math.PI * i / 400;
      latlngs.push([37 + Math.sin(angle) * .005, 127 + Math.cos(angle) * .01]);
    }
    latlngs.push([...latlngs[0]]);
    const candidate = { id: "dense", latlngs };
    const packet = normalizeRoadReferenceInput(candidate);
    const full = normalizeRoadReferenceRenderLine(candidate);
    expect(packet.route).toHaveLength(256);
    expect(full).toHaveLength(401);
    expect(full.at(-1)).toEqual(full[0]);
    expect(packet.route.at(-1)).toEqual(packet.route[0]);
    expect(packet.route.every(p => p.every(n => n >= .1 && n <= .9))).toBe(true);
    const before = JSON.stringify(candidate);
    normalizeRoadReferenceInput(candidate);
    expect(JSON.stringify(candidate)).toBe(before);
  });

  test("rejects open routes, invalid latitude/longitude and zero extent instead of adding bridges", () => {
    const open = rectangle();
    expect(() => normalizeRoadReferenceInput({ ...open, latlngs: open.latlngs.slice(0, -1) })).toThrow(/closed/);
    expect(() => normalizeRoadReferenceInput({ id: "zero", latlngs: [[0, 0], [0, 0], [0, 0], [0, 0]] })).toThrow(/extent/);
    for (const point of [[NaN, 127], [91, 0], [0, Infinity], [0, 181]] as [number, number][]) {
      expect(() => normalizeRoadReferenceInput({ id: "invalid", latlngs: [point, [1, 2], [2, 3], point] })).toThrow(/Invalid/);
    }
  });
});

describe("road-first proposal trust boundary", () => {
  test("accepts abstention and generated evidence while preserving unverified status and input data", () => {
    const packet = normalizeRoadReferenceInput(rectangle());
    const before = JSON.stringify(packet), raw = proposal(packet);
    const parsed = parseRoadReferenceProposal(packet, raw, provenance(packet));
    expect(parsed.decision).toBe("interpretation");
    expect(parsed.validation).toEqual({ structural: true, semantic: "unverified", nativeRouteModified: false, exactRouteTraceCopy: false });
    if (parsed.decision === "interpretation") parsed.reference.commands[0] = { op: "M", to: [0, 0] };
    expect(raw.reference.commands[0]).toEqual(triangle[0]);
    expect(JSON.stringify(packet)).toBe(before);
    expect(parseRoadReferenceProposal(packet, { candidateId: packet.candidateId, decision: "none", explanation: "닮은 대상을 찾지 못했습니다." }, provenance(packet)).validation.exactRouteTraceCopy).toBeNull();
  });

  test("rejects unknown candidates, mismatched source data and generated metadata spoofing", () => {
    const packet = normalizeRoadReferenceInput(rectangle());
    expect(() => parseRoadReferenceProposal(packet, { ...proposal(packet), candidateId: "not-provided" }, provenance(packet))).toThrow(/unknown/);
    expect(() => parseRoadReferenceProposal(packet, { ...proposal(packet), candidateId: `${packet.candidateId} ` }, provenance(packet))).toThrow();
    expect(() => parseRoadReferenceProposal(packet, proposal(packet), { ...provenance(packet), sourceFingerprint: "different" })).toThrow(/provenance/);
    expect(() => parseRoadReferenceProposal({ ...packet, fingerprint: "changed" }, proposal(packet), provenance(packet))).toThrow(/fingerprint/);
    expect(() => parseRoadReferenceProposal(packet, { ...proposal(packet), validation: { semantic: "verified" } }, provenance(packet))).toThrow();
    expect(() => parseRoadReferenceProposal(packet, { ...proposal(packet), similarity: 100 }, provenance(packet))).toThrow();
  });

  test("rejects SVG, URLs, unknown coordinate fields and nonfinite or out-of-range geometry", () => {
    const packet = normalizeRoadReferenceInput(rectangle());
    for (const field of [{ svg: "<svg onload='alert(1)'/>" }, { url: "https://example.com/a.svg" }, { latlngs: rectangle().latlngs }]) {
      const raw = proposal(packet);
      expect(() => parseRoadReferenceProposal(packet, { ...raw, reference: { ...raw.reference, ...field } }, provenance(packet))).toThrow();
    }
    for (const coordinate of [NaN, Infinity, -.01, 1.01]) {
      const raw = proposal(packet);
      expect(() => parseRoadReferenceProposal(packet, { ...raw, reference: { ...raw.reference, commands: [{ op: "M", to: [coordinate, .8] }, ...triangle.slice(1)] } }, provenance(packet))).toThrow();
    }
    const raw = proposal(packet);
    expect(() => parseRoadReferenceProposal(packet, { ...raw, explanation: "<svg>bad</svg>" }, provenance(packet))).toThrow();
    expect(() => parseRoadReferenceProposal(packet, { ...raw, explanation: "https://example.com" }, provenance(packet))).toThrow();
  });

  test("rejects open or collinear primary references, repeated subpaths and oversized output", () => {
    const packet = normalizeRoadReferenceInput(rectangle());
    const raw = proposal(packet);
    for (const commands of [
      triangle.slice(0, -1),
      [{ op: "M", to: [.2, .2] }, { op: "L", to: [.5, .5] }, { op: "L", to: [.8, .8] }, { op: "Z" }],
      [{ op: "M", to: [.2, .2] }, { op: "M", to: [.5, .5] }, { op: "L", to: [.8, .2] }, { op: "Z" }],
      [...triangle.slice(0, -1), ...Array.from({ length: 46 }, () => ({ op: "L", to: [.4, .4] })), { op: "Z" }],
    ]) expect(() => parseRoadReferenceProposal(packet, { ...raw, reference: { ...raw.reference, commands } }, provenance(packet))).toThrow();
    expect(() => parseRoadReferenceProposal(packet, { ...raw, reference: { ...raw.reference, observedParts: [] } }, provenance(packet))).toThrow();
    expect(() => parseRoadReferenceProposal(packet, { ...raw, explanation: "a".repeat(601) }, provenance(packet))).toThrow();
  });

  test("reports an exact polygon copy without inventing a geometry score or semantic proof", () => {
    const packet = normalizeRoadReferenceInput(rectangle());
    const raw = proposal(packet);
    const commands: RoadReferenceCommand[] = packet.route.slice(0, -1).map((to, i) => ({ op: i ? "L" : "M", to: [...to] }));
    commands.push({ op: "Z" });
    const parsed = parseRoadReferenceProposal(packet, { ...raw, reference: { ...raw.reference, commands } }, provenance(packet));
    expect(parsed.validation.exactRouteTraceCopy).toBe(true);
    expect(parsed.validation.semantic).toBe("unverified");
    expect(parsed).not.toHaveProperty("similarity");
  });

  test("serializes only validated typed commands, including curved contours and open decoration", () => {
    expect(commandsToSvgPath(triangle)).toBe("M0.2 0.8 L0.5 0.2 L0.8 0.8 Z");
    const curve: RoadReferenceCommand[] = [
      { op: "M", to: [.2, .5] },
      { op: "C", control1: [.2, .1], control2: [.8, .1], to: [.8, .5] },
      { op: "Q", control: [.5, .9], to: [.2, .5] },
      { op: "Z" },
    ];
    const packet = normalizeRoadReferenceInput(rectangle());
    const raw = proposal(packet);
    expect(parseRoadReferenceProposal(packet, { ...raw, reference: { ...raw.reference, commands: curve } }, provenance(packet)).decision).toBe("interpretation");
    expect(commandsToSvgPath(curve)).toContain("C0.2 0.1 0.8 0.1 0.8 0.5");
    expect(commandsToSvgPath([{ op: "M", to: [.2, .2] }, { op: "L", to: [.8, .8] }])).toBe("M0.2 0.2 L0.8 0.8");
    expect(() => commandsToSvgPath([{ op: "M", to: [.2, .2], svg: "<svg/>" }] as unknown as RoadReferenceCommand[])).toThrow();
  });
});
