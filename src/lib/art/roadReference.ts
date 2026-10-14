import { z } from "zod";

/** Model/display coordinates only: x points right, y points down, both in [0, 1]. */
export const ROAD_REFERENCE_COORDINATE_SPACE = "normalized-route-xy-v1" as const;
export const ROAD_REFERENCE_MAX_ROUTE_POINTS = 256;
export const ROAD_REFERENCE_MAX_COMMANDS = 48;

export type ReferencePoint = [number, number];
export interface RoadReferenceCandidate {
  id: string;
  latlngs: readonly (readonly [number, number])[];
}
export interface RoadReferenceInput {
  candidateId: string;
  coordinateSpace: typeof ROAD_REFERENCE_COORDINATE_SPACE;
  /** Full nodes when <= 256; otherwise an arc-length approximation, never a native route. */
  route: ReferencePoint[];
  /** Geometry-content cache ID, not a cryptographic signature or a semantic score. */
  fingerprint: string;
}

const pointSchema = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
const text = (max: number) => z.string().trim().min(1).max(max).refine(
  value => !/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f]|(?:https?|data|javascript):/i.test(value),
  "Expected plain display text, not markup, URLs or control characters",
);
const candidateIdSchema = z.string().min(1).max(200).refine(value => value === value.trim() && text(200).safeParse(value).success, "Expected an exact nonempty candidate ID");

export const roadReferenceCommandSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("M"), to: pointSchema }).strict(),
  z.object({ op: z.literal("L"), to: pointSchema }).strict(),
  z.object({ op: z.literal("Q"), control: pointSchema, to: pointSchema }).strict(),
  z.object({ op: z.literal("C"), control1: pointSchema, control2: pointSchema, to: pointSchema }).strict(),
  z.object({ op: z.literal("Z") }).strict(),
]);
export type RoadReferenceCommand = z.infer<typeof roadReferenceCommandSchema>;

function sampleCommands(commands: readonly RoadReferenceCommand[]): ReferencePoint[] {
  const output: ReferencePoint[] = [];
  let current: ReferencePoint = [0, 0], start: ReferencePoint = [0, 0];
  for (const command of commands) {
    if (command.op === "M") {
      current = [...command.to];
      start = [...current];
      output.push([...current]);
    } else if (command.op === "Z") {
      current = [...start];
      output.push([...current]);
    } else if (command.op === "L") {
      current = [...command.to];
      output.push([...current]);
    } else {
      const from = current;
      for (let index = 1; index <= 24; index++) {
        const t = index / 24, u = 1 - t;
        const axis = (a: 0 | 1) => command.op === "Q"
          ? u * u * from[a] + 2 * u * t * command.control[a] + t * t * command.to[a]
          : u ** 3 * from[a] + 3 * u * u * t * command.control1[a] + 3 * u * t * t * command.control2[a] + t ** 3 * command.to[a];
        output.push([axis(0), axis(1)]);
      }
      current = [...command.to];
    }
  }
  return output;
}

function hasTwoDimensions(points: readonly ReferencePoint[]): boolean {
  const first = points[0];
  if (!first) return false;
  let far = first, distance = 0;
  for (const point of points) {
    const d = Math.hypot(point[0] - first[0], point[1] - first[1]);
    if (d > distance) { far = point; distance = d; }
  }
  if (distance <= 1e-6) return false;
  return points.some(point => Math.abs((far[0] - first[0]) * (point[1] - first[1]) - (far[1] - first[1]) * (point[0] - first[0])) > 1e-6);
}

function validPath(commands: readonly RoadReferenceCommand[], closed: boolean): boolean {
  if (commands[0]?.op !== "M" || (closed && commands.at(-1)?.op !== "Z")) return false;
  if (commands.slice(1).some((command, index) => command.op === "M" || (command.op === "Z" && index !== commands.length - 2))) return false;
  const sampled = sampleCommands(commands);
  if (closed) return hasTwoDimensions(sampled);
  const first = sampled[0];
  return !!first && sampled.some(point => Math.hypot(point[0] - first[0], point[1] - first[1]) > 1e-6);
}

const primaryCommands = z.array(roadReferenceCommandSchema).min(3).max(ROAD_REFERENCE_MAX_COMMANDS)
  .refine(commands => validPath(commands, true), "Expected one nondegenerate closed contour: M first, Z last");
const detailCommands = z.array(roadReferenceCommandSchema).min(2).max(ROAD_REFERENCE_MAX_COMMANDS)
  .refine(commands => validPath(commands, false), "Expected one nondegenerate path: M first, optional Z last");

/** Accepted JSON format for a provider or a recorded manual-agent prototype. */
export const roadReferenceProposalSchema = z.discriminatedUnion("decision", [
  z.object({
    candidateId: candidateIdSchema,
    decision: z.literal("none"),
    explanation: text(600),
  }).strict(),
  z.object({
    candidateId: candidateIdSchema,
    decision: z.literal("interpretation"),
    label: z.object({ ko: text(80), en: text(80) }).strict(),
    reference: z.object({
      coordinateSpace: z.literal(ROAD_REFERENCE_COORDINATE_SPACE),
      commands: primaryCommands,
      observedParts: z.array(z.object({
        name: text(100),
        /** Fractions of the cyclic route's arc length; start > end wraps past 1. */
        routeSpan: z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)])
          .refine(span => Math.abs(span[0] - span[1]) > 1e-6, "An observed part needs a nonempty route span"),
      }).strict()).min(1).max(8),
      imaginedParts: z.array(z.object({ name: text(100), commands: detailCommands }).strict()).max(8),
    }).strict(),
    missingFeatures: z.array(text(160)).max(8),
    explanation: text(600),
  }).strict(),
]);
export type RoadReferenceProposal = z.infer<typeof roadReferenceProposalSchema>;

export const roadReferenceProvenanceSchema = z.object({
  mode: z.enum(["manual-agent", "server-provider", "local-provider"]),
  provider: text(100),
  model: text(100),
  promptVersion: text(100),
  generatedAt: z.string().datetime({ offset: true }),
  sourceFingerprint: text(100),
}).strict();
export type RoadReferenceProvenance = z.infer<typeof roadReferenceProvenanceSchema>;
export type ParsedRoadReferenceProposal = RoadReferenceProposal & {
  provenance: RoadReferenceProvenance;
  validation: {
    structural: true;
    semantic: "unverified";
    nativeRouteModified: false;
    /** Exact normalized polygon copy only; false never proves semantic independence. */
    exactRouteTraceCopy: boolean | null;
  };
};

const roundCoordinate = (n: number): number => Number(n.toFixed(6));

function normalizeFullLine(candidate: RoadReferenceCandidate): ReferencePoint[] {
  candidateIdSchema.parse(candidate.id);
  if (!Array.isArray(candidate.latlngs) || candidate.latlngs.length < 4 || candidate.latlngs.length > 100_000) throw new Error("Expected 4 to 100000 closed route nodes");
  for (const point of candidate.latlngs) {
    if (!Array.isArray(point) || point.length !== 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) throw new Error("Invalid latitude/longitude route point");
  }
  const first = candidate.latlngs[0], last = candidate.latlngs.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error("Expected an already closed route; no bridge may be added");
  const k = Math.cos(first[0] * Math.PI / 180);
  if (k < 1e-8) throw new Error("Cannot project a route at the pole");
  const local = candidate.latlngs.map(([lat, lon]) => {
    const longitudeDelta = ((lon - first[1] + 540) % 360) - 180;
    return [longitudeDelta * k, -(lat - first[0])] as ReferencePoint;
  });
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of local) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const span = Math.max(maxX - minX, maxY - minY);
  if (!(span > 1e-12)) throw new Error("Route has no extent");
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return local.map(([x, y]) => [roundCoordinate(0.5 + 0.8 * (x - cx) / span), roundCoordinate(0.5 + 0.8 * (y - cy) / span)]);
}

function arcLengthSamples(points: readonly ReferencePoint[], count: number): ReferencePoint[] {
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cumulative.at(-1)!;
  if (!(total > 0)) throw new Error("Route has no length");
  const output: ReferencePoint[] = [];
  let edge = 1;
  for (let index = 0; index < count - 1; index++) {
    const distance = total * index / (count - 1);
    while (edge < points.length - 1 && cumulative[edge] < distance) edge++;
    const a = points[edge - 1], b = points[edge];
    const length = cumulative[edge] - cumulative[edge - 1];
    const t = length > 0 ? (distance - cumulative[edge - 1]) / length : 0;
    output.push([roundCoordinate(a[0] + t * (b[0] - a[0])), roundCoordinate(a[1] + t * (b[1] - a[1]))]);
  }
  output.push([...points[0]]);
  return output;
}

function inputFingerprint(route: readonly ReferencePoint[]): string {
  // Two deterministic 32-bit content hashes. Cache hits must also compare the packet.
  const value = JSON.stringify([ROAD_REFERENCE_COORDINATE_SPACE, route]);
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 3266489909);
  }
  return `rr1-${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}`;
}

/** No GPS/origin is returned. Use this full line for the PNG so corners are retained. */
export function normalizeRoadReferenceRenderLine(candidate: RoadReferenceCandidate): ReferencePoint[] {
  return normalizeFullLine(candidate);
}

/** Pure normalization for model input. Neither its polyline nor its reference is a runnable path. */
export function normalizeRoadReferenceInput(candidate: RoadReferenceCandidate): RoadReferenceInput {
  const full = normalizeFullLine(candidate);
  const route = full.length <= ROAD_REFERENCE_MAX_ROUTE_POINTS ? full : arcLengthSamples(full, ROAD_REFERENCE_MAX_ROUTE_POINTS);
  return { candidateId: candidate.id, coordinateSpace: ROAD_REFERENCE_COORDINATE_SPACE, route, fingerprint: inputFingerprint(route) };
}

const packetSchema = z.object({
  candidateId: candidateIdSchema,
  coordinateSpace: z.literal(ROAD_REFERENCE_COORDINATE_SPACE),
  route: z.array(pointSchema).min(4).max(ROAD_REFERENCE_MAX_ROUTE_POINTS),
  fingerprint: text(100),
}).strict();

function isSamePolygonTrace(commands: readonly RoadReferenceCommand[], route: readonly ReferencePoint[]): boolean {
  if (commands.some(command => command.op === "Q" || command.op === "C")) return false;
  const points = commands.flatMap(command => command.op === "M" || command.op === "L" ? [[...command.to] as ReferencePoint] : []);
  if (points.length && (points[0][0] !== points.at(-1)![0] || points[0][1] !== points.at(-1)![1])) points.push([...points[0]]);
  return JSON.stringify(points) === JSON.stringify(route);
}

/** Syntax/provenance checks only. A successful parse does not certify recognition. */
export function parseRoadReferenceProposal(packet: RoadReferenceInput, raw: unknown, provenance: unknown): ParsedRoadReferenceProposal {
  const input = packetSchema.parse(packet);
  if (input.route[0][0] !== input.route.at(-1)![0] || input.route[0][1] !== input.route.at(-1)![1] || input.fingerprint !== inputFingerprint(input.route)) throw new Error("Invalid normalized input fingerprint or closure");
  const proposal = roadReferenceProposalSchema.parse(raw);
  if (proposal.candidateId !== input.candidateId) throw new Error("Proposal refers to an unknown candidate");
  const source = roadReferenceProvenanceSchema.parse(provenance);
  if (source.sourceFingerprint !== input.fingerprint) throw new Error("Proposal provenance does not match its input");
  return {
    ...proposal,
    provenance: source,
    validation: {
      structural: true,
      semantic: "unverified",
      nativeRouteModified: false,
      exactRouteTraceCopy: proposal.decision === "interpretation" ? isSamePolygonTrace(proposal.reference.commands, input.route) : null,
    },
  };
}

/** Generates path data from validated typed commands; never accepts an SVG string. */
export function commandsToSvgPath(commands: readonly RoadReferenceCommand[]): string {
  const parsed = detailCommands.parse(commands);
  const xy = (point: ReferencePoint) => `${roundCoordinate(point[0])} ${roundCoordinate(point[1])}`;
  return parsed.map(command => {
    if (command.op === "Z") return "Z";
    if (command.op === "M" || command.op === "L") return `${command.op}${xy(command.to)}`;
    if (command.op === "Q") return `Q${xy(command.control)} ${xy(command.to)}`;
    return `C${xy(command.control1)} ${xy(command.control2)} ${xy(command.to)}`;
  }).join(" ");
}
