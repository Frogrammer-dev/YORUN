// Offline experiment contracts. Coordinates are normalized; no GPS or user records.
import { createHash } from "node:crypto";
import { z } from "zod";

export type Point = [number, number];
const id = z.string().regex(/^[A-Za-z0-9_-]+$/).max(100);
const point = z.tuple([z.number().finite().min(-0.501).max(0.501), z.number().finite().min(-0.501).max(0.501)]);
export const candidateSchema = z.object({
  id, condition: id, split: z.enum(["development", "holdout", "control"]),
  source: z.enum(["loop", "branch", "template", "control"]),
  geometryHash: z.string().regex(/^[a-f0-9]{64}$/), line: z.array(point).min(2).max(20000),
  lengthMeters: z.number().finite().nonnegative(), repeatRatio: z.number().min(0).max(1),
  referenceLabel: z.string().max(80).optional(), controlKind: z.enum(["outline", "ambiguous"]).optional(),
}).strict();
export const datasetSchema = z.object({
  schemaVersion: z.literal(1), id, fingerprint: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string(),
  provenance: z.record(z.string(), z.unknown()),
  conditions: z.array(z.object({ id, split: z.enum(["development", "holdout"]), fixtureHash: z.string(), stepBudget: z.number().int().positive(), partial: z.boolean() }).strict()),
  candidates: z.array(candidateSchema).min(1),
}).strict();
export type Dataset = z.infer<typeof datasetSchema>;
export type Candidate = z.infer<typeof candidateSchema>;

const label = z.string().trim().min(1).max(120);
export const predictionSchema = z.object({
  candidateId: id, label: label.nullable(), accepted: z.boolean(), rawScore: z.number().finite().nullable(),
  rankingScore: z.number().finite(), topK: z.array(z.object({ label, score: z.number().finite(), excluded: z.boolean() }).strict()).max(20),
  latencyMs: z.number().finite().nonnegative(), reason: z.string().max(2000),
}).strict().refine((p) => !p.accepted || p.label !== null, "Accepted predictions need a label");
export const predictionFileSchema = z.object({
  schemaVersion: z.literal(1), datasetId: id, datasetFingerprint: z.string(), method: id,
  model: z.string().min(1), renderer: z.string().min(1), createdAt: z.string(),
  metadata: z.record(z.string(), z.unknown()), predictions: z.array(predictionSchema).min(1),
}).strict();
export type PredictionFile = z.infer<typeof predictionFileSchema>;
export type Prediction = z.infer<typeof predictionSchema>;

export const reviewSchema = z.object({
  schemaVersion: z.literal(1), datasetId: id, datasetFingerprint: z.string(), studyFingerprint: z.string(),
  judgeType: z.literal("human"), who: z.string().trim().min(1).max(100), savedAt: z.string(),
  items: z.array(z.object({
    candidateId: id, guess: z.string().max(300), noShape: z.boolean(),
    ratings: z.array(z.object({ method: id, label, match: z.boolean().nullable(), recognized: z.boolean(), agree: z.number().int().min(1).max(5) }).strict()),
  }).strict()).min(1),
}).strict();
export type Review = z.infer<typeof reviewSchema>;

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function normalizeLine(points: readonly Point[]): Point[] {
  if (points.length < 2 || points.some((p) => p.length !== 2 || !p.every(Number.isFinite))) throw new Error("Invalid polyline");
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!span) throw new Error("Degenerate polyline");
  return points.map(([x, y]) => [Number(((x - cx) / span).toFixed(6)), Number(((y - cy) / span).toFixed(6))]);
}
export function datasetFingerprint(d: Pick<Dataset, "candidates" | "conditions">): string {
  return sha256(canonicalJson({ conditions: d.conditions, candidates: d.candidates }));
}
export function canonicalJson(value: unknown): string {
  const ordered = (v: unknown): unknown => Array.isArray(v) ? v.map(ordered)
    : v !== null && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, ordered(x)])) : v;
  return JSON.stringify(ordered(value));
}
export function validateDataset(input: unknown): Dataset {
  const d = datasetSchema.parse(input);
  unique(d.candidates.map((c) => c.id), "candidate");
  unique(d.conditions.map((c) => c.id), "condition");
  for (const c of d.candidates) {
    if (sha256(JSON.stringify(c.line)) !== c.geometryHash) throw new Error(`Geometry changed: ${c.id}`);
    const condition = d.conditions.find((x) => x.id === c.condition);
    if (c.source !== "control" && (!condition || condition.split !== c.split)) throw new Error(`Invalid condition: ${c.id}`);
  }
  if (datasetFingerprint(d) !== d.fingerprint) throw new Error("Dataset fingerprint mismatch");
  return d;
}
function unique(ids: string[], kind: string) {
  if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${kind} IDs`);
}
export function validatePredictions(input: unknown, dataset: Dataset): PredictionFile {
  const p = predictionFileSchema.parse(input);
  if (p.datasetId !== dataset.id || p.datasetFingerprint !== dataset.fingerprint) throw new Error("Predictions belong to another dataset");
  unique(p.predictions.map((r) => r.candidateId), "prediction");
  const ids = new Set(dataset.candidates.map((c) => c.id));
  for (const r of p.predictions) if (!ids.has(r.candidateId)) throw new Error(`Unknown candidate: ${r.candidateId}`);
  return p;
}
export function studyFingerprint(files: PredictionFile[]): string {
  return sha256(canonicalJson(files.map((p) => ({ method: p.method, predictions: p.predictions, model: p.model, renderer: p.renderer })).sort((a, b) => a.method.localeCompare(b.method))));
}
export function validateReview(input: unknown, dataset: Dataset, files: PredictionFile[]): Review {
  const r = reviewSchema.parse(input);
  if (r.datasetId !== dataset.id || r.datasetFingerprint !== dataset.fingerprint || r.studyFingerprint !== studyFingerprint(files)) throw new Error("Review belongs to another dataset or prediction study");
  unique(r.items.map((x) => x.candidateId), "review");
  for (const item of r.items) {
    if (!dataset.candidates.some((c) => c.id === item.candidateId)) throw new Error("Unknown reviewed candidate");
    if (!item.noShape && !item.guess.trim()) throw new Error("A free guess or noShape is required");
    if (item.noShape && item.guess.trim()) throw new Error("noShape and a named guess conflict");
    unique(item.ratings.map((x) => x.method), "rating method");
    for (const rating of item.ratings) {
      const p = files.find((f) => f.method === rating.method)?.predictions.find((p) => p.candidateId === item.candidateId);
      if (!p || p.label !== rating.label) throw new Error("Reviewed label does not match frozen predictions");
    }
  }
  return r;
}

/** Same framing/thickness as binary28. Subpixel area coverage, not a changed shape. */
export function grayRaster(points: readonly Point[], size = 28, pad = 2, halfWidth = 0.85, samples = 4): Float32Array {
  const line = normalizeLine(points);
  const spanX = Math.max(...line.map((p) => p[0])) - Math.min(...line.map((p) => p[0]));
  const spanY = Math.max(...line.map((p) => p[1])) - Math.min(...line.map((p) => p[1]));
  const k = size - 2 * pad - 1;
  const pts = line.map(([x, y]) => [pad + k / 2 + x * k, pad + k / 2 - y * k] as Point);
  // spanX/spanY deliberately not independently stretched.
  if (!spanX && !spanY) throw new Error("Degenerate polyline");
  if (pts[0][0] !== pts.at(-1)![0] || pts[0][1] !== pts.at(-1)![1]) pts.push(pts[0]);
  const out = new Float32Array(size * size);
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    let covered = 0;
    for (let sy = 0; sy < samples; sy++) for (let sx = 0; sx < samples; sx++) {
      const x = col - 0.5 + (sx + 0.5) / samples, y = row - 0.5 + (sy + 0.5) / samples;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1)));
        if (Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy) <= halfWidth) { covered++; break; }
      }
    }
    out[row * size + col] = covered / (samples * samples);
  }
  return out;
}
export function rotateLine(line: readonly Point[], degrees: number): Point[] {
  const a = degrees * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return line.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}
export function outlineSvg(line: readonly Point[], size = 224): string {
  const p = normalizeLine(line).map(([x, y]) => `${(size / 2 + x * size * 0.85).toFixed(3)},${(size / 2 - y * size * 0.85).toFixed(3)}`).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="white"/><polyline points="${p}" fill="none" stroke="#111" stroke-width="${size * 0.009375}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
export function shuffled<T>(values: readonly T[], seed = 20261010): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    seed = (seed * 16807) % 2147483647;
    const j = Math.floor(seed / 2147483647 * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function majority(values: boolean[], minJudges: number): boolean | null {
  if (values.length < minJudges || values.filter(Boolean).length * 2 === values.length) return null;
  return values.filter(Boolean).length * 2 > values.length;
}
export function summarize(dataset: Dataset, files: PredictionFile[], reviews: Review[], minJudges = 3, topK = 8) {
  unique(reviews.map((r) => r.who), "judge (one export per person)");
  const real = dataset.candidates.filter((c) => c.source !== "control");
  const oracle = new Map(dataset.candidates.map((c) => [c.id, majority(reviews.flatMap((r) => r.items.filter((i) => i.candidateId === c.id).map((i) => !i.noShape)), minJudges)]));
  const methods = files.map((file) => {
    const judged = file.predictions.map((p) => {
      const ratings = reviews.flatMap((r) => r.items.filter((i) => i.candidateId === p.candidateId).flatMap((i) => i.ratings.filter((x) => x.method === file.method)));
      return { ...p, recognized: majority(ratings.map((r) => r.recognized), minJudges), match: majority(ratings.flatMap((r) => r.match === null ? [] : [r.match]), minJudges) };
    });
    const rows = judged.filter((r) => real.some((c) => c.id === r.candidateId));
    const accepted = rows.filter((p) => p.accepted);
    const scored = accepted.filter((p) => p.recognized !== null);
    const hits = scored.filter((p) => p.recognized).length;
    const conditions = dataset.conditions.map((condition) => {
      const pool = real.filter((c) => c.condition === condition.id);
      const top = rows.filter((p) => pool.some((c) => c.id === p.candidateId) && p.accepted).sort((a, b) => b.rankingScore - a.rankingScore || a.candidateId.localeCompare(b.candidateId)).slice(0, topK);
      return { condition: condition.id, split: condition.split, pool: pool.length, oracleJudged: pool.filter((c) => oracle.get(c.id) !== null).length,
        oraclePositive: pool.filter((c) => oracle.get(c.id) === true).length, recommended: top.length,
        topJudged: top.filter((p) => p.recognized !== null).length, topHits: top.filter((p) => p.recognized === true).length,
        oracleInTop: top.filter((p) => oracle.get(p.candidateId) === true).length };
    });
    const complete = conditions.filter((c) => c.pool > 0 && c.oracleJudged === c.pool && c.topJudged === c.recommended);
    const negatives = rows.filter((p) => oracle.get(p.candidateId) === false);
    const splits = ["development", "holdout"].map((split) => {
      const ids = new Set(real.filter((c) => c.split === split).map((c) => c.id));
      const displayed = accepted.filter((p) => ids.has(p.candidateId));
      const judged = displayed.filter((p) => p.recognized !== null);
      return { split, accepted: displayed.length, judgedAccepted: judged.length,
        precision: judged.length ? judged.filter((p) => p.recognized).length / judged.length : null,
        complete: displayed.length > 0 && displayed.length === judged.length };
    });
    return { method: file.method, model: file.model, renderer: file.renderer, predictions: rows.length,
      accepted: accepted.length, judgedAccepted: scored.length, hits,
      precision: scored.length ? hits / scored.length : null,
      lower95: scored.length ? wilson(hits, scored.length) : null,
      complete: scored.length === accepted.length && accepted.length > 0,
      spontaneousMatch: scored.filter((p) => p.match !== null).length ? scored.filter((p) => p.match === true).length / scored.filter((p) => p.match !== null).length : null,
      negativeJudged: negatives.length, falsePositiveAcceptanceRate: negatives.length ? negatives.filter((p) => p.accepted).length / negatives.length : null,
      completedConditions: complete.length, usefulConditions: complete.filter((c) => c.topHits > 0).length,
      oracleRecallAtK: complete.reduce((s, c) => s + c.oraclePositive, 0) ? complete.reduce((s, c) => s + c.oracleInTop, 0) / complete.reduce((s, c) => s + c.oraclePositive, 0) : null,
      conditions, splits, controls: judged.filter((p) => !real.some((c) => c.id === p.candidateId)).map((p) => ({ id: p.candidateId, label: p.label, accepted: p.accepted, recognized: p.recognized })),
    };
  });
  const shared = real.filter((c) => files.length > 1 && files.every((f) => f.predictions.some((p) => p.candidateId === c.id && p.label !== null) && majority(reviews.flatMap((r) => r.items.filter((i) => i.candidateId === c.id).flatMap((i) => i.ratings.filter((x) => x.method === f.method).map((x) => x.recognized))), minJudges) !== null));
  const paired = files.map((f) => ({ method: f.method, n: shared.length, recognized: shared.filter((c) => majority(reviews.flatMap((r) => r.items.filter((i) => i.candidateId === c.id).flatMap((i) => i.ratings.filter((x) => x.method === f.method).map((x) => x.recognized))), minJudges) === true).length }));
  return { datasetId: dataset.id, datasetFingerprint: dataset.fingerprint, judges: reviews.length, minJudges, topK,
    warning: "Partial judging is not full-pool oracle or release validation. Wilson intervals are descriptive; nearby routes are correlated. Controls are not road routes. Development and holdout must be reported separately.", methods, paired };
}
function wilson(k: number, n: number) {
  const z = 1.96, p = k / n;
  return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
}
