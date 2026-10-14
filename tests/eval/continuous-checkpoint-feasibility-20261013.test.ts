import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import type { RouteCandidate } from '@/lib/route/fit';
import { project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { pairPhaseZero } from '@/lib/route/pairSegmentRepair';
import { segmentRadiusInterval } from '@/lib/route/segmentRadiusInterval';
import { rolloutGuide } from '@/lib/route/shapeGuidedPortRolloutBeam';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { rolloutPathAuditor } from './rollout-pilot-support';

it.skipIf(!process.env.CONTINUOUS_CHECKPOINT_FEASIBILITY)('checks fixed automatic paths against ordered checkpoint intervals without searching or changing the evaluator', () => {
  const out = path.resolve('eval/recognition/route-improvement/continuous-checkpoint-feasibility-20261013'); mkdirSync(out, { recursive: true });
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex'), inputBytes = readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json');
  const input = JSON.parse(inputBytes.toString()) as { cases: Array<{ caseId: string; bbox: BBox; candidate: RouteCandidate; sourceHash: string }> };
  const files = ['tests/eval/continuous-checkpoint-feasibility-20261013.test.ts', 'tests/eval/rollout-pilot-support.ts', 'src/lib/route/segmentRadiusInterval.ts', 'src/lib/route/shapeGuidedPortRolloutBeam.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts', 'src/lib/route/pairSegmentRepair.ts'];
  const codeHashes = Object.fromEntries(files.map(file => { const bytes = readFileSync(file); writeFileSync(path.join(out, `${path.basename(file)}.source`), bytes); return [file, hash(bytes)]; }));
  const protocol = { inputHash: hash(inputBytes), codeHashes, radiusFraction: .16, denominator: 12, fixedAutomaticPathsOnly: true, noSearchOrQualityGainClaim: true, checkpointFeasibilityOnlyNotFullFrechet: true, physicalPathEndpointsFixed: true, noHoldoutRead: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const cases = [];
  for (const row of input.cases) {
    const area = row.caseId.split('-')[0], roadBytes = readFileSync(`eval/recognition/llm-routes-20261010/${area}-roads.json`); expect(hash(roadBytes)).toBe(row.sourceHash);
    const g = graphFromOverpass(JSON.parse(roadBytes.toString()), row.bbox, { detail: 'simple', excludeSteps: true });
    const [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY };
    const shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], auditor = rolloutPathAuditor(g, shape, region), original = auditor.nodesFor(row.candidate);
    auditor.audit(original, row.candidate.placement);
    const nodes = pairPhaseZero(g, shape, row.candidate.placement, original), guide = rolloutGuide(shape, row.candidate.placement), radius = .16 * row.candidate.placement.scale;
    const distance = (v: number, p: readonly [number, number]) => Math.hypot(g.x[v] - p[0], g.y[v] - p[1]);
    let edge = 0, t = 0, failedCheckpoint: number | null = null;
    const correspondences: Array<{ checkpoint: number; actualEdgeIndex: number; t: number }> = [];
    const endpointsInRadius = distance(nodes[0], guide[0]) <= radius && distance(nodes.at(-1)!, guide.at(-1)!) <= radius;
    if (endpointsInRadius) {
      correspondences.push({ checkpoint: 0, actualEdgeIndex: 0, t: 0 });
      for (let k = 1; k < guide.length - 1; k++) {
        let found = false;
        while (edge < nodes.length - 1) {
          const a = nodes[edge], b = nodes[edge + 1], interval = segmentRadiusInterval([g.x[a], g.y[a]], [g.x[b], g.y[b]], guide[k], radius);
          if (interval && Math.max(t, interval[0]) <= interval[1]) { t = Math.max(t, interval[0]); correspondences.push({ checkpoint: k, actualEdgeIndex: edge, t }); found = true; break; }
          edge++; t = 0;
        }
        if (!found) { failedCheckpoint = k; break; }
      }
      if (failedCheckpoint === null) correspondences.push({ checkpoint: guide.length - 1, actualEdgeIndex: nodes.length - 2, t: 1 });
    }
    for (let i = 1; i < correspondences.length; i++) { const a = correspondences[i - 1], b = correspondences[i]; expect(b.actualEdgeIndex + b.t).toBeGreaterThanOrEqual(a.actualEdgeIndex + a.t); }
    cases.push({ caseId: row.caseId, nativeSimilarity: row.candidate.similarity, guideCheckpoints: guide.length, actualNodeCount: nodes.length, endpointsInRadius, orderedCheckpointsFeasible: endpointsInRadius && failedCheckpoint === null, failedCheckpoint, correspondences });
  }
  expect(cases).toHaveLength(12); for (const file of files) expect(hash(readFileSync(file))).toBe(codeHashes[file]);
  const summary = { cases: 12, orderedCheckpointsFeasible: cases.filter(c => c.orderedCheckpointsFeasible).length, infeasible: cases.filter(c => !c.orderedCheckpointsFeasible).map(c => c.caseId) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 300000);
