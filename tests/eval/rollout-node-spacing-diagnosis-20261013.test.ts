import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { evaluatePath } from '@/lib/route/fit';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { shapeGuidedPortRolloutScheduled } from '@/lib/route/shapeGuidedPortRolloutScheduled';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it.skipIf(!process.env.ROLLOUT_NODE_SPACING)('isolates node spacing on an identical perfect square geometry without claiming benchmark quality', () => {
  const out = path.resolve('eval/recognition/route-improvement/rollout-node-spacing-20261013'); mkdirSync(out, { recursive: true });
  const files = ['src/lib/route/shapeGuidedPortRolloutScheduled.ts', 'src/lib/route/exactRoadPortGraph.ts', 'src/lib/route/fit.ts', 'src/lib/route/shapes.ts', 'tests/eval/rollout-node-spacing-diagnosis-20261013.test.ts'];
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const codeHashes = Object.fromEntries(files.map(file => { const bytes = readFileSync(file); writeFileSync(path.join(out, `${path.basename(file)}.source`), bytes); return [file, hash(bytes)]; }));
  const protocol = { codeHashes, syntheticGeometryOnly: true, originalScore: true, noBenchmarkGainClaim: true, noHoldoutRead: true, sameSquareGeometry: true, maximumUnitBudgetUnchanged: 25000 };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const origin = makeOrigin(35, 129), region = { minX: -1, minY: -1, maxX: 801, maxY: 801 }, p = { cx: 400, cy: 400, scale: 800, rotDeg: 0 }, cases = [];
  for (const segmentsPerSide of [1, 8]) {
    const xy: Array<[number, number]> = [];
    for (let side = 0; side < 4; side++) for (let i = 0; i < segmentsPerSide; i++) { const d = 800 * i / segmentsPerSide; xy.push(side === 0 ? [d, 0] : side === 1 ? [800, d] : side === 2 ? [800 - d, 800] : [0, 800 - d]); }
    const ll = xy.map(([x, y]) => unproject(origin, x, y)), g = buildGraph(origin, ll.map(c => c[0]), ll.map(c => c[1]), xy.map((_, i) => ({ a: i, b: (i + 1) % xy.length, factor: 1 })), null);
    const nodes = [...xy.map((_, i) => i), 0], evaluation = evaluatePath(g, SHAPE_BY_ID.square, p, nodes, 3000, 8000);
    expect(evaluation.similarity).toBe(100); expect(evaluation.repeatRatio).toBe(0); expect(evaluation.lengthMeters).toBeCloseTo(3200, 1);
    const began = Date.now(), result = shapeGuidedPortRolloutScheduled(g, exactRoadPortGraph(g, region), SHAPE_BY_ID.square, region, [p], false);
    cases.push({ segmentsPerSide, evaluation, diagnostics: result.diagnostics, pool: result.pool, elapsedMs: Date.now() - began });
  }
  expect(cases[0].diagnostics.strictRollouts).toBe(0); expect(cases[1].diagnostics.strictRollouts).toBeGreaterThan(0);
  for (const file of files) expect(hash(readFileSync(file))).toBe(codeHashes[file]);
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, cases }, null, 2));
}, 300000);
