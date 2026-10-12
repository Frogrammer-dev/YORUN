import { sha256, datasetFingerprint, validateDataset, validatePredictions } from "../../src/lib/eval/recognitionLab.ts";

export function uiFixture() {
  const line = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, -0.5]];
  const candidates = ["c1", "c2"].map((id) => ({ id, condition: "area", source: "loop", split: "development", line, geometryHash: sha256(JSON.stringify(line)), lengthMeters: 3000, repeatRatio: 0 }));
  const conditions = [{ id: "area", split: "development", fixtureHash: "fixture", stepBudget: 100, partial: false }];
  const dataset = validateDataset({ schemaVersion: 1, id: "ui-test", fingerprint: datasetFingerprint({ candidates, conditions }), candidates, conditions, createdAt: "now", provenance: {} });
  const files = ["binary", "gray"].map((method) => validatePredictions({ schemaVersion: 1, datasetId: dataset.id, datasetFingerprint: dataset.fingerprint, method, model: "test", renderer: "test", createdAt: "now", metadata: {},
    predictions: candidates.map((c) => ({ candidateId: c.id, label: "하트", accepted: true, rawScore: 0.9, rankingScore: 0.9, topK: [], latencyMs: 1, reason: "test" })) }, dataset));
  return { dataset, files };
}
