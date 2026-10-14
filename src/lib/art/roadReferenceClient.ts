import type { RouteCandidate } from "@/lib/route/fit";
import { overlap } from "@/lib/route/discover";
import { nameDiscoveries } from "@/lib/route/present";
import type { Recognized } from "./recognize";
import {
  normalizeRoadReferenceInput,
  normalizeRoadReferenceRenderLine,
  parseRoadReferenceProposal,
  type ParsedRoadReferenceProposal,
  type ReferencePoint,
  type RoadReferenceInput,
} from "./roadReference";

const ENDPOINT = "/api/recognition/reference";
const MAX_CANDIDATES = 3;

export interface PreparedRoadReference {
  candidate: RouteCandidate;
  packet: RoadReferenceInput;
  renderLine: ReferencePoint[];
}

export interface RoadReferenceDiscoveryOptions {
  minMeters: number;
  maxMeters: number;
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  /** false면 서버 AI 해석을 건너뛰고 CLIP으로 바로 해석한다 (관리자 토글) */
  server?: boolean;
}

export interface RoadReferenceDiscoveryResult {
  candidates: RouteCandidate[];
  doodleError: boolean;
  interpretationMode: "server" | "clip";
  referenceError: boolean;
  abstained: number;
}

function shapeDescriptor(line: ReferencePoint[]): number[] {
  const xs = line.map(p => p[0]), ys = line.map(p => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  let perimeter = 0, twiceArea = 0;
  const lengths = [0];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    perimeter += Math.hypot(b[0] - a[0], b[1] - a[1]);
    twiceArea += a[0] * b[1] - b[0] * a[1];
    lengths.push(perimeter);
  }
  // Arc-length samples make node density irrelevant to diversity. No semantic label or fit score is used.
  const samples: number[] = [];
  let edge = 1;
  for (let i = 0; i < 16; i++) {
    const d = perimeter * i / 16;
    while (edge < line.length - 1 && lengths[edge] < d) edge++;
    const a = line[edge - 1], b = line[edge], t = (d - lengths[edge - 1]) / (lengths[edge] - lengths[edge - 1] || 1);
    samples.push(a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]));
  }
  return [w, h, Math.abs(twiceArea) / 2, Math.min(perimeter, 12) / 12, ...samples];
}

/** Only the worker's untargeted, already validated natural road loops enter this experiment. */
export function selectRoadReferenceInputs(
  pool: RouteCandidate[],
  options: Pick<RoadReferenceDiscoveryOptions, "minMeters" | "maxMeters">,
  limit = MAX_CANDIDATES,
): PreparedRoadReference[] {
  const unique = new Map<string, PreparedRoadReference & { descriptor: number[] }>();
  for (const candidate of pool) {
    if (candidate.shapeId !== "doodle" || candidate.outline.length || candidate.outlines.length
      || candidate.latlngs.length > 10_000
      || candidate.moves.length || candidate.moveMeters || candidate.branchMeters || candidate.doodle || candidate.semanticExplanation
      || !Number.isFinite(candidate.repeatRatio) || candidate.repeatRatio < 0 || candidate.repeatRatio > 0.2 || !Number.isFinite(candidate.lengthMeters)
      || candidate.lengthMeters < options.minMeters || candidate.lengthMeters > options.maxMeters) continue;
    try {
      // Temporary opaque IDs exclude prior labels and local node IDs from the network packet.
      const source = { id: "road-input", latlngs: candidate.latlngs };
      const packet = normalizeRoadReferenceInput(source), renderLine = normalizeRoadReferenceRenderLine(source);
      const key = JSON.stringify(renderLine);
      if (!unique.has(key)) unique.set(key, { candidate, packet, renderLine, descriptor: shapeDescriptor(renderLine) });
    } catch { /* An invalid/open line is never repaired or sent. */ }
  }
  const remaining = [...unique.values()].sort((a, b) => a.packet.fingerprint.localeCompare(b.packet.fingerprint));
  const chosen: typeof remaining = [];
  while (remaining.length && chosen.length < Math.max(0, Math.min(MAX_CANDIDATES, limit))) {
    let index = 0, best = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const entry = remaining[i];
      if (chosen.some(other => overlap(entry.candidate, other.candidate))) continue;
      const distance = chosen.length ? Math.min(...chosen.map(other => entry.descriptor.reduce((sum, value, k) => sum + (value - other.descriptor[k]) ** 2, 0))) : 0;
      if (distance > best) { best = distance; index = i; }
    }
    if (best === -Infinity) break;
    chosen.push(remaining.splice(index, 1)[0]);
  }
  return chosen.map(({ candidate, packet, renderLine }, i) => ({ candidate, packet: { ...packet, candidateId: `road-${String(i + 1).padStart(2, "0")}` }, renderLine }));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Recheck the server result against exactly what this client sent, ignoring claimed validation flags. */
export function validateRoadReferenceResponse(inputs: PreparedRoadReference[], response: unknown): ParsedRoadReferenceProposal[] {
  if (!record(response) || typeof response.model !== "string" || !response.model.trim() || !Array.isArray(response.proposals)
    || response.proposals.length !== inputs.length) throw new Error("Invalid reference response");
  const packets = new Map(inputs.map(input => [input.packet.candidateId, input.packet]));
  const seen = new Set<string>();
  return response.proposals.map(value => {
    if (!record(value) || typeof value.candidateId !== "string" || seen.has(value.candidateId)) throw new Error("Duplicate or invalid reference candidate");
    const packet = packets.get(value.candidateId);
    if (!packet || !record(value.provenance) || value.provenance.mode !== "server-provider"
      || value.provenance.provider !== "openai" || value.provenance.model !== response.model) throw new Error("Reference source mismatch");
    seen.add(value.candidateId);
    const raw = { ...value };
    delete raw.provenance;
    delete raw.validation;
    return parseRoadReferenceProposal(packet, raw, value.provenance);
  });
}

function abortError(): Error { const error = new Error("Reference request cancelled"); error.name = "AbortError"; return error; }
function checkAbort(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }

/** Server generation abstains normally; unavailable generation falls back to the existing local CLIP path. */
export async function nameRoadDiscoveries(
  templ: RouteCandidate[],
  pool: RouteCandidate[],
  recognize: (cs: RouteCandidate[]) => Promise<Array<Recognized | null>>,
  options: RoadReferenceDiscoveryOptions,
): Promise<RoadReferenceDiscoveryResult> {
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 65_000);
  let configured = false;
  try {
    checkAbort(options.signal);
    // 관리자가 끈 경우: 서버 AI를 부르지 않고 아래 CLIP 해석으로 넘어간다 (referenceError는 false 그대로)
    if (options.server === false) throw new Error("Reference generation disabled");
    const statusResponse = await fetcher(ENDPOINT, { signal: controller.signal, cache: "no-store" });
    if (!statusResponse.ok) throw new Error("Reference configuration unavailable");
    const status: unknown = await statusResponse.json();
    checkAbort(options.signal);
    checkAbort(controller.signal);
    if (!record(status) || typeof status.configured !== "boolean" || status.provider !== "openai") throw new Error("Invalid reference configuration");
    configured = status.configured;
    if (configured) {
      const inputs = selectRoadReferenceInputs(pool, options);
      if (!inputs.length) return { candidates: templ, doodleError: false, interpretationMode: "server", referenceError: false, abstained: 0 };
      const response = await fetcher(ENDPOINT, {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ candidates: inputs.map(({ packet, renderLine }) => ({ packet, renderLine })) }),
      });
      if (!response.ok) throw new Error("Reference generation unavailable");
      const proposals = validateRoadReferenceResponse(inputs, await response.json());
      checkAbort(options.signal);
      checkAbort(controller.signal);
      const byId = new Map(inputs.map(input => [input.packet.candidateId, input.candidate]));
      const named = proposals.flatMap(proposal => {
        if (proposal.decision === "none") return [];
        const candidate = byId.get(proposal.candidateId)!;
        const native = { ...candidate };
        delete native.doodle;
        return [{ ...native, shapeName: proposal.label.ko, semanticExplanation: proposal }];
      });
      const namedIds = new Set(named.map(candidate => candidate.id));
      // Completed routes stay available; reference generation never replaces the native route or geometric score.
      return { candidates: [...named, ...templ.filter(candidate => !namedIds.has(candidate.id))], doodleError: false, interpretationMode: "server", referenceError: false, abstained: proposals.filter(p => p.decision === "none").length };
    }
  } catch {
    checkAbort(options.signal);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
  checkAbort(options.signal);
  const fallback = await nameDiscoveries(templ, pool, recognize, 90_000);
  checkAbort(options.signal);
  // Keep every completed native route even when legacy CLIP's spatial deduplication would remove one.
  const ids = new Set(fallback.candidates.map(candidate => candidate.id));
  return { ...fallback, candidates: [...fallback.candidates, ...templ.filter(candidate => !ids.has(candidate.id))], interpretationMode: "clip", referenceError: configured, abstained: 0 };
}
