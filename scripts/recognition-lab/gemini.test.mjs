import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyGemini } from "./gemini.mjs";

test("sends only isolated image/prompt, disables storage and records usage", async () => {
  const result = await classifyGemini({ model: "test-model", apiKey: "test-only", png: Buffer.from("image"), fetcher: async (url, req) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/interactions");
    const body = JSON.parse(req.body);
    assert.equal(body.store, false); assert.equal(body.input[1].mime_type, "image/png");
    assert.equal(body.input[1].data, Buffer.from("image").toString("base64"));
    assert.equal(body.input.length, 2);
    return new Response(JSON.stringify({ status: "completed", usage: { total_input_tokens: 100 }, steps: [{ type: "model_output", content: [{ type: "text", text: JSON.stringify({ label: "", rejected: true, visibleFeatures: "polygon", missingFeatures: "", rejectReason: "ambiguous" }) }] }] }));
  } });
  assert.equal(result.result.rejected, true); assert.equal(result.usage.total_input_tokens, 100);
});
test("invalid responses and HTTP failures are errors, not negative examples", async () => {
  const args = { model: "test-model", apiKey: "test-only", png: Buffer.from("image") };
  await assert.rejects(classifyGemini({ ...args, fetcher: async () => new Response("secret body", { status: 429 }) }), /HTTP 429/);
  await assert.rejects(classifyGemini({ ...args, fetcher: async () => new Response(JSON.stringify({ status: "completed", steps: [] })) }), /Invalid structured/);
});
