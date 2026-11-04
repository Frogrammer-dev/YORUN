import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { selectRoadReferenceInputs } from "@/lib/art/roadReferenceClient";
import { describeRouteStructure } from "@/lib/art/routeStructure";
import { makeCandidate } from "../helpers/candidate";

const source = "eval/recognition/road-first-reference-20261014/inputs/audit.json";
it.skipIf(!process.env.ROUTE_STRUCTURE_EVAL || !existsSync(source))("compares selectors on the same six stored native routes without model calls", () => {
  const audit = JSON.parse(readFileSync(source, "utf8")) as { cases: Array<{ id: string; originalLatlngs: [number, number][]; nativeMeters: number; nativeRepeatRatio: number }> };
  const pool = audit.cases.map(c => makeCandidate({ id: c.id, shapeId: "doodle", shapeName: "", outline: [], outlines: [], latlngs: c.originalLatlngs, lengthMeters: c.nativeMeters, repeatRatio: c.nativeRepeatRatio }));
  const bounds = { minMeters: 3000, maxMeters: 8000 };
  const run = (strategy: "baseline" | "structure") => {
    const started = performance.now();
    const inputs = selectRoadReferenceInputs(pool, bounds, 3, strategy);
    return { elapsedMs: performance.now() - started, selected: inputs.map(p => ({ id: p.candidate.id, fingerprint: p.packet.fingerprint, salience: describeRouteStructure(p.renderLine).salience })) };
  };
  const baseline = run("baseline"), structure = run("structure");
  expect(structure.selected).toHaveLength(3);
  expect(structure.selected[0].id).toBe(baseline.selected[0].id);
  const judgmentPath = "eval/recognition/road-first-reference-20261014/judging/blind-road-only.json";
  const judgments = JSON.parse(readFileSync(judgmentPath, "utf8")) as {
    model: string; judgeType: string;
    evaluations: Array<{ candidateId: string; decision: string; recognizability: number }>;
    inputIntegrity: { sha256BeforeAndAfter: Record<string, string> };
  };
  for (const [file, expected] of Object.entries(judgments.inputIntegrity.sha256BeforeAndAfter)) {
    const actual = createHash("sha256").update(readFileSync(`eval/recognition/road-first-reference-20261014/inputs/${file}`)).digest("hex");
    expect(actual, `stored judge input ${file}`).toBe(expected);
  }
  const summarize = (selected: typeof baseline.selected) => {
    const rows = selected.map(p => judgments.evaluations.find(j => j.candidateId === p.id)!);
    expect(rows.every(Boolean)).toBe(true);
    return { recognizable: rows.filter(r => r.decision === "recognizable").length, count: rows.length, meanSubjectiveAiScore: rows.reduce((s, r) => s + r.recognizability, 0) / rows.length, rows };
  };
  const semantic = { source: judgmentPath, model: judgments.model, judgeType: judgments.judgeType, reusedPriorJudgments: true, independentNewTest: false, inputHashesVerified: true, baseline: summarize(baseline.selected), structure: summarize(structure.selected), verdict: "no-recognizable-gain-on-this-sample" };
  const result = { source, poolSize: pool.length, samePool: true, maxCandidates: 3, externalCalls: 0, humanRecognitionMeasured: false, geometricTwelveMeasured: false, selectionHeuristicIsNotRecognitionScore: true, baseline, structure, semantic };
  mkdirSync("eval/recognition/structure-selection-20261021", { recursive: true });
  writeFileSync("eval/recognition/structure-selection-20261021/comparison.json", JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
});
