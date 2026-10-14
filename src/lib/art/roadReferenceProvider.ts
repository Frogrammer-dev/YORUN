import "server-only";
import sharp from "sharp";
import { z } from "zod";
import {
  parseRoadReferenceProposal,
  ROAD_REFERENCE_COORDINATE_SPACE,
  ROAD_REFERENCE_MAX_ROUTE_POINTS,
  type ParsedRoadReferenceProposal,
  type ReferencePoint,
  type RoadReferenceInput,
  type RoadReferenceProposal,
} from "./roadReference";

export const ROAD_REFERENCE_PROVIDER_MODEL = "gpt-5.4-mini";
export const ROAD_REFERENCE_PROVIDER_MAX_CANDIDATES = 3;
export const ROAD_REFERENCE_PROVIDER_MAX_RENDER_POINTS = 10_000;
export const ROAD_REFERENCE_PROVIDER_PROMPT_VERSION = "road-first-server-v1";
const ENDPOINT = "https://api.openai.com/v1/responses";
const TIMEOUT_MS = 45_000;
const CACHE_TTL_MS = 30 * 60_000;
const CACHE_LIMIT = 64;

const point = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
const inputSchema = z.object({
  candidateId: z.string().min(1).max(200),
  coordinateSpace: z.literal(ROAD_REFERENCE_COORDINATE_SPACE),
  route: z.array(point).min(4).max(ROAD_REFERENCE_MAX_ROUTE_POINTS),
  fingerprint: z.string().max(100),
}).strict();
export const roadReferenceProviderRequestSchema = z.object({
  candidates: z.array(z.object({
    packet: inputSchema,
    renderLine: z.array(point).min(4).max(ROAD_REFERENCE_PROVIDER_MAX_RENDER_POINTS),
  }).strict()).min(1).max(ROAD_REFERENCE_PROVIDER_MAX_CANDIDATES),
}).strict();
export type RoadReferenceProviderCandidate = { packet: RoadReferenceInput; renderLine: ReferencePoint[] };
export interface RoadReferenceProviderUsage { inputTokens: number; outputTokens: number; totalTokens: number }
export interface RoadReferenceProviderResult {
  proposals: ParsedRoadReferenceProposal[];
  model: string;
  /** Tokens charged by new successful calls in this request; cache hits contribute zero. */
  usage: RoadReferenceProviderUsage;
  cached: number;
}

const messages = {
  not_configured: "그림 해석 모델 연결이 아직 준비되지 않았어요.",
  invalid_input: "해석할 경로 선 그림을 확인해 주세요.",
  busy: "그림 해석을 진행 중이에요. 잠시 후 다시 시도해 주세요.",
  timeout: "그림 해석 시간이 길어져 종료했어요. 경로는 그대로 볼 수 있어요.",
  cancelled: "그림 해석 요청이 취소됐어요.",
  provider_unavailable: "그림 해석 서버에 연결하지 못했어요. 경로는 그대로 볼 수 있어요.",
  provider_rate_limit: "그림 해석 서버가 바빠요. 잠시 후 다시 시도해 주세요.",
  provider_configuration: "그림 해석 모델 연결 설정을 확인해 주세요.",
  invalid_output: "그림 해석 결과를 확인하지 못했어요. 경로는 그대로 볼 수 있어요.",
  refused: "이 경로의 그림 해석을 만들지 못했어요.",
  incomplete: "그림 해석 결과가 끝까지 생성되지 않았어요.",
  budget_exceeded: "이번 시간의 그림 해석 한도에 도달했어요. 경로는 그대로 볼 수 있어요.",
} as const;
export class RoadReferenceProviderError extends Error {
  constructor(public readonly code: keyof typeof messages, public readonly status: number) { super(messages[code]); }
}

export interface RoadReferenceProviderEnvironment {
  [key: string]: string | undefined;
  OPENAI_API_KEY?: string;
  ROAD_REFERENCE_MODEL?: string;
  ROAD_REFERENCE_MAX_CALLS_PER_HOUR?: string;
}
export function roadReferenceProviderStatus(env: RoadReferenceProviderEnvironment = process.env) {
  const selected = (env.ROAD_REFERENCE_MODEL || ROAD_REFERENCE_PROVIDER_MODEL).trim();
  const validModel = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(selected);
  return {
    configured: !!env.OPENAI_API_KEY?.trim() && validModel,
    provider: "openai" as const,
    model: validModel ? selected : ROAD_REFERENCE_PROVIDER_MODEL,
    maxCandidates: ROAD_REFERENCE_PROVIDER_MAX_CANDIDATES,
  };
}

// JSON Schema uses nested anyOf because Structured Outputs requires an object root.
const schemaPoint = { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 };
const schemaText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength });
const schemaObject = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const commandSchema = {
  anyOf: [
    schemaObject({ op: { type: "string", enum: ["M"] }, to: schemaPoint }),
    schemaObject({ op: { type: "string", enum: ["L"] }, to: schemaPoint }),
    schemaObject({ op: { type: "string", enum: ["Q"] }, control: schemaPoint, to: schemaPoint }),
    schemaObject({ op: { type: "string", enum: ["C"] }, control1: schemaPoint, control2: schemaPoint, to: schemaPoint }),
    schemaObject({ op: { type: "string", enum: ["Z"] } }),
  ],
};
const commandArray = (minItems: number) => ({ type: "array", items: commandSchema, minItems, maxItems: 48 });
export const ROAD_REFERENCE_PROVIDER_OUTPUT_SCHEMA = schemaObject({
  proposal: { anyOf: [
    schemaObject({ candidateId: { type: "string", enum: ["road"] }, decision: { type: "string", enum: ["none"] }, explanation: schemaText(600) }),
    schemaObject({
      candidateId: { type: "string", enum: ["road"] },
      decision: { type: "string", enum: ["interpretation"] },
      label: schemaObject({ ko: schemaText(80), en: schemaText(80) }),
      reference: schemaObject({
        coordinateSpace: { type: "string", enum: [ROAD_REFERENCE_COORDINATE_SPACE] },
        commands: commandArray(3),
        observedParts: { type: "array", minItems: 1, maxItems: 8, items: schemaObject({ name: schemaText(100), routeSpan: schemaPoint }) },
        imaginedParts: { type: "array", maxItems: 8, items: schemaObject({ name: schemaText(100), commands: commandArray(2) }) },
      }),
      missingFeatures: { type: "array", maxItems: 8, items: schemaText(160) },
      explanation: schemaText(600),
    }),
  ] },
});

const INSTRUCTIONS = `Interpret only the supplied closed road outline. Its identifier is always road. No location, road names, expected shape, or previous labels are supplied. Suggest a short Korean and English object name and a simple explanatory vector drawing only when the actual outline provides plausible evidence. Otherwise return decision none; abstention is a normal result. Do not force an object onto an irregular polygon.
The provided line is the actual route. Do not alter it, invent road vertices, return geographic coordinates, or claim a confidence, recognition probability, similarity score, or verified result. The reference and any decoration are explanatory drawings, never runnable paths.
Use normalized-route-xy-v1: x right, y down, coordinates 0..1, long side 0.1..0.9. Align the reference with the input while drawing the proposed object's simple contour rather than copying every road kink. Primary commands must be one nondegenerate closed contour, M first and Z last, no other M or intermediate Z, at most 48 typed commands. Each imagined detail starts M, at most 48 commands, may be open or closed. Never emit SVG, HTML, URLs, scripts, or extra fields.
For each observed part, name the feature actually suggested by the road and bind it to the cyclic route's arc-length fraction [start,end] (unequal 0..1; start>end wraps across the end). Give 1..8 observed parts. Eyes, markings, internal lines, or other features absent from the road must be explicitly imaginedParts (0..8) or missingFeatures (0..8), never observed. Explain the interpretation in plain Korean at most 600 characters. Use the exact structured response wrapper {proposal:...}.`;

function sampledLine(points: ReferencePoint[]): ReferencePoint[] {
  if (points.length <= ROAD_REFERENCE_MAX_ROUTE_POINTS) return points;
  const cumulative = [0];
  for (let i = 1; i < points.length; i++) cumulative.push(cumulative[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const total = cumulative.at(-1)!;
  let edge = 1;
  const result: ReferencePoint[] = [];
  for (let i = 0; i < ROAD_REFERENCE_MAX_ROUTE_POINTS - 1; i++) {
    const distance = total * i / (ROAD_REFERENCE_MAX_ROUTE_POINTS - 1);
    while (edge < points.length - 1 && cumulative[edge] < distance) edge++;
    const a = points[edge - 1], b = points[edge], length = cumulative[edge] - cumulative[edge - 1];
    const t = length > 0 ? (distance - cumulative[edge - 1]) / length : 0;
    result.push([Number((a[0] + t * (b[0] - a[0])).toFixed(6)), Number((a[1] + t * (b[1] - a[1])).toFixed(6))]);
  }
  result.push([...points[0]]);
  return result;
}

/** Checks the packet against the full rendering line; no geographic data is accepted. */
export function validateRoadReferenceProviderRequest(raw: unknown): RoadReferenceProviderCandidate[] {
  try {
    const input = roadReferenceProviderRequestSchema.parse(raw);
    const seen = new Set<string>();
    for (const { packet, renderLine } of input.candidates) {
      if (seen.has(packet.candidateId)) throw new Error("Duplicate candidate");
      seen.add(packet.candidateId);
      // Reuse the frozen parser's exact fingerprint, plain ID and closure checks.
      parseRoadReferenceProposal(packet, { candidateId: packet.candidateId, decision: "none", explanation: "입력 검증" }, {
        mode: "server-provider", provider: "openai", model: ROAD_REFERENCE_PROVIDER_MODEL,
        promptVersion: ROAD_REFERENCE_PROVIDER_PROMPT_VERSION, generatedAt: "2026-10-14T00:00:00Z", sourceFingerprint: packet.fingerprint,
      });
      if (JSON.stringify(renderLine[0]) !== JSON.stringify(renderLine.at(-1))) throw new Error("Open rendering line");
      if (renderLine.some(p => p.some(n => n !== Number(n.toFixed(6))))) throw new Error("Unnormalized precision");
      let minX = 1, minY = 1, maxX = 0, maxY = 0;
      for (const [x, y] of renderLine) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      // Six-decimal rounding can put the two extrema's sum one unit plus FP epsilon off centre.
      if (Math.abs(Math.max(maxX - minX, maxY - minY) - .8) > 2e-6 || Math.abs(minX + maxX - 1) > 2e-6 || Math.abs(minY + maxY - 1) > 2e-6) throw new Error("Unnormalized frame");
      const first = renderLine[0];
      let far = first, farDistance = 0;
      for (const p of renderLine) { const d = Math.hypot(p[0] - first[0], p[1] - first[1]); if (d > farDistance) { far = p; farDistance = d; } }
      if (!renderLine.some(p => Math.abs((far[0] - first[0]) * (p[1] - first[1]) - (far[1] - first[1]) * (p[0] - first[0])) > 1e-6)) throw new Error("Degenerate line");
      if (JSON.stringify(sampledLine(renderLine)) !== JSON.stringify(packet.route)) throw new Error("Rendering line does not match packet");
    }
    return input.candidates;
  } catch { throw new RoadReferenceProviderError("invalid_input", 400); }
}

async function renderPng(line: ReferencePoint[]): Promise<string> {
  // All inserted content is validated finite numeric coordinates, never provider SVG.
  const points = line.map(([x, y]) => `${Number((x * 512).toFixed(6))},${Number((y * 512).toFixed(6))}`).join(" ");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="white"/><polyline points="${points}" fill="none" stroke="black" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function readBoundedProviderBody(response: Response, signal: AbortSignal): Promise<string> {
  const limit = 200_000;
  if (Number(response.headers.get("content-length")) > limit) { await response.body?.cancel(); throw new RoadReferenceProviderError("invalid_output", 502); }
  if (!response.body) throw new RoadReferenceProviderError("invalid_output", 502);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let bytes = 0, text = "";
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) throw new RoadReferenceProviderError("cancelled", 408);
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) { await reader.cancel(); throw new RoadReferenceProviderError("invalid_output", 502); }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { signal.removeEventListener("abort", abort); reader.releaseLock(); }
}

const envelopeSchema = z.object({ proposal: z.unknown() }).strict();
const usageSchema = z.object({ input_tokens: z.number().int().nonnegative().max(100_000_000), output_tokens: z.number().int().nonnegative().max(100_000_000), total_tokens: z.number().int().nonnegative().max(200_000_000) }).passthrough();
function readProviderOutput(value: unknown): { raw: RoadReferenceProposal; usage: RoadReferenceProviderUsage } {
  if (!value || typeof value !== "object") throw new RoadReferenceProviderError("invalid_output", 502);
  const body = value as Record<string, unknown>;
  if (body.status === "incomplete") throw new RoadReferenceProviderError("incomplete", 502);
  if (body.status !== "completed" || !Array.isArray(body.output)) throw new RoadReferenceProviderError("invalid_output", 502);
  const texts: string[] = [];
  for (const item of body.output) {
    if (!item || typeof item !== "object" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content?.type === "refusal") throw new RoadReferenceProviderError("refused", 502);
      if (content?.type === "output_text" && typeof content.text === "string") texts.push(content.text);
    }
  }
  if (texts.length !== 1 || texts[0].length > 100_000) throw new RoadReferenceProviderError("invalid_output", 502);
  try {
    const envelope = envelopeSchema.parse(JSON.parse(texts[0]));
    const usage = usageSchema.parse(body.usage);
    if (usage.total_tokens !== usage.input_tokens + usage.output_tokens) throw new Error("Invalid usage");
    return { raw: envelope.proposal as RoadReferenceProposal, usage: { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, totalTokens: usage.total_tokens } };
  } catch { throw new RoadReferenceProviderError("invalid_output", 502); }
}

interface CacheEntry { raw: RoadReferenceProposal; generatedAt: string; expiresAt: number }
export interface RoadReferenceProviderOptions {
  fetch?: typeof fetch;
  env?: () => RoadReferenceProviderEnvironment;
  now?: () => number;
  timeoutMs?: number;
}

/** A process-local bounded cache and one batch at a time; no billed automatic retries. */
export function createRoadReferenceProvider(options: RoadReferenceProviderOptions = {}) {
  const cache = new Map<string, CacheEntry>();
  const callTimes: number[] = [];
  const now = options.now ?? Date.now;
  const env = options.env ?? (() => process.env);
  let busy = false;
  return {
    async generate(rawRequest: unknown, signal?: AbortSignal): Promise<RoadReferenceProviderResult> {
      const candidates = validateRoadReferenceProviderRequest(rawRequest);
      const config = roadReferenceProviderStatus(env());
      if (!config.configured) throw new RoadReferenceProviderError("not_configured", 503);
      if (signal?.aborted) throw new RoadReferenceProviderError("cancelled", 408);
      if (busy) throw new RoadReferenceProviderError("busy", 503);
      busy = true;
      const controller = new AbortController();
      let timedOut = false;
      let rejectStopped: (reason: RoadReferenceProviderError) => void = () => {};
      const stopped = new Promise<never>((_, reject) => { rejectStopped = reject; });
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); rejectStopped(new RoadReferenceProviderError("timeout", 504)); }, options.timeoutMs ?? TIMEOUT_MS);
      const abort = () => { controller.abort(); rejectStopped(new RoadReferenceProviderError("cancelled", 408)); };
      signal?.addEventListener("abort", abort, { once: true });
      const usage: RoadReferenceProviderUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      const proposals: ParsedRoadReferenceProposal[] = [];
      let cached = 0;
      try {
        for (const { packet, renderLine } of candidates) {
          if (controller.signal.aborted) throw new RoadReferenceProviderError(timedOut ? "timeout" : "cancelled", timedOut ? 504 : 408);
          for (const [key, entry] of cache) if (entry.expiresAt <= now()) cache.delete(key);
          // Exact coordinates, full corners, prompt and model all participate; IDs and hashes alone do not.
          const key = JSON.stringify([config.model, ROAD_REFERENCE_PROVIDER_PROMPT_VERSION, packet.coordinateSpace, packet.route, renderLine]);
          let entry = cache.get(key);
          if (entry) cached++;
          else {
            const image = await Promise.race([renderPng(renderLine), stopped]);
            const hourAgo = now() - 60 * 60_000;
            while (callTimes.length && callTimes[0] <= hourAgo) callTimes.shift();
            const requestedLimit = Number(env().ROAD_REFERENCE_MAX_CALLS_PER_HOUR ?? "60");
            const callLimit = Number.isInteger(requestedLimit) && requestedLimit >= 1 && requestedLimit <= 120 ? requestedLimit : 60;
            if (callTimes.length >= callLimit) throw new RoadReferenceProviderError("budget_exceeded", 503);
            // Failed and cancelled attempts also spend the process-local hourly allowance.
            callTimes.push(now());
            const response = await Promise.race([(options.fetch ?? fetch)(ENDPOINT, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${env().OPENAI_API_KEY!.trim()}` },
              signal: controller.signal,
              body: JSON.stringify({
                model: config.model,
                store: false,
                max_output_tokens: 4000,
                instructions: INSTRUCTIONS,
                input: [{ role: "user", content: [
                  { type: "input_text", text: JSON.stringify({ candidateId: "road", coordinateSpace: packet.coordinateSpace, route: packet.route }) },
                  { type: "input_image", image_url: image, detail: "high" },
                ] }],
                text: { format: { type: "json_schema", name: "road_reference", strict: true, schema: ROAD_REFERENCE_PROVIDER_OUTPUT_SCHEMA } },
              }),
            }), stopped]);
            if (!response.ok) throw new RoadReferenceProviderError(response.status === 429 ? "provider_rate_limit" : response.status === 401 || response.status === 403 ? "provider_configuration" : "provider_unavailable", 503);
            const responseText = await Promise.race([readBoundedProviderBody(response, controller.signal), stopped]);
            let output: ReturnType<typeof readProviderOutput>;
            try { output = readProviderOutput(JSON.parse(responseText)); }
            catch (error) { if (error instanceof RoadReferenceProviderError) throw error; throw new RoadReferenceProviderError("invalid_output", 502); }
            const generatedAt = new Date(now()).toISOString();
            // Verify the anonymous ID before restoring the app's private candidate ID.
            try {
              parseRoadReferenceProposal({ ...packet, candidateId: "road" }, output.raw, {
                mode: "server-provider", provider: "openai", model: config.model,
                promptVersion: ROAD_REFERENCE_PROVIDER_PROMPT_VERSION, generatedAt, sourceFingerprint: packet.fingerprint,
              });
            } catch { throw new RoadReferenceProviderError("invalid_output", 502); }
            entry = { raw: output.raw, generatedAt, expiresAt: now() + CACHE_TTL_MS };
            cache.set(key, entry);
            while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
            usage.inputTokens += output.usage.inputTokens;
            usage.outputTokens += output.usage.outputTokens;
            usage.totalTokens += output.usage.totalTokens;
          }
          proposals.push(parseRoadReferenceProposal(packet, { ...entry.raw, candidateId: packet.candidateId }, {
            mode: "server-provider", provider: "openai", model: config.model,
            promptVersion: ROAD_REFERENCE_PROVIDER_PROMPT_VERSION, generatedAt: entry.generatedAt, sourceFingerprint: packet.fingerprint,
          }));
        }
        return { proposals, model: config.model, usage, cached };
      } catch (error) {
        if (error instanceof RoadReferenceProviderError) throw error;
        if (controller.signal.aborted) throw new RoadReferenceProviderError(timedOut ? "timeout" : "cancelled", timedOut ? 504 : 408);
        throw new RoadReferenceProviderError("provider_unavailable", 503);
      } finally { clearTimeout(timeout); signal?.removeEventListener("abort", abort); busy = false; }
    },
  };
}

const provider = createRoadReferenceProvider();
export const generateRoadReferences = provider.generate;
