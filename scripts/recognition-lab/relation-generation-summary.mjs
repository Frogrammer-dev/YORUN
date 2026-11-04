import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";
const root = "eval/recognition/relation-generation-20261021";
const read = f => JSON.parse(readFileSync(`${root}/${f}`, "utf8").replace(/^\uFEFF/, ""));
const trial = read("trial-v1/results.json"), baselineMean = trial.cases.reduce((s, c) => s + c.baseline.rawSimilarity, 0) / 6;
const rows = [];
for (const run of ["trial-v1", "extended-fixed-v1", "extended-v1", "stress-v1", "hybrid-v1"]) {
  const data = read(`${run}/results.json`), groups = new Map();
  assert.equal(data.cases.length, 6);
  for (const c of data.cases) for (const a of c.arms) {
    const key = `${a.mode}:${a.level}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  for (const [key, arms] of groups) {
    assert.equal(arms.length, 6);
    rows.push({ run, key, mean: arms.reduce((s, a) => s + (a.output.valid ? a.output.rawSimilarity : 0), 0) / 6, max: Math.max(...arms.map(a => a.output.rawSimilarity)), valid: arms.filter(a => a.output.valid).length, totalSearchWallMs: arms.reduce((s, a) => s + a.elapsedMs, 0) });
  }
}
const cascade = read("cascade-v1/results.json");
const mapping = read("blind-v1/mapping.private.json"), judge = read("blind-v1/judge.json");
assert.equal(judge.items.length, 18); assert.equal(new Set(judge.items.map(j => j.id)).size, 18);
assert.equal(createHash("sha256").update(readFileSync(`${root}/cascade-v1/results.json`)).digest("hex"), mapping.sourceHash);
for (const entry of mapping.entries) assert.equal(createHash("sha256").update(readFileSync(`${root}/blind-v1/${entry.id}.png`)).digest("hex"), entry.pngHash);
const semantic = ["baseline", "uniform", "relation"].map(mode => {
  const items = mapping.entries.filter(e => e.mode === mode).map(e => judge.items.find(j => j.id === e.id));
  assert.equal(items.length, 6); assert(items.every(Boolean));
  return { mode, count: 6, recognizable: items.filter(i => i.status === "recognizable").length, recognizableObjectAnimal: items.filter(i => i.status === "recognizable" && i.objectAnimal).length, weak: items.filter(i => i.status === "weak").length, none: items.filter(i => i.status === "none").length, meanSubjectiveScore: items.reduce((s, i) => s + i.score, 0) / 6 };
});
const orientationMapping = read("orientation-v1/mapping.private.json"), orientationJudge = read("orientation-v1/judge.json");
assert.equal(orientationJudge.items.length, 24); assert.equal(new Set(orientationJudge.items.map(j => j.id)).size, 24);
for (const r of orientationMapping.records) assert.equal(createHash("sha256").update(readFileSync(`${root}/orientation-v1/${r.id}.png`)).digest("hex"), r.pngHash);
const orientation = ["baseline", "uniform", "relation", "ideal-posed"].map(mode => {
  const items = orientationMapping.records.filter(r => r.mode === mode).map(r => orientationJudge.items.find(j => j.id === r.id));
  assert.equal(items.length, 6); assert(items.every(Boolean));
  return { mode, count: 6, recognizable: items.filter(j => j.status === "recognizable").length, weak: items.filter(j => j.status === "weak").length, none: items.filter(j => j.status === "none").length, meanSubjectiveScore: items.reduce((s, j) => s + j.score, 0) / 6 };
});
const controlsMapping = read("controls-v1/mapping.private.json"), controlsJudge = read("controls-v1/judge.json");
assert.equal(controlsJudge.items.length, 4);
for (const r of controlsMapping.records) assert.equal(createHash("sha256").update(readFileSync(`${root}/controls-v1/${r.id}.png`)).digest("hex"), r.pngHash);
const controls = { denominator: 4, recognizable: controlsJudge.items.filter(j => j.status === "recognizable").length, includedInRoadPerformance: false };
const summary = { denominator: 6, baselineMean, fixedPose: rows, cascade: cascade.summary, semantic, semanticJudge: judge.evaluator, orientation, orientationJudge: orientationJudge.evaluator, controls, originalTwelveChanged: false, humanRecognitionMeasured: false, globalOptimumBoundProven: false, appDefaultChanged: false };
writeFileSync(`${root}/summary.json`, JSON.stringify(summary, null, 2));
const csv = ["experiment,mode_budget,mean_raw_similarity,max_raw_similarity,valid,total_search_wall_ms", ...rows.map(r => [r.run, r.key, r.mean, r.max, r.valid, r.totalSearchWallMs].join(",")), ...cascade.summary.map(r => ["cascade-v1", `${r.mode}:${r.round}`, r.meanRawSimilarity, r.maxRawSimilarity, 6 - r.invalid, r.totalWallMs].join(","))].join("\n");
writeFileSync(`${root}/performance.csv`, csv);
console.log(JSON.stringify({ baselineMean, fixedPose: rows, cascade: cascade.summary, semantic }, null, 2));
