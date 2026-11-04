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
import { FEATURE_ARCS, semanticFeatureDiagnostics, semanticFeatureSearch } from "@/lib/route/semanticFeatureSearch";
import { normalizeRoadReferenceRenderLine } from "@/lib/art/roadReference";

const parent = "eval/recognition/relation-generation-20261021/trial-v1/results.json";
const out = "eval/recognition/semantic-feature-20261025";
it.skipIf(!process.env.SEMANTIC_FEATURE || !existsSync(parent))("compares preregistered feature weighting with uniform error and original fit on fixed six seeds", async () => {
  const inputBytes = readFileSync(parent), input = JSON.parse(inputBytes.toString()) as { cases: Array<{ id: string; area: string; bbox: BBox; roadHash: string; shapeId: ShapeId; baseline: { path: number[]; placement: Placement; rawSimilarity: number; latlngs: [number, number][] } }> };
  expect(input.cases).toHaveLength(6);
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const files = ["tests/eval/semantic-feature-20261025.test.ts", "src/lib/route/semanticFeatureSearch.ts", "src/lib/route/relationGuidedSearch.ts", "src/lib/route/fit.ts", "src/lib/route/shapes.ts", "src/lib/route/pairSegmentRepair.ts"];
  const codeHashes = Object.fromEntries(files.map(file => [file, sha(readFileSync(file))]));
  mkdirSync(`${out}/sources`, { recursive: true });
  for (const file of files) writeFileSync(`${out}/sources/${file.replaceAll("/", "__")}.source.txt`, readFileSync(file));
  const spec = { featureArcs: FEATURE_ARCS, featureWeight:4, otherWeight:1, objective:"sum(error*weight)/sum(weight) + .5*max(error*weight/mean(weight))", correspondence:"unweighted squared-error cyclic+reverse 48 bins", schedule:"uniform both new arms", success:"feature clear-object count greater than BOTH controls; otherwise unsupported", originalGeometricRegressionAllowed:true, denominator: 6, maxProposals: 192, maxExpanded: 12000, fixedPose: true, sharedFreshBaselineCohort: true, warmStartOptimizedWinner: false, coldEndToEndRun: false, parent, parentHash: sha(inputBytes), codeHashes, paidApiCalls: 0, holdoutV2Read: false };
  writeFileSync(`${out}/protocol.json`, JSON.stringify(spec, null, 2));
  const anonymous: Array<{caseId:string;arm:string;image:Buffer}> = [];
  const cases = [], began = performance.now();
  for (const c of input.cases) {
    const road = readFileSync(`eval/recognition/route-improvement/holdout/${c.area}-roads.json`);
    expect(sha(road)).toBe(c.roadHash);
    const g = graphFromOverpass(JSON.parse(road.toString()), c.bbox, { detail: "simple", excludeSteps: true });
    const [minX, minY] = project(g.origin, c.bbox.south, c.bbox.west), [maxX, maxY] = project(g.origin, c.bbox.north, c.bbox.east);
    const region = { minX, minY, maxX, maxY }, p = c.baseline.placement, shape = SHAPE_BY_ID[c.shapeId], arms = [];
    expect(c.baseline.path.map(v => [g.lat[v], g.lon[v]])).toEqual(c.baseline.latlngs);
    for (const mode of ["original", "uniform", "feature"] as const) {
      const started = performance.now(), r = (mode === "original" ? relationGuidedSearch(g, shape, p, c.baseline.path, region, { mode:"uniform", maxProposals: 192, maxExpanded: 12000 }) : semanticFeatureSearch(g, shape, p, c.baseline.path, region, { mode, maxProposals: 192, maxExpanded: 12000 }))!, elapsedMs = performance.now() - started;
      if (!r) { arms.push({level:192,mode,elapsedMs,output:null,diagnostics:null}); continue; }
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
      if(mode === "original") expect(rawSimilarity).toBeGreaterThanOrEqual(c.baseline.rawSimilarity - 1e-8);
      const latlngs: [number, number][] = nodes.map(v => [g.lat[v], g.lon[v]]);
      const output = { valid: true, rawSimilarity, placement: p, path: nodes, latlngs, nativeMeters: native, projectedMeters: projected, repeatRatio: repeated / native, projectedRepeatRatio: projectedRepeated / projected, edgeHash: sha([...edges.keys()].sort().join(",")), relation: relationDiagnostics(g, shape, p, nodes), uniformDiagnostics:semanticFeatureDiagnostics(g,shape,p,nodes,"uniform"),featureDiagnostics:semanticFeatureDiagnostics(g,shape,p,nodes,"feature") };
      arms.push({ level: 192, mode, elapsedMs, output, diagnostics: Object.fromEntries(Object.entries(r).filter(([key]) => key !== "evaluated")) });
      const line = normalizeRoadReferenceRenderLine({ id: "raw", latlngs }), d = line.map(([x, y], i) => `${i ? "L" : "M"}${(x * 400).toFixed(3)},${(y * 400).toFixed(3)}`).join(" ");
      const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="white"/><path d="${d}" fill="none" stroke="black" stroke-width="3" stroke-linejoin="round"/></svg>`)).png().toBuffer();
      anonymous.push({caseId:c.id,arm:mode,image:png});
      console.log(JSON.stringify({ id: c.id, mode, rawSimilarity, attempts: r.attempts, elapsedMs }));
    }
    cases.push({ ...c, arms });
    writeFileSync(`${out}/${c.id}.json`, JSON.stringify({ ...c, arms }, null, 2));
  }
  mkdirSync(out+"/blind",{recursive:true});
  // Stable seeded shuffle; no identities or paired montages exposed to evaluator.
  let randomState = 20261025;
  for(let i=anonymous.length-1;i>0;i--) { randomState=(Math.imul(randomState,1664525)+1013904223)>>>0; const j=randomState%(i+1); [anonymous[i],anonymous[j]]=[anonymous[j],anonymous[i]]; }
  const entries=anonymous.map((a,i)=>{ const id="Q"+String(i+1).padStart(2,"0");writeFileSync(out+"/blind/"+id+".png",a.image); return {id,caseId:a.caseId,arm:a.arm,pngHash:sha(a.image)}; });
  writeFileSync(out+"/mapping.private.json",JSON.stringify({entries},null,2));
  for (const [file, hash] of Object.entries(codeHashes)) expect(sha(readFileSync(file))).toBe(hash);
  writeFileSync(`${out}/results.json`, JSON.stringify({ spec, elapsedMs: performance.now() - began, cases }, null, 2));
}, 1800000);
