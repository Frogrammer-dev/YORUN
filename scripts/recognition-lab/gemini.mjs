import { z } from "zod";

export const PROMPT = `Look at this isolated black line on white. Do not infer a map, route, location or missing details.
What recognizable object or symbol does the visible line resemble? Use a short Korean label only when a viewer could reasonably see it without being told.
If it is merely an irregular polygon, ambiguous outline, or requires imaginary eyes, limbs or internal strokes, reject it. Rejecting is a valid result.
Return label="" when rejected. Give visibleFeatures and missingFeatures using only observable geometric evidence. Do not output a confidence score.`;
export const RESULT_SCHEMA = {
  type: "object", properties: { label: { type: "string" }, rejected: { type: "boolean" },
    visibleFeatures: { type: "string" }, missingFeatures: { type: "string" }, rejectReason: { type: "string" } },
  required: ["label", "rejected", "visibleFeatures", "missingFeatures", "rejectReason"], additionalProperties: false,
};
const resultSchema = z.object({ label: z.string().trim().max(120), rejected: z.boolean(),
  visibleFeatures: z.string().max(1000), missingFeatures: z.string().max(1000), rejectReason: z.string().max(1000) }).strict()
  .refine((r) => r.rejected ? r.label === "" : r.label.length > 0, "Rejected output must have an empty label");

// No SDK dependency or stateful conversation. Does not log headers or raw responses.
export async function classifyGemini({ model, apiKey, png, fetcher = fetch }) {
  if (!/^[A-Za-z0-9._-]+$/.test(model)) throw new Error("Invalid Gemini model ID");
  const start = performance.now();
  const response = await fetcher("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify({ model, store: false, input: [
      { type: "text", text: PROMPT }, { type: "image", mime_type: "image/png", data: png.toString("base64") },
    ], response_format: { type: "text", mime_type: "application/json", schema: RESULT_SCHEMA },
    generation_config: { temperature: 0, max_output_tokens: 2048 } }),
  });
  if (!response.ok) throw new Error(`Gemini HTTP ${response.status}; stopped without automatic retry`);
  const data = await response.json();
  if (data.status !== "completed") throw new Error("Gemini did not complete the request");
  const text = (data.steps ?? []).filter((s) => s.type === "model_output")
    .flatMap((s) => s.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
  let result;
  try { result = resultSchema.parse(JSON.parse(text)); } catch { throw new Error("Invalid structured Gemini response; not treated as a rejection"); }
  return { result, usage: data.usage ?? null, latencyMs: performance.now() - start };
}
