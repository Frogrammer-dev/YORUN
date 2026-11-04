import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { expect, it } from "vitest";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { hasEdge, project } from "@/lib/route/graph";
import { evaluatePath, placeShape, type Placement } from "@/lib/route/fit";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";
import { relationDiagnostics, relationGuidedSearch } from "@/lib/route/relationGuidedSearch";
import { normalizeRoadReferenceRenderLine } from "@/lib/art/roadReference";

const parent = "eval/recognition/relation-generation-20261021/trial-v1/results.json";
const out = "eval/recognition/relation-generation-20261021/stress-v1";
it.skipIf(!process.env.RELATION_STRESS || !existsSync(parent))("probes fixed-pose saturation on the same six initial paths, without reading optimized winners", async () => {
  const inputBytes = readFileSync(parent), input = JSON.parse(inputBytes.toString()) as { cases: Array<{ id: string; area: string; bbox: BBox; roadHash: string; shapeId: ShapeId; baseline: { path: number[]; placement: Placement; rawSimilarity: number; latlngs: [number, number][] } }> };
  expect(input.cases).toHaveLength(6);
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const files = ["tests/eval/relation-stress-20261021.test.ts", "src/lib/route/relationGuidedSearch.ts", "src/lib/route/fit.ts", "src/lib/route/shapes.ts", "src/lib/route/pairSegmentRepair.ts"];
  const codeHashes = Object.fromEntries(files.map(file => [file, sha(readFileSync(file))]));
  mkdirSync(`${out}/sources`, { recursive: true });
  for (const file of files) writeFileSync(`${out}/sources/${file.replaceAll("/", "__")}.source.txt`, readFileSync(file));
  const spec = { denominator: 6, maxProposals: 1536, maxExpanded: 12000, fixedPose: true, sharedFreshBaselineCohort: true, warmStartOptimizedWinner: false, coldEndToEndRun: false, parent, parentHash: sha(inputBytes), codeHashes, paidApiCalls: 0, holdoutV2Read: false };
  writeFileSync(`${out}/protocol.json`, JSON.stringify(spec, null, 2));
  const cases = [], began = performance.now();
  for (const c of input.cases) {
    const road = readFileSync(`eval/recognition/route-improvement/holdout/${c.area}-roads.json`);
    expect(sha(road)).toBe(c.roadHash);
    const g = graphFromOverpass(JSON.parse(road.toString()), c.bbox, { detail: "simple", excludeSteps: true });
    const [minX, minY] = project(g.origin, c.bbox.south, c.bbox.west), [maxX, maxY] = project(g.origin, c.bbox.north, c.bbox.east);
    const region = { minX, minY, maxX, maxY }, p = c.baseline.placement, shape = SHAPE_BY_ID[c.shapeId], arms = [];
    expect(c.baseline.path.map(v => [g.lat[v], g.lon[v]])).toEqual(c.baseline.latlngs);
    for (const mode of ["uniform", "relation"] as const) {
      const started = performance.now(), r = relationGuidedSearch(g, shape, p, c.baseline.path, region, { mode, maxProposals: 1536, maxExpanded: 12000 })!, elapsedMs = performance.now() - started;
      expect(r).not.toBeNull();
      const nodes = r.evaluated.path;
      expect(nodes[0]).toBe(nodes.at(-1));
      expect(nodes.every((v, i) => g.x[v] >= minX && g.x[v] <= maxX && g.y[v] >= minY && g.y[v] <= maxY && (!i || hasEdge(g, nodes[i - 1], v)))).toBe(true);
      expect(placeShape(shape.points, p).every(([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY)).toBe(true);
      let native = 0, projected = 0, repeated = 0, projectedRepeated = 0;
      const edges = new Map<string, number>();
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b = nodes[i], key = a < b ? `${a}:${b}` : `${b}:${a}`;
        let length = 0;
        for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) { length = g.adjLen[k]; break; }
        const d = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]);
        native += length; projected += d;
        if (edges.has(key)) { repeated += length; projectedRepeated += d; }
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
      expect(native >= 3000 && native <= 8000 && projected >= 3000 && projected <= 8000 && repeated / native <= .2 && projectedRepeated / projected <= .2).toBe(true);
      const e = evaluatePath(g, shape, p, nodes, 3000, 8000), q = e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
      const rawSimilarity = 100 * Math.exp(-q);
      expect(rawSimilarity).toBeGreaterThanOrEqual(c.baseline.rawSimilarity - 1e-8);
      const latlngs: [number, number][] = nodes.map(v => [g.lat[v], g.lon[v]]);
      const output = { valid: true, rawSimilarity, placement: p, path: nodes, latlngs, nativeMeters: native, projectedMeters: projected, repeatRatio: repeated / native, projectedRepeatRatio: projectedRepeated / projected, edgeHash: sha([...edges.keys()].sort().join(",")), relation: relationDiagnostics(g, shape, p, nodes) };
      arms.push({ level: 1536, mode, elapsedMs, output, diagnostics: Object.fromEntries(Object.entries(r).filter(([key]) => key !== "evaluated")) });
      const line = normalizeRoadReferenceRenderLine({ id: "raw", latlngs }), d = line.map(([x, y], i) => `${i ? "L" : "M"}${(x * 400).toFixed(3)},${(y * 400).toFixed(3)}`).join(" ");
      await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round"/></svg>`)).png().toFile(`${out}/${c.id}-${mode}.png`);
      console.log(JSON.stringify({ id: c.id, mode, rawSimilarity, attempts: r.attempts, elapsedMs }));
    }
    cases.push({ ...c, arms });
    writeFileSync(`${out}/${c.id}.json`, JSON.stringify({ ...c, arms }, null, 2));
  }
  for (const [file, hash] of Object.entries(codeHashes)) expect(sha(readFileSync(file))).toBe(hash);
  writeFileSync(`${out}/results.json`, JSON.stringify({ spec, elapsedMs: performance.now() - began, cases }, null, 2));
}, 1800000);
