import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { expect, it } from "vitest";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { hasEdge, project, type RoadGraph } from "@/lib/route/graph";
import { buildBlocks, growLoops, loopSamples, matchShape, shapeSamples } from "@/lib/route/loops";
import { StepBudget } from "@/lib/route/budget";
import { evaluatePath, placeShape, type Placement, type Region } from "@/lib/route/fit";
import { refinePathPlacement } from "@/lib/route/refinePlacement";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";
import { selectRoadReferenceInputs } from "@/lib/art/roadReferenceClient";
import { describeRouteHypotheses } from "@/lib/art/routeHypotheses";
import { normalizeRoadReferenceRenderLine } from "@/lib/art/roadReference";
import { relationDiagnostics, relationGuidedSearch } from "@/lib/route/relationGuidedSearch";
import { makeCandidate } from "../helpers/candidate";

const root = "eval/recognition/route-improvement/holdout";
const run = process.env.RELATION_RUN ?? "trial-v1";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid experiment directory");
const out = `eval/recognition/relation-generation-20261021/${run}`;
const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
function audit(g: RoadGraph, region: Region, nodes: number[]) {
  let native = 0, projected = 0, repeated = 0, projectedRepeated = 0;
  const seen = new Set<string>();
  let valid = nodes.length >= 4 && nodes[0] === nodes.at(-1);
  for (let i = 0; i < nodes.length; i++) {
    const v = nodes[i];
    if (v < 0 || v >= g.n || g.x[v] < region.minX || g.x[v] > region.maxX || g.y[v] < region.minY || g.y[v] > region.maxY) { valid = false; break; }
    if (!i) continue;
    const a = nodes[i - 1];
    if (!hasEdge(g, a, v)) { valid = false; break; }
    let d = 0;
    for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === v) { d = g.adjLen[k]; break; }
    const p = Math.hypot(g.x[v] - g.x[a], g.y[v] - g.y[a]), key = a < v ? `${a}:${v}` : `${v}:${a}`;
    native += d; projected += p;
    if (seen.has(key)) { repeated += d; projectedRepeated += p; }
    seen.add(key);
  }
  const repeatRatio = repeated / native, projectedRepeatRatio = projectedRepeated / projected;
  valid &&= native >= 3000 && native <= 8000 && projected >= 3000 && projected <= 8000 && repeatRatio <= .2 && projectedRepeatRatio <= .2;
  return { valid, nativeMeters: native, projectedMeters: projected, repeatRatio, projectedRepeatRatio, edgeHash: sha([...seen].sort().join(",")) };
}

it.skipIf(!process.env.RELATION_GENERATION || !existsSync(`${root}/protocol.json`))("measures relation-directed native path generation on six fixed discovery hypotheses", async () => {
  const protocol = JSON.parse(readFileSync(`${root}/protocol.json`, "utf8")) as { areas: Array<{ id: string; bbox: BBox; sha256: string }> };
  const levels = (process.env.RELATION_LEVELS ?? "8,32,96").split(",").map(Number);
  expect(levels.every(n => Number.isInteger(n) && n > 0 && n <= 384)).toBe(true);
  const sourceFiles = ["src/lib/route/relationGuidedSearch.ts", "src/lib/art/routeHypotheses.ts", "src/lib/art/roadReferenceClient.ts", "src/lib/route/fit.ts", "src/lib/route/shapes.ts", "src/lib/route/loops.ts", "src/lib/route/graph.ts", "src/lib/route/osm.ts", "tests/eval/relation-generation-20261021.test.ts"];
  const codeHashes = Object.fromEntries(sourceFiles.map(f => [f, sha(readFileSync(f))]));
  mkdirSync(out, { recursive: true });
  const spec = { denominator: 6, seed: 20261021, growthSeeds: 400, families: ["animal", "object"], levels, modes: ["uniform", "relation"], sameInitialStatePerArm: true, separateRestartPerLevel: true, maxExpanded: Number(process.env.RELATION_MAX_EXPANDED ?? 12000), minMeters: 3000, maxMeters: 8000, maxRepeatRatio: .2, originalTwelveReplaced: false, holdoutV2Read: false, developmentRegions: true, paidApiCalls: 0, codeHashes };
  expect(Number.isInteger(spec.maxExpanded) && spec.maxExpanded > 0 && spec.maxExpanded <= 100000).toBe(true);
  writeFileSync(`${out}/protocol.json`, JSON.stringify(spec, null, 2));
  const cases: unknown[] = [], timings = [], start = performance.now();
  for (const area of protocol.areas) {
    if (process.env.RELATION_AREA && process.env.RELATION_AREA !== area.id) continue;
    const areaStart = performance.now(), bytes = readFileSync(`${root}/${area.id}-roads.json`);
    expect(sha(bytes)).toBe(area.sha256);
    const g = graphFromOverpass(JSON.parse(bytes.toString()), area.bbox, { detail: "simple", excludeSteps: true });
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east);
    const region = { minX, minY, maxX, maxY }, blocks = buildBlocks(g, (maxX - minX) * (maxY - minY) / 4);
    const loops = growLoops(g, blocks, region, 3000, 8000, { seeds: 400, budget: new StepBudget(400), fraction: 1, seed: 20261021 });
    const pool = [], paths = new Map<string, number[]>(), seen = new Set<string>();
    for (const loop of loops) {
      const a = audit(g, region, loop.path);
      if (!a.valid || seen.has(a.edgeHash)) continue;
      seen.add(a.edgeHash);
      const candidate = makeCandidate({ id: a.edgeHash, shapeId: "doodle", shapeName: "", outline: [], outlines: [], latlngs: loop.path.map(v => [g.lat[v], g.lon[v]]), lengthMeters: a.nativeMeters, repeatRatio: a.repeatRatio });
      paths.set(candidate.id, loop.path); pool.push(candidate);
    }
    const generationMs = performance.now() - areaStart, selectionStart = performance.now();
    const chosen = selectRoadReferenceInputs(pool, { minMeters: 3000, maxMeters: 8000 }, 3, "hypothesis");
    expect(chosen).toHaveLength(3);
    const selectionMs = performance.now() - selectionStart;
    timings.push({ area: area.id, pool: pool.length, generationMs, selectionMs });
    for (const [index, family] of (["animal", "object"] as const).entries()) {
      const id = `${area.id}-${family}`, seed = chosen[index + 1], shapeId = describeRouteHypotheses(seed.renderLine)[family]!.shapeId as ShapeId;
      const shape = SHAPE_BY_ID[shapeId], nodes = paths.get(seed.candidate.id)!;
      const xy = nodes.map((v): [number, number] => [g.x[v], g.y[v]]);
      const fit = matchShape(xy, shape, shapeSamples(shape), false, loopSamples(xy), { fullRotation: true })!;
      let placement: Placement = { cx: fit.cx, cy: fit.cy, scale: fit.scale, rotDeg: fit.rotDeg };
      // A deterministic uniform-pose clamp makes the whole unchanged template
      // fit the original region; no road vertex or part is moved independently.
      let outline = placeShape(shape.points, placement);
      const width = Math.max(...outline.map(p => p[0])) - Math.min(...outline.map(p => p[0])), height = Math.max(...outline.map(p => p[1])) - Math.min(...outline.map(p => p[1]));
      placement.scale *= Math.min(1, (maxX - minX) * .999 / width, (maxY - minY) * .999 / height);
      outline = placeShape(shape.points, placement);
      const loX = Math.min(...outline.map(p => p[0])), hiX = Math.max(...outline.map(p => p[0])), loY = Math.min(...outline.map(p => p[1])), hiY = Math.max(...outline.map(p => p[1]));
      placement.cx += loX < minX ? minX - loX : hiX > maxX ? maxX - hiX : 0;
      placement.cy += loY < minY ? minY - loY : hiY > maxY ? maxY - hiY : 0;
      const refitStart = performance.now(), refit = refinePathPlacement(g, shape, placement, nodes, region, 3000, 8000, 80);
      placement = refit?.placement ?? placement;
      const refitMs = performance.now() - refitStart;
      const initial = evaluatePath(g, shape, placement, nodes, 3000, 8000);
      const metrics = (p: Placement, path: number[]) => {
        const a = audit(g, region, path), e = evaluatePath(g, shape, p, path, 3000, 8000);
        const templateInside = placeShape(shape.points, p).every(([x, y]) => x >= minX - 1e-7 && x <= maxX + 1e-7 && y >= minY - 1e-7 && y <= maxY + 1e-7);
        const q = e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
        return { ...a, valid: a.valid && templateInside, templateInside, rawSimilarity: a.valid && templateInside ? 100 * Math.exp(-q) : 0, relation: relationDiagnostics(g, shape, p, path), meanDeviationMeters: e.meanDev, featureCoverage: e.featureCoverage, spikes: e.spikes, zigzagPerKm: e.zigzagPerKm, placement: p, path, latlngs: path.map(v => [g.lat[v], g.lon[v]]) };
      };
      const baseline = metrics(placement, initial.path);
      expect(baseline.valid, id).toBe(true);
      const arms = [];
      for (const level of levels) for (const mode of ["uniform", "relation"] as const) {
        const armStart = performance.now();
        const result = relationGuidedSearch(g, shape, placement, initial.path, region, { mode, maxProposals: level, maxExpanded: spec.maxExpanded, minMeters: 3000, maxMeters: 8000 });
        const elapsedMs = performance.now() - armStart;
        const evaluated = result?.evaluated;
        const value = evaluated ? metrics(evaluated.fit ?? placement, evaluated.path) : { ...baseline, valid: false, rawSimilarity: 0 };
        const record = { level, mode, elapsedMs, output: value, diagnostics: result ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== "evaluated")) : null };
        arms.push(record);
        writeFileSync(`${out}/${id}-progress.json`, JSON.stringify({ id, area: area.id, shapeId, family, baseline, refitMs, arms }, null, 2));
        console.log(JSON.stringify({ id, shapeId, level, mode, elapsedMs: Math.round(elapsedMs), rawSimilarity: value.rawSimilarity, valid: value.valid }));
      }
      const item = { id, area: area.id, bbox: area.bbox, roadHash: area.sha256, shapeId, family, seedFingerprint: seed.packet.fingerprint, baseline, refitMs, arms };
      cases.push(item);
      writeFileSync(`${out}/${id}.json`, JSON.stringify(item, null, 2));
      const images = [baseline, ...arms.filter(a => a.level === Math.max(...levels)).map(a => a.output)];
      for (const [i, state] of images.entries()) {
        const line = normalizeRoadReferenceRenderLine({ id: "raw", latlngs: state.latlngs as [number, number][] });
        const d = line.map(([x, y], j) => `${j ? "L" : "M"}${(x * 400).toFixed(3)},${(y * 400).toFixed(3)}`).join(" ");
        await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round"/></svg>`)).png().toFile(`${out}/${id}-${i}.png`);
      }
    }
  }
  for (const [file, hash] of Object.entries(codeHashes)) expect(sha(readFileSync(file))).toBe(hash);
  writeFileSync(`${out}/results.json`, JSON.stringify({ spec, timings, elapsedMs: performance.now() - start, cases }, null, 2));
}, 1800000);
