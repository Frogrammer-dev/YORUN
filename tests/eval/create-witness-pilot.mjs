import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const parent = 'tests/eval/shape-guided-product-stages-20261014.test.ts';
const source = readFileSync(parent, 'utf8');
const hash = value => createHash('sha256').update(value).digest('hex');
const parentHash = '6bd196c2c928b28d3cd7b94fb3f594bbd71b7d02890d6a0899052d0c95f1d541';
if (hash(source) !== parentHash) throw new Error('Frozen parent harness changed');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const lines = value => value.replaceAll('\n', newline);
const nativeCheck = String.raw`    const nativeCheck = (nodes: number[]) => {
      let meters = 0, repeated = 0; const used = new Set<string>();
      for (let i = 1; i < nodes.length; i++) {
        const a = nodes[i - 1], b = nodes[i]; let edge = -1;
        for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) { edge = k; break; }
        expect(edge).toBeGreaterThanOrEqual(0);
        const key = Math.min(a, b) + ':' + Math.max(a, b); meters += g.adjLen[edge];
        if (used.has(key)) repeated += g.adjLen[edge]; used.add(key);
      }
      expect(meters).toBeGreaterThanOrEqual(3000); expect(meters).toBeLessThanOrEqual(8000); expect(repeated / meters).toBeLessThanOrEqual(.2);
    };
`;
const witnessChecks = String.raw`      const witnessed = result as ReturnType<typeof shapeGuidedPortRolloutWitness>;
      expect(witnessed.params.witnessPolicy).toBe(witnessEnabled);
      expect(witnessed.diagnostics.witnessRescueTraces.length).toBeLessThanOrEqual(512);
      expect(witnessed.diagnostics.witnessCompletedLineage.length).toBeLessThanOrEqual(witnessed.diagnostics.rolloutQCalls);
      if (!witnessEnabled) { expect(witnessed.diagnostics.witnessRescueTraces).toEqual([]); expect(witnessed.diagnostics.witnessRescueAttempts).toBe(0); }
      if (!witnessEnabled && area === 'gwangalli') {
        const expectedLegacy: Record<string, [number, number]> = { 'gwangalli-square': [245, 205319], 'gwangalli-heart': [146, 176621], 'gwangalli-star': [104, 147145], 'gwangalli-cat': [230, 218728] };
        expect([witnessed.diagnostics.rolloutQCalls, witnessed.diagnostics.expansions]).toEqual(expectedLegacy[row.caseId]);
      }
      for (const [id, trace] of witnessed.diagnostics.witnessRescueTraces.entries()) {
        expect(trace.id).toBe(id); expect(trace.incoming).toBe(trace.arcPath.at(-1) ?? -1);
        if (trace.parentStateId !== null) expect(trace.stateId).toBeGreaterThan(trace.parentStateId);
        for (const competitor of trace.costCompetitors ?? []) {
          expect(competitor.incoming).toBe(trace.incoming); expect(competitor.phase).toBe(trace.phase); expect(competitor.lengthBucket).toBe(trace.lengthBucket);
        }
      }
      for (const lineage of witnessed.diagnostics.witnessCompletedLineage) {
        const p = witnessed.selectedPoses[Math.floor(lineage.unit / 2)], raw = auditor.audit(lineage.nativeNodes, p).raw;
        nativeCheck(lineage.nativeNodes); expect(raw).toBeCloseTo(lineage.raw, 8);
        const actual = lineage.goalArcPath.flatMap((id, i) => {
          expect(Number.isInteger(id) && id >= 0 && id < pg.edges.length * 2).toBe(true);
          const nodes = pg.edges[Math.floor(id / 2)].nodes, segment = id % 2 ? nodes.slice().reverse() : nodes;
          return i ? segment.slice(1) : segment.slice();
        });
        expect(pairPhaseZero(g, shape, p, actual)).toEqual(lineage.nativeNodes);
        for (const id of lineage.witnessRescueIds) {
          const trace = witnessed.diagnostics.witnessRescueTraces[id];
          expect(trace.id).toBe(id); expect(trace.unit).toBe(lineage.unit);
          expect(trace.stateId).toBeLessThanOrEqual(lineage.goalStateId);
          expect(lineage.goalArcPath.slice(0, trace.arcPath.length)).toEqual(trace.arcPath);
        }
      }
      for (const entry of witnessed.pool) {
        const arcPath = entry.provenance.goalArcPath;
        const native = arcPath.flatMap((id, i) => {
          expect(Number.isInteger(id) && id >= 0 && id < pg.edges.length * 2).toBe(true);
          const original = pg.edges[Math.floor(id / 2)].nodes;
          const segment = id % 2 ? original.slice().reverse() : original;
          return i ? segment.slice(1) : segment.slice();
        });
        nativeCheck(native);
        expect(pairPhaseZero(g, shape, entry.candidate.placement, native)).toEqual(entry.nodes);
        const outline = placeShape(shape.points, entry.candidate.placement), samples = resample(outline, Math.max(8, Math.round(polylineLength(outline) / 12)));
        let d2 = 0;
        for (const [x, y] of samples) {
          let d = Infinity;
          for (let i = 1; i < native.length; i++) d = Math.min(d, pointSegDist(x, y, g.x[native[i - 1]], g.y[native[i - 1]], g.x[native[i]], g.y[native[i]]));
          d2 += d;
        }
        expect(entry.nativeWitness.guideToRoute).toBeCloseTo(d2 / samples.length, 8);
        expect(entry.nativeWitness.featureCoverage).toBe(auditor.audit(entry.nodes, entry.candidate.placement).evaluated.featureCoverage);
        for (const id of entry.provenance.witnessRescueIds) {
          const trace = witnessed.diagnostics.witnessRescueTraces[id];
          expect(trace.id).toBe(id); expect(trace.unit).toBe(entry.provenance.unit);
          expect(trace.stateId).toBeLessThanOrEqual(entry.provenance.goalStateId);
          expect(trace.arcPath.length).toBeLessThanOrEqual(arcPath.length);
          expect(arcPath.slice(0, trace.arcPath.length)).toEqual(trace.arcPath);
        }
      }
`;
const replacements = [
  ["import { globalSearch } from '@/lib/route/globalSearch';", "import { globalSearch } from '@/lib/route/globalSearch';\nimport { shapeGuidedPortRolloutWitness } from '@/lib/route/shapeGuidedPortRolloutWitness';"],
  ["import { toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';", "import { placeShape, toCandidate, type Placement, type RouteCandidate } from '@/lib/route/fit';"],
  ["import { project } from '@/lib/route/graph';", "import { pointSegDist, project } from '@/lib/route/graph';"],
  ["import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';", "import { polylineLength, resample, SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';"],
  ["import { shapeGuidedPortRolloutBeam, SHAPE_GUIDED_ROLLOUT_PARAMS }", "import { SHAPE_GUIDED_ROLLOUT_PARAMS }"],
  ["import { shapeGuidedPortRolloutScheduled } from '@/lib/route/shapeGuidedPortRolloutScheduled';", ""],
  ["import { shapeGuidedPortRolloutContinuous } from '@/lib/route/shapeGuidedPortRolloutContinuous';", ""],
  ["import { shapeGuidedPortRolloutNoBacktrack } from '@/lib/route/shapeGuidedPortRolloutNoBacktrack';", ""],
  ["import { shapeGuidedPortRolloutAStar } from '@/lib/route/shapeGuidedPortRolloutAStar';", ""],
  ["it.skipIf(!process.env.SHAPE_GUIDED_PRODUCT_STAGES)('compares completed-road quality feedback with an identical-budget proxy control',", "it.skipIf(!process.env.SHAPE_GUIDED_WITNESS)('compares actual native outline evidence retention with the identical legacy selector and feedback caps',"],
  ["'shape-guided-rollout-product-stages-20261014'", "'shape-guided-witness-20261014'"],
  ["  const hash = (bytes: Buffer)", "  if (existsSync(out)) throw new Error('Frozen witness output already exists; never overwrite it');\n  const hash = (bytes: Buffer)"],
  ["import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';", "import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';"],
  ["  mkdirSync(out, { recursive: true });", "  mkdirSync(out, { recursive: true });"],
  ["'tests/eval/shape-guided-product-stages-20261014.test.ts'", "'tests/eval/shape-guided-witness-20261014.test.ts', 'tests/eval/create-witness-pilot.mjs', 'tests/eval/create-witness-rollout.mjs', 'src/lib/route/shapeGuidedPortRolloutWitness.ts', 'src/lib/route/nativeGuideWitness.ts'"],
  ["  const rows = input.cases.filter(row => row.caseId.startsWith(`${area}-`)); expect(rows).toHaveLength(4);", "  const rows = input.cases.filter(row => row.caseId.startsWith(`${area}-`)); expect(rows).toHaveLength(4);\n  expect(new Set(rows.map(row => row.caseId))).toEqual(new Set(['square', 'heart', 'star', 'cat'].map(id => `${area}-${id}`)));\n  const fixedBoxes: Record<string, BBox> = { gwangalli: { south: 35.143, west: 129.100, north: 35.166, east: 129.128 }, seomyeon: { south: 35.145, west: 129.048, north: 35.170, east: 129.076 }, gangnam: { south: 37.490, west: 127.020, north: 37.515, east: 127.051 } };\n  for (const row of rows) expect(row.bbox).toEqual(fixedBoxes[area]);"],
  ["schedule: productBound ? 'road-product-stage-caps'", "witnessArms: ['legacy-cost-hash-with-observation', 'native-outline-witness'], feedbackEnabledInBothArms: true, witnessLineageVerifiedWithActualGoalArcPrefixes: true, allRescuedQLineageAudited: true, returnedTop16NativeAudited: true, legacyGwangalliCountersRequired: true, schedule: productBound ? 'actual-native-outline-witness'"],
  ["    type Scored =", nativeCheck + "    type Scored ="],
  ["const scored = (nodes: number[], placement: Placement): Scored => { const a =", "const scored = (nodes: number[], placement: Placement): Scored => { nativeCheck(nodes); const a ="],
  ["    for (const feedback of [false, true]) {", "    for (const witnessEnabled of [false, true]) {\n      const feedback = true;"],
  ["const name = feedback ? 'feedback' : 'control';", "const name = witnessEnabled ? 'witness' : 'control';"],
  ["const search = productBound ? shapeGuidedPortRolloutProductStages : astar ? shapeGuidedPortRolloutAStar : noBacktrack ? shapeGuidedPortRolloutNoBacktrack : continuous ? shapeGuidedPortRolloutContinuous : scheduled ? shapeGuidedPortRolloutScheduled : shapeGuidedPortRolloutBeam;", "const search = (...args: Parameters<typeof shapeGuidedPortRolloutProductStages>) => shapeGuidedPortRolloutWitness(...args, witnessEnabled);"],
  ["      const candidates: Scored[] = [];", witnessChecks + "      const candidates: Scored[] = [];"],
  ["const arm = { name, feedback,", "const arm = { name, feedback, witnessEnabled,"],
  ["name: i ? 'feedback' : 'control'", "name: i ? 'witness' : 'control'"],
];
let output = source;
for (const [before, after] of replacements) {
  const a = lines(before), b = lines(after);
  if (a === b) continue;
  if (output.split(a).length !== 2) throw new Error('Expected one anchor: ' + before);
  output = output.replace(a, b);
}
// The no-overwrite check must run before creating the folder.
const created = '  mkdirSync(out, { recursive: true });' + newline;
const noOverwrite = "  if (existsSync(out)) throw new Error('Frozen witness output already exists; never overwrite it');" + newline;
output = output.replace(created, '').replace(noOverwrite, noOverwrite + created);
const target = 'tests/eval/shape-guided-witness-20261014.test.ts';
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== output) throw new Error('Witness pilot differs from its controlled generator');
  console.log(JSON.stringify({ parent, parentHash, target, targetHash: hash(output), checkOnly: true }));
} else {
if (existsSync('eval/recognition/route-improvement/shape-guided-witness-20261014')) throw new Error('Never alter a harness with execution artifacts');
writeFileSync(target, output);
console.log(JSON.stringify({ parent, parentHash, target, targetHash: hash(output), fieldRunStarted: false }));
}
