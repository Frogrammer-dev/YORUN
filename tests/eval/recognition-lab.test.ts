// Explicit offline jobs only; normal npm test does not create experiments.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { it } from "vitest";
import { DoodleClassifier, parseClassNames, rasterizeLoop } from "@/lib/art/doodle";
import { DOODLE_SKIP, doodleKo } from "@/lib/art/doodleNames";
import { candidateSchema, datasetFingerprint, grayRaster, normalizeLine, rotateLine, sha256, shuffled, validateDataset, validatePredictions, type Candidate, type Dataset, type Point, type PredictionFile } from "@/lib/eval/recognitionLab";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox, type OverpassJson } from "@/lib/route/osm";
import { SHAPES, SHAPE_BY_ID } from "@/lib/route/shapes";

const ACTION = process.env.RECOGNITION_LAB_ACTION;
const RUN = process.env.RECOGNITION_LAB_RUN ?? "pilot";
if (!/^[A-Za-z0-9_-]{1,80}$/.test(RUN)) throw new Error("Invalid experiment ID");
const OUT = resolve("eval/recognition", RUN);
const now = () => new Date().toISOString();
const jsonWrite = (file: string, value: unknown) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
const ROTATIONS = [-12, 0, 12];

it.skipIf(ACTION !== "prepare")("freeze unranked road candidates with fixture and code provenance", () => {
  if (existsSync(`${OUT}/dataset.json`)) throw new Error("This run already has a dataset. Use a new --run ID; frozen data are never overwritten.");
  const limit = Number(process.env.RECOGNITION_LAB_LIMIT ?? 80);
  const steps = Number(process.env.RECOGNITION_LAB_STEPS ?? 2500);
  const branches = process.env.RECOGNITION_LAB_BRANCHES === "1";
  if (!Number.isInteger(limit) || limit < 1 || limit > 3000 || !Number.isInteger(steps) || steps < 1) throw new Error("Invalid pool/step budget");
  const conditions: Dataset["conditions"] = [];
  const candidates: Candidate[] = [];
  for (const fixture of ["gangnam-center", "gangnam-southwest"]) {
    const bytes = readFileSync(`tests/fixtures/osm/${fixture}.json.gz`);
    const data = JSON.parse(gunzipSync(bytes).toString("utf8")) as OverpassJson & { bbox: BBox };
    const split = fixture === "gangnam-center" ? "development" : "holdout";
    const g = graphFromOverpass(data, data.bbox, { excludeSteps: true, detail: "simple" });
    const [minX, minY] = project(g.origin, data.bbox.south, data.bbox.west);
    const [maxX, maxY] = project(g.origin, data.bbox.north, data.bbox.east);
    for (const [minMeters, maxMeters] of [[2000, 5000], [3000, 8000]]) {
      const condition = `${fixture}-${minMeters}-${maxMeters}`;
      const result = discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters, maxMeters,
        region: { minX, minY, maxX, maxY }, budget: new StepBudget(steps), poolSize: limit, branchPool: branches ? limit : 0 });
      conditions.push({ id: condition, split, fixtureHash: sha256(bytes), stepBudget: steps, partial: result.partial });
      const seen = new Set<string>();
      const rows: Candidate[] = [];
      for (const c of [...result.candidates, ...(result.pool ?? [])]) {
        const line = normalizeLine(c.latlngs.map(([la, lo]) => project(g.origin, la, lo) as Point));
        const geometryHash = sha256(JSON.stringify(line));
        if (seen.has(geometryHash)) continue;
        seen.add(geometryHash);
        rows.push(candidateSchema.parse({ id: `c-${sha256(condition + geometryHash).slice(0, 20)}`, condition, split,
          source: c.branchMeters ? "branch" : c.shapeId === "doodle" ? "loop" : "template", geometryHash, line,
          lengthMeters: c.lengthMeters, repeatRatio: c.repeatRatio }));
      }
      // Sampling is model independent. Round-robin source strata retain branch/loop/template diversity.
      const strata = ["loop", "branch", "template"].map((source) => shuffled(rows.filter((c) => c.source === source)));
      const picked: Candidate[] = [];
      for (let index = 0; picked.length < limit && strata.some((s) => s[index]); index++) {
        for (const stratum of strata) if (stratum[index] && picked.length < limit) picked.push(stratum[index]);
      }
      candidates.push(...picked);
      console.log(`${condition}: ${rows.length} unique generated → ${picked.length} frozen; partial=${result.partial}`);
    }
  }
  for (const shapeId of ["heart", "star", "giraffe", "crown", "mug", "bolt"] as const) {
    const shape = SHAPE_BY_ID[shapeId], line = normalizeLine(shape.points);
    candidates.push({ id: `control-${shapeId}`, condition: "controls", split: "control", source: "control", line,
      geometryHash: sha256(JSON.stringify(line)), lengthMeters: 0, repeatRatio: 0, referenceLabel: shape.name, controlKind: "outline" });
  }
  const ambiguous: Point[][] = [
    [[0, 0], [1, 0.1], [0.8, 0.5], [0.5, 0.3], [0.2, 0.8], [-0.2, 0.3], [0, 0]],
    [[0, 0], [1, 0], [1, 0.6], [0.6, 0.6], [0.6, 1], [0.1, 0.7], [0, 0]],
  ];
  ambiguous.forEach((points, i) => {
    const line = normalizeLine(points);
    candidates.push({ id: `control-ambiguous-${i}`, condition: "controls", split: "control", source: "control", line,
      geometryHash: sha256(JSON.stringify(line)), lengthMeters: 0, repeatRatio: 0, controlKind: "ambiguous" });
  });
  let gitHead = "unknown", gitDiffHash = "unknown";
  try {
    gitHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    gitDiffHash = sha256(execFileSync("git", ["diff", "--", "src/lib/route"], { maxBuffer: 10 * 1024 * 1024 }));
  } catch { /* Git provenance is optional outside a checkout. */ }
  const codeFiles = ["src/lib/route/discover.ts", "src/lib/route/loops.ts", "src/lib/route/branches.ts", "src/lib/route/graph.ts", "src/lib/route/osm.ts", "tests/eval/recognition-lab.test.ts", "src/lib/eval/recognitionLab.ts"];
  const dataset = validateDataset({ schemaVersion: 1, id: RUN, createdAt: now(), conditions, candidates,
    fingerprint: datasetFingerprint({ conditions, candidates }), provenance: { gitHead, gitDiffHash,
      codeHashes: Object.fromEntries(codeFiles.filter(existsSync).map((file) => [file, sha256(readFileSync(file))])),
      seed: 20261010, poolLimitPerCondition: limit, branches, normalization: "bbox-center-max-span-6dp-y-up",
      sampling: "seeded source round-robin; frozen sampled pool, not exhaustive generator oracle",
      splitWarning: "Two Gangnam areas only. Development/holdout is a pilot, not regional generalization.",
      controlsWarning: "Synthetic outlines/ambiguous shapes are diagnostic prompts, not human ground truth." } });
  mkdirSync(OUT, { recursive: true });
  jsonWrite(`${OUT}/dataset.json`, dataset);
  jsonWrite(`${OUT}/vocabulary.json`, parseClassNames(readFileSync("public/models/doodlenet/class_names.txt", "utf8")).map((english) => ({ english, label: doodleKo(english), excluded: DOODLE_SKIP.has(english) })));
  console.log(`${candidates.length} candidates frozen at ${OUT}`);
}, 900_000);

it.skipIf(ACTION !== "infer")("same frozen pool: DoodleNet binary28 versus gray28", async () => {
  const dataset = validateDataset(JSON.parse(readFileSync(`${OUT}/dataset.json`, "utf8")));
  mkdirSync(`${OUT}/predictions`, { recursive: true });
  if (["doodle-binary", "doodle-gray"].some((method) => existsSync(`${OUT}/predictions/${method}.json`))) throw new Error("Predictions already exist. Use a new run or import a uniquely named method.");
  const dir = "public/models/doodlenet", bytes = readFileSync(`${dir}/group1-shard1of1.bin`);
  const modelJson = readFileSync(`${dir}/model.json`, "utf8"), names = readFileSync(`${dir}/class_names.txt`, "utf8");
  const clf = await DoodleClassifier.fromMemory(JSON.parse(modelJson), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), names);
  for (const variant of ["binary", "gray"] as const) {
    const predictions: PredictionFile["predictions"] = [];
    const raster = variant === "binary" ? rasterizeLoop : grayRaster;
    mkdirSync(`${OUT}/pixels/${variant}`, { recursive: true });
    for (let start = 0; start < dataset.candidates.length; start += 12) {
      const batch = dataset.candidates.slice(start, start + 12), began = performance.now();
      const images = batch.flatMap((c) => ROTATIONS.map((deg) => raster(rotateLine(c.line, deg))));
      batch.forEach((c, i) => jsonWrite(`${OUT}/pixels/${variant}/${c.id}.json`, Array.from(images[i * 3 + 1])));
      const guesses = await clf.classify(images, clf.classes.length);
      const elapsed = (performance.now() - began) / batch.length;
      batch.forEach((candidate, i) => {
        const averages = new Float64Array(clf.classes.length);
        for (let r = 0; r < 3; r++) for (const guess of guesses[i * 3 + r]) averages[guess.index] += guess.prob / 3;
        const ranked = Array.from(averages, (score, j) => ({ label: doodleKo(clf.classes[j]), score, excluded: DOODLE_SKIP.has(clf.classes[j]) })).sort((a, b) => b.score - a.score);
        const best = ranked.find((r) => !r.excluded);
        predictions.push({ candidateId: candidate.id, label: best?.label ?? null, accepted: !!best && best.score >= 0.35,
          rawScore: best?.score ?? null, rankingScore: best?.score ?? 0, topK: ranked.slice(0, 5), latencyMs: elapsed,
          reason: best && best.score >= 0.35 ? "legacy 0.35 threshold; uncalibrated" : "below legacy threshold" });
      });
      console.log(`${variant}: ${Math.min(start + batch.length, dataset.candidates.length)}/${dataset.candidates.length}`);
    }
    const file = validatePredictions({ schemaVersion: 1, datasetId: RUN, datasetFingerprint: dataset.fingerprint,
      method: `doodle-${variant}`, model: "DoodleNet-345", renderer: `${variant}28`, createdAt: now(),
      metadata: { rotations: ROTATIONS, threshold: 0.35, calibrated: false, backend: "tfjs-cpu",
        modelHash: sha256(modelJson + sha256(bytes) + names), rendererHash: sha256(readFileSync(variant === "gray" ? "src/lib/eval/recognitionLab.ts" : "src/lib/art/doodle.ts")),
        notes: "Raw score is softmax, not human recognition probability. Timings include rendering/inference, exclude model loading." }, predictions }, dataset);
    jsonWrite(`${OUT}/predictions/${file.method}.json`, file);
  }
}, 900_000);
