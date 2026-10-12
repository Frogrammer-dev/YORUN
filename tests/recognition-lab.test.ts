import { describe, expect, it } from "vitest";
import { datasetFingerprint, grayRaster, normalizeLine, sha256, shuffled, studyFingerprint, summarize, validateDataset, validatePredictions, validateReview, type Dataset, type PredictionFile, type Review } from "@/lib/eval/recognitionLab";

function fixture() {
  const line = normalizeLine([[100, 100], [110, 100], [110, 105], [100, 100]]);
  const candidates: Dataset["candidates"] = ["c1", "c2"].map((id) => ({ id, line, geometryHash: sha256(JSON.stringify(line)), condition: "area", split: "development", source: "loop", lengthMeters: 3000, repeatRatio: 0 }));
  const conditions: Dataset["conditions"] = [{ id: "area", split: "development", fixtureHash: "fixture", stepBudget: 100, partial: false }];
  const dataset = validateDataset({ schemaVersion: 1, id: "test", createdAt: "now", conditions, candidates, provenance: {}, fingerprint: datasetFingerprint({ conditions, candidates }) });
  const file = validatePredictions({ schemaVersion: 1, datasetId: "test", datasetFingerprint: dataset.fingerprint, method: "binary", model: "test-model", renderer: "binary28", createdAt: "now", metadata: {},
    predictions: candidates.map((c) => ({ candidateId: c.id, label: "하트", accepted: true, rawScore: 0.9, rankingScore: 0.9, topK: [], latencyMs: 1, reason: "test" })) }, dataset);
  return { dataset, file };
}
function review(who: string, dataset: Dataset, files: PredictionFile[], recognized = true): Review {
  return validateReview({ schemaVersion: 1, datasetId: dataset.id, datasetFingerprint: dataset.fingerprint,
    studyFingerprint: studyFingerprint(files), who, judgeType: "human", savedAt: "now",
    items: [{ candidateId: "c1", guess: "하트", noShape: false, ratings: files.map((f) => ({ method: f.method, label: "하트", recognized, match: true, agree: 4 })) }] }, dataset, files);
}
describe("frozen recognition experiment", () => {
  it("normalization preserves aspect and cancels translation/scale without closing a path", () => {
    const a = normalizeLine([[0, 0], [10, 0], [10, 5]]);
    expect(normalizeLine([[123, 456], [143, 456], [143, 466]])).toEqual(a);
    expect(a).toEqual([[-0.5, -0.25], [0.5, -0.25], [0.5, 0.25]]);
    expect(() => normalizeLine([[0, 0], [NaN, 0]])).toThrow();
  });
  it("gray rendering contains fractional coverage and stays within valid model input", () => {
    const pixels = grayRaster([[0, 0], [10, 3], [5, 8], [0, 0]]);
    expect(pixels).toHaveLength(784);
    expect([...pixels].some((v) => v > 0 && v < 1)).toBe(true);
    expect([...pixels].every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(grayRaster([[100, 200], [120, 206], [110, 216], [100, 200]])).toEqual(pixels);
  });
  it("rejects modified geometry, foreign dataset predictions and duplicate rows", () => {
    const { dataset, file } = fixture();
    const changed = structuredClone(dataset); changed.candidates[0].line[0][0] = 0;
    expect(() => validateDataset(changed)).toThrow("Geometry changed");
    expect(() => validatePredictions({ ...file, datasetFingerprint: "other" }, dataset)).toThrow();
    expect(() => validatePredictions({ ...file, predictions: [...file.predictions, file.predictions[0]] }, dataset)).toThrow("Duplicate");
  });
  it("requires explicit human evidence and binds labels to exact model results", () => {
    const { dataset, file } = fixture(), r = review("a", dataset, [file]);
    expect(() => validateReview({ ...r, judgeType: "vlm" }, dataset, [file])).toThrow();
    expect(() => validateReview({ ...r, studyFingerprint: "other" }, dataset, [file])).toThrow();
    const wrong = structuredClone(r); wrong.items[0].ratings[0].label = "양";
    expect(() => validateReview(wrong, dataset, [file])).toThrow("label");
  });
  it("does not count missing judgments as errors or repeated judges as new evidence", () => {
    const { dataset, file } = fixture();
    const a = review("a", dataset, [file]), b = review("b", dataset, [file]), c = review("c", dataset, [file], false);
    const missing = summarize(dataset, [file], [a], 3).methods[0];
    expect(missing.precision).toBeNull(); expect(missing.judgedAccepted).toBe(0);
    const result = summarize(dataset, [file], [a, b, c], 3).methods[0];
    expect(result).toMatchObject({ judgedAccepted: 1, hits: 1, precision: 1, complete: false, completedConditions: 0 });
    expect(result.conditions[0]).toMatchObject({ pool: 2, oracleJudged: 1, oraclePositive: 1 });
    expect(() => summarize(dataset, [file], [a, a], 1)).toThrow("Duplicate judge");
  });
  it("ties are unresolved; paired comparisons use only common judged candidates", () => {
    const { dataset, file } = fixture(), second = { ...file, method: "gray" };
    const a = review("a", dataset, [file, second]), b = review("b", dataset, [file, second], false);
    expect(summarize(dataset, [file, second], [a, b], 2).paired[0].n).toBe(0);
    const c = review("c", dataset, [file, second]);
    expect(summarize(dataset, [file, second], [a, b, c], 3).paired).toEqual([
      { method: "binary", n: 1, recognized: 1 }, { method: "gray", n: 1, recognized: 1 },
    ]);
  });
  it("seeded shuffle is repeatable and does not mutate the pool", () => {
    const original = [1, 2, 3, 4, 5];
    expect(shuffled(original)).toEqual(shuffled(original));
    expect(original).toEqual([1, 2, 3, 4, 5]);
  });
});
