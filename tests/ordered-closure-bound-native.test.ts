import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { exactRoadPortGraph } from '@/lib/route/exactRoadPortGraph';
import { createOrderedClosureBound } from '@/lib/route/orderedClosureBound';

it('keeps the ordered suffix bound below native length when native/projected distance is one half', () => {
  const sourcePath = 'src/lib/route/shapeGuidedPortRolloutNoBacktrack.ts';
  const protocol = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-no-backtrack-20261014/gwangalli/protocol-before-run.json', 'utf8'));
  const originalSource = readFileSync(sourcePath);
  expect(createHash('sha256').update(originalSource).digest('hex')).toBe(protocol.codeHashes[sourcePath]);

  const origin = makeOrigin(35, 129);
  const xy: Array<[number, number]> = [[0, 0], [800, 0], [800, 800], [0, 800]];
  const latlngs = xy.map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, latlngs.map(v => v[0]), latlngs.map(v => v[1]), xy.map((_, i) => ({ a: i, b: (i + 1) % 4, factor: 1 })), null);
  // This deliberately shortened native length belongs only to this synthetic graph.
  // Frozen benchmark graphs and their source files are never mutated.
  for (let edge = 0; edge < g.adjLen.length; edge++) g.adjLen[edge] *= .5;
  const pg = exactRoadPortGraph(g, { minX: -1, minY: -1, maxX: 801, maxY: 801 });
  const guide: Array<[number, number]> = [0, 1, 2, 3, 0].map(node => [g.x[node], g.y[node]]);
  const bound = createOrderedClosureBound(g, pg, guide, 0, 0);
  const nativeLength = (nodes: number[]) => {
    let meters = 0;
    for (let i = 1; i < nodes.length; i++) {
      const from = nodes[i - 1], to = nodes[i];
      let native = -1;
      for (let edge = g.adjStart[from]; edge < g.adjStart[from + 1]; edge++) if (g.adjTo[edge] === to) { native = g.adjLen[edge]; break; }
      expect(native).toBeGreaterThanOrEqual(0);
      meters += native;
    }
    return meters;
  };

  expect(bound.gamma).toBeCloseTo(.5, 7);
  for (let phase = 0; phase <= 4; phase++) {
    const suffix = [0, 1, 2, 3, 0].slice(phase);
    expect(bound.estimate(suffix[0], phase)).toBeLessThanOrEqual(nativeLength(suffix));
    expect(bound.estimate(suffix[0], phase)).toBeCloseTo((4 - phase) * 400, 3);
  }
  // The final phase only requires returning to the start, not another tour.
  expect(bound.estimate(1, 4)).toBeLessThanOrEqual(nativeLength([1, 0]));
  expect(bound.estimate(1, 4)).toBeCloseTo(400, 3);
  expect(readFileSync(sourcePath).equals(originalSource)).toBe(true);
});
