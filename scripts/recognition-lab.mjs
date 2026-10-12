#!/usr/bin/env node
// Node 24+ type stripping loads the pure TypeScript experiment contracts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDataset, validatePredictions, validateReview, summarize, sha256, outlineSvg, shuffled } from "../src/lib/eval/recognitionLab.ts";
import { reviewHtml, comparisonHtml } from "./recognition-lab/review.mjs";
import { classifyGemini, PROMPT, RESULT_SCHEMA } from "./recognition-lab/gemini.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(ROOT);
const [command = "help", ...args] = process.argv.slice(2);
const options = {};
for (let i = 0; i < args.length; i++) {
  if (!args[i].startsWith("--")) throw new Error(`Unexpected argument: ${args[i]}`);
  const key = args[i].slice(2);
  options[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
}
const allowedOptions = new Set(["run", "limit", "steps", "branches", "count", "split", "file", "min-judges", "top-k", "channel", "model", "method", "execute", "max-calls"]);
for (const key of Object.keys(options)) if (!allowedOptions.has(key)) throw new Error(`Unknown option --${key}`);
for (const key of ["execute", "branches"]) if (options[key] !== undefined && options[key] !== true) throw new Error(`--${key} is a flag; omit it to disable`);
const run = options.run ?? "pilot";
if (typeof run !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(run)) throw new Error("--run must be a short letters/numbers/hyphens ID");
const OUT = resolve("eval/recognition", run);
const labTemp = resolve("eval/recognition/tmp");
mkdirSync(labTemp, { recursive: true });
for (const name of ["TMP", "TEMP", "TMPDIR"]) process.env[name] = labTemp;
const read = (path) => JSON.parse(readFileSync(path, "utf8"));
const write = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data, null, 2) + "\n"); };
const positive = (value, fallback, max = 10000) => {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`Expected integer 1..${max}`);
  return number;
};
const dataset = () => validateDataset(read(`${OUT}/dataset.json`));
function predictions(d) {
  const dir = `${OUT}/predictions`;
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => validatePredictions(read(`${dir}/${f}`), d)) : [];
  if (new Set(files.map((f) => f.method)).size !== files.length) throw new Error("Duplicate method IDs");
  return files;
}
function job(action) {
  const tmp = resolve("eval/recognition/tmp"); mkdirSync(tmp, { recursive: true });
  const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/eval/recognition-lab.test.ts", "--maxWorkers=1", "--no-file-parallelism"], {
    cwd: ROOT, stdio: "inherit", env: { ...process.env, TMP: tmp, TEMP: tmp, TMPDIR: tmp,
      RECOGNITION_LAB_ACTION: action, RECOGNITION_LAB_RUN: run, RECOGNITION_LAB_LIMIT: String(positive(options.limit, 80, 3000)),
      RECOGNITION_LAB_STEPS: String(positive(options.steps, 2500, 100000)), RECOGNITION_LAB_BRANCHES: options.branches ? "1" : "0" },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Experiment ${action} failed (${result.status})`);
}
async function render() {
  const d = dataset(), { chromium } = await import("playwright-core");
  let browser;
  const channel = options.channel ?? process.env.PW_CHANNEL;
  if (channel) browser = await chromium.launch({ channel });
  else {
    try { browser = await chromium.launch(); } catch { browser = await chromium.launch({ channel: "msedge" }); }
  }
  try {
    const page = await browser.newPage({ viewport: { width: 224, height: 224 }, deviceScaleFactor: 1 });
    mkdirSync(`${OUT}/images`, { recursive: true });
    for (const c of d.candidates) {
      await page.setContent(`<body style="margin:0">${outlineSvg(c.line)}</body>`);
      await page.screenshot({ path: `${OUT}/images/${c.id}.png`, clip: { x: 0, y: 0, width: 224, height: 224 } });
      for (const variant of ["binary", "gray"]) {
        const path = `${OUT}/pixels/${variant}/${c.id}.json`;
        if (!existsSync(path)) continue;
        const pixels = read(path);
        const rects = pixels.map((v, i) => `<rect x="${i % 28 * 8}" y="${Math.floor(i / 28) * 8}" width="8" height="8" fill="rgb(${Math.round(255 * (1 - v))},${Math.round(255 * (1 - v))},${Math.round(255 * (1 - v))})"/>`).join("");
        await page.setContent(`<body style="margin:0"><svg width="224" height="224">${rects}</svg></body>`);
        await page.screenshot({ path: `${OUT}/images/${variant}-${c.id}.png`, clip: { x: 0, y: 0, width: 224, height: 224 } });
      }
    }
  } finally { await browser.close(); }
  console.log(`PNG images → ${OUT}/images`);
}
function shortlist(d, files, perCondition) {
  const out = [];
  for (const condition of d.conditions) {
    const pool = d.candidates.filter((c) => c.condition === condition.id), ids = new Set(pool.map((c) => c.id));
    const strata = files.map((f) => f.predictions.filter((p) => ids.has(p.candidateId)).sort((a, b) => b.rankingScore - a.rankingScore || a.candidateId.localeCompare(b.candidateId)).map((p) => p.candidateId));
    strata.push(shuffled(pool.map((c) => c.id))); // model-independent audit candidates are not gated out
    const selected = new Set();
    for (let i = 0; selected.size < perCondition && strata.some((s) => s[i]); i++) for (const s of strata) {
      if (s[i] && selected.size < perCondition) selected.add(s[i]);
    }
    out.push(...pool.filter((c) => selected.has(c.id)));
  }
  return out;
}
function review() {
  const d = dataset(), files = predictions(d);
  const split = options.split ?? "all";
  if (!["all", "development", "holdout"].includes(split)) throw new Error("Invalid --split");
  const eligible = d.candidates.filter((c) => c.source === "control" || split === "all" || c.split === split);
  const all = options.count === "all";
  const count = all ? eligible.length : positive(options.count, 64, 20000);
  const priority = shortlist(d, files, 8).filter((c) => eligible.includes(c));
  const unique = new Map([...priority, ...shuffled(eligible)].map((c) => [c.id, c]));
  const chosen = all ? eligible : [...unique.values()].slice(0, count);
  const name = split === "all" ? "judge.html" : `judge-${split}.html`;
  writeFileSync(`${OUT}/${name}`, reviewHtml(d, files, chosen));
  writeFileSync(`${OUT}/comparison.html`, comparisonHtml(d, files));
  write(`${OUT}/review-selection-${split}.json`, { selected: chosen.map((c) => c.id), total: eligible.length, mode: all ? "full-frozen-pool" : "shortlist plus seeded audit sample" });
  mkdirSync(`${OUT}/reviews`, { recursive: true });
  console.log(`Blind human page: ${OUT}/${name} (${chosen.length}/${eligible.length}); analyst comparison: comparison.html`);
}
const pct = (n) => n === null ? "미측정" : `${(n * 100).toFixed(1)}%`;
function score() {
  const d = dataset(), files = predictions(d), dir = `${OUT}/reviews`;
  const reviews = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => validateReview(read(`${dir}/${f}`), d, files)) : [];
  const result = summarize(d, files, reviews, positive(options["min-judges"], 3, 100), positive(options["top-k"], 8, 1000));
  const lines = [`# 경로 인식 실험 ${run}`, "", `사람 판정자 ${reviews.length}명. 경로당 최소 ${result.minJudges}명 다수결. 미판정은 실패로 세지 않습니다.`, "",
    "점수는 사람 인식 확률이 아닙니다. 아래 정밀도는 판정된 표시 후보의 부분집합 결과이며, 모든 후보 판정 여부를 함께 보세요.", "",
    "| 방법 | 실제 경로 예측 | 표시 대상 | 판정 완료 | 이름 납득 정밀도 | Wilson 하한 | 전체 표시 판정 완료 |", "|---|---:|---:|---:|---:|---:|---|",
    ...result.methods.map((m) => `| ${m.method} | ${m.predictions} | ${m.accepted} | ${m.judgedAccepted} | ${pct(m.precision)} | ${pct(m.lower95)} | ${m.complete ? "예" : "아니요"} |`), "",
    "## 개발 영역과 보류 영역", "", "| 방법 | 분할 | 표시 | 판정 | 납득 정밀도 |", "|---|---|---:|---:|---:|",
    ...result.methods.flatMap((m) => m.splits.map((s) => `| ${m.method} | ${s.split} | ${s.accepted} | ${s.judgedAccepted} | ${pct(s.precision)} |`)), "",
    ...result.methods.map((m) => `- ${m.method}: 아무것도 안 보인다고 판정한 ${m.negativeJudged}개 중 이름 표시 비율 ${pct(m.falsePositiveAcceptanceRate)}`), "",
    "## 같은 후보의 쌍별 비교", "", ...result.paired.map((p) => `- ${p.method}: 공통 평가 ${p.n}개 중 이름 납득 ${p.recognized}개`), "",
    "## 지역별 후보 가능성과 상위 추천", "",
    "oracle은 이름 없이 의미가 보인다고 사람이 판정한 후보입니다. 풀 일부만 판정하면 전체 후보 가능성을 확정하지 않습니다.", "",
    "| 방법 | 조건 | 분할 | 풀 | 자유 판정 완료 | 의미 있는 후보 | top-k | top-k 판정 | 이름 납득 |", "|---|---|---|---:|---:|---:|---:|---:|---:|",
    ...result.methods.flatMap((m) => m.conditions.map((c) => `| ${m.method} | ${c.condition} | ${c.split} | ${c.pool} | ${c.oracleJudged} | ${c.oraclePositive} | ${c.recommended} | ${c.topJudged} | ${c.topHits} |`)), "",
    "두 강남 영역의 파일럿입니다. 지역 일반화·출시 품질을 입증하지 않습니다. 대조 그림은 실제 도로 지표에서 제외했습니다. 신뢰구간은 설명용이며 인접 경로 간 상관을 보정하지 않았습니다.", "",
    "생성물: dataset.json(고정 후보), predictions/*.json(모델별 결과), judge.html(블라인드 평가), comparison.html(분석), summary.json(전체 지표).", "" ];
  write(`${OUT}/summary.json`, result); writeFileSync(`${OUT}/summary.md`, lines.join("\n"));
  console.log(`Report → ${OUT}/summary.md (${reviews.length} human judges)`);
}
function importPredictions() {
  if (typeof options.file !== "string") throw new Error("--file is required");
  const d = dataset(), file = validatePredictions(read(resolve(options.file)), d);
  const path = `${OUT}/predictions/${file.method}.json`;
  if (existsSync(path)) throw new Error("This method already exists; use a new method/version ID");
  write(path, file); console.log(`Imported ${file.method}: ${file.predictions.length} rows. Regenerate review pages before collecting new labels.`);
}
async function vlm() {
  const d = dataset(), files = predictions(d);
  const model = options.model;
  if (typeof model !== "string" || !/^[A-Za-z0-9._-]+$/.test(model)) throw new Error("Specify --model with a supported Gemini model ID");
  const method = options.method ?? `gemini-${model.replace(/\./g, "-")}`;
  if (typeof method !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(method)) throw new Error("Invalid --method");
  if (existsSync(`${OUT}/predictions/${method}.json`)) throw new Error("This method is frozen; use a new --method for a new experiment");
  const chosen = shortlist(d, files, positive(options.limit, 4, 1000));
  const configHash = sha256(JSON.stringify({ model, PROMPT, RESULT_SCHEMA, renderer: "outline224-v1", store: false, temperature: 0, maxOutputTokens: 2048 }));
  const requests = chosen.map((c) => {
    const image = `${OUT}/images/${c.id}.png`;
    if (!existsSync(image)) throw new Error("Run render before vlm");
    const png = readFileSync(image), key = sha256(configHash + sha256(png));
    return { c, png, cache: `${OUT}/cache/${key}.json` };
  });
  const misses = requests.filter((r) => !existsSync(r.cache)).length, maxCalls = positive(options["max-calls"], 16, 10000);
  write(`${OUT}/vlm-plan.json`, { model, method, count: requests.length, cacheMisses: misses, maxCalls, candidates: chosen.map((c) => c.id),
    payload: "normalized outline PNG only; no GPS, fixture name, label or user identifiers", store: false, promptHash: configHash });
  console.log(`VLM plan: ${requests.length} candidates; ${misses} new calls; budget ${maxCalls}. --execute required to call API.`);
  if (!options.execute) return;
  if (misses > maxCalls) throw new Error("Plan exceeds --max-calls. Reduce --limit or explicitly increase the budget.");
  const apiKey = process.env.GEMINI_API_KEY;
  if (misses && !apiKey) throw new Error("Set GEMINI_API_KEY in the process environment (never NEXT_PUBLIC)");
  const rows = [], usages = [];
  let calls = 0;
  for (const request of requests) {
    let cached;
    if (existsSync(request.cache)) cached = read(request.cache);
    else {
      if (++calls > maxCalls) throw new Error("Call budget reached");
      const ledgerPath = `${OUT}/call-ledger.json`;
      const ledger = existsSync(ledgerPath) ? read(ledgerPath) : [];
      ledger.push({ at: new Date().toISOString(), method, candidateId: request.c.id, status: "attempted" }); write(ledgerPath, ledger);
      cached = await classifyGemini({ model, apiKey, png: request.png });
      write(request.cache, cached);
      ledger.at(-1).status = "completed"; write(ledgerPath, ledger);
    }
    const r = cached.result;
    rows.push({ candidateId: request.c.id, label: r.rejected ? null : r.label, accepted: !r.rejected, rawScore: null,
      rankingScore: 0, topK: [], latencyMs: cached.latencyMs, reason: `${r.visibleFeatures}\nMissing: ${r.missingFeatures}\nReject: ${r.rejectReason}`.slice(0, 2000) });
    usages.push({ candidateId: request.c.id, usage: cached.usage });
    console.log(`${rows.length}/${requests.length}: ${request.c.id} ${r.rejected ? "rejected" : "named"}`);
  }
  const file = validatePredictions({ schemaVersion: 1, datasetId: run, datasetFingerprint: d.fingerprint, method, model,
    renderer: "outline224", createdAt: new Date().toISOString(), metadata: { provider: "Gemini Interactions REST", promptHash: configHash,
      prompt: PROMPT, store: false, usages, newCalls: calls, calibrated: false, selection: "round-robin methods plus seeded audit candidates",
      notes: "Partial-pool naming trial, not a calibrated ranker. rankingScore=0 uses ID tie-break. Do not compare raw model confidence." }, predictions: rows }, d);
  write(`${OUT}/predictions/${method}.json`, file);
}
try {
  switch (command) {
    case "prepare": job("prepare"); break;
    case "infer": job("infer"); break;
    case "render": await render(); break;
    case "review": review(); break;
    case "score": score(); break;
    case "import": importPredictions(); break;
    case "vlm": await vlm(); break;
    case "all": job("prepare"); job("infer"); await render(); review(); score(); break;
    case "help": console.log("npm run lab -- <all|prepare|infer|render|review|score|import|vlm> --run ID\nall: offline only; default pool 80 per condition. --limit 24 for quick pilot.\nreview: --count all|64 --split all|development|holdout\nscore: --min-judges 3 --top-k 8\nimport: --file predictions.json\nvlm: --model MODEL --limit 4 --max-calls 16 [--execute]; requires render; dry-run by default."); break;
    default: throw new Error(`Unknown command: ${command}`);
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
