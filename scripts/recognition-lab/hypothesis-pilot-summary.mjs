import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const folder = "eval/recognition/hypothesis-pilot-20261021";
const read = f => JSON.parse(readFileSync(`${folder}/${f}`, "utf8").replace(/^\uFEFF/, ""));
const results = read("results.json"), judge = read("judge-raw.json");
const records = results.areas.flatMap(a => a.records);
assert.equal(judge.items.length, records.length);
assert.equal(new Set(judge.items.map(j => j.id)).size, records.length);
for (const r of records) {
  assert.equal(createHash("sha256").update(readFileSync(`${folder}/${r.id}.png`)).digest("hex"), r.pngHash);
  assert(judge.items.some(j => j.id === r.id));
}
for (const [file, hash] of Object.entries(results.codeHashes)) assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), hash);
const summarize = (rows, strategy) => {
  const selected = rows.filter(r => r[strategy]).map(r => judge.items.find(j => j.id === r.id));
  return { count: selected.length, recognizableBasic: selected.filter(j => j.status === "recognizable" && !j.objectAnimal).length, recognizableObjectAnimal: selected.filter(j => j.status === "recognizable" && j.objectAnimal).length, weak: selected.filter(j => j.status === "weak").length, none: selected.filter(j => j.status === "none").length, meanSubjectiveScore: selected.reduce((s, j) => s + j.score, 0) / selected.length, ids: selected.map(j => j.id) };
};
const summary = { totalValidPool: results.areas.reduce((s, a) => s + a.validDistinctPool, 0), inspectedUnion: records.length, baseline: summarize(records, "baseline"), hypothesis: summarize(records, "hypothesis"), areas: results.areas.map(a => ({ area: a.area, baseline: summarize(a.records, "baseline"), hypothesis: summarize(a.records, "hypothesis") })), judge: judge.evaluator, imageAndSourceHashesVerified: true, humanRecognitionMeasured: false, originalTwelveMeasured: false, semanticProbability: false, appDefault: "baseline" };
writeFileSync(`${folder}/summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
