import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";

const folder = process.argv[2] ?? "eval/recognition/parts-pilot-20261021-v2";
const read = name => JSON.parse(readFileSync(`${folder}/${name}`, "utf8").replace(/^\uFEFF/, ""));
const data = read("results.json"), review = read("visual-review.json");
const records = data.areas.flatMap(area => area.records);
assert.equal(new Set(records.map(r => r.id)).size, records.length);
assert.equal(new Set(review.evaluations.map(r => r.id)).size, records.length);
assert.equal(review.evaluations.length, records.length);
for (const r of records) {
  assert.equal(createHash("sha256").update(readFileSync(`${folder}/${r.id}.png`)).digest("hex"), r.pngHash);
  assert(review.evaluations.some(j => j.id === r.id));
}
const summarize = (rs, strategy) => {
  const rows = rs.filter(r => r[strategy]).map(r => review.evaluations.find(j => j.id === r.id));
  return { count: rows.length, recognizable: rows.filter(r => r.decision === "recognizable").length, unclear: rows.filter(r => r.decision === "unclear").length, none: rows.filter(r => r.decision === "none").length, meanSubjectiveScore: rows.reduce((s, r) => s + r.score, 0) / rows.length, ids: rows.map(r => r.id) };
};
const summary = {
  totalValidDistinctPool: data.areas.reduce((s, a) => s + a.validDistinctPool, 0),
  distinctSelectedInspected: records.length,
  baseline: summarize(records, "baseline"), parts: summarize(records, "parts"),
  areas: data.areas.map(area => ({ area: area.area, pool: area.validDistinctPool, baseline: summarize(area.records, "baseline"), parts: summarize(area.records, "parts") })),
  human: false, independent: false, imagesHashVerified: true, fullPoolRecognizabilityEvaluated: false,
};
writeFileSync(`${folder}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
