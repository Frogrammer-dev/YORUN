import { describe, expect, it } from 'vitest';
import { evaluatePath, type Placement } from '@/lib/route/fit';
import { buildGraph, hasEdge, makeOrigin, unproject, type RawEdge } from '@/lib/route/graph';
import { pairEdgeKey, pairPhaseZero, pairSegmentRepair } from '@/lib/route/pairSegmentRepair';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

// Two actual alternative roads: a protruding top road adds exactly as much
// distance as a diagonal corner road removes. Each isolated correction violates
// the distance range; correcting both restores the original square perimeter.
function fixture() {
  const origin = makeOrigin(37, 127), xy: [number, number][] = [], edges: RawEdge[] = [], ids = new Map<string, number>();
  const node = (x: number, y: number) => {
    const key = `${x}:${y}`;
    if (!ids.has(key)) { ids.set(key, xy.length); xy.push([x, y]); }
    return ids.get(key)!;
  };
  const road = (points: [number, number][]) => {
    const path = points.map(([x, y]) => node(x, y));
    for (let i = 1; i < path.length; i++) edges.push({ a: path[i - 1], b: path[i], factor: 1 });
    return path;
  };
  const bottom = road(Array.from({ length: 11 }, (_, i) => [i * 100, 0]));
  const right = road(Array.from({ length: 11 }, (_, i) => [1000, i * 100]));
  const top = road(Array.from({ length: 11 }, (_, i) => [1000 - i * 100, 1000]));
  const left = road(Array.from({ length: 11 }, (_, i) => [0, 1000 - i * 100]));
  const height = (400 - Math.hypot(200, 200)) / 2;
  const protrusion = road([[600, 1000], [600, 1000 + height], [500, 1000 + height], [400, 1000 + height], [400, 1000]]);
  const cornerCut = road([[800, 0], [1000, 200]]);
  const join = (...parts: number[][]) => parts.flatMap((part, i) => i ? part.slice(1) : part);
  const exact = join(bottom, right, top, left);
  const cutBottomRight = join(bottom.slice(0, 9), cornerCut, right.slice(2));
  const longTop = join(top.slice(0, 5), protrusion, top.slice(6));
  const input = join(cutBottomRight, longTop, left);
  const singleShort = join(cutBottomRight, top, left);
  const singleLong = join(bottom, right, longTop, left);
  const latlngs = xy.map(([x, y]) => unproject(origin, x, y));
  const g = buildGraph(origin, latlngs.map(p => p[0]), latlngs.map(p => p[1]), edges, 'fixture');
  const placement: Placement = { cx: 500, cy: 500, scale: 1000, rotDeg: 0 };
  const region = { minX: -10, minY: -10, maxX: 1010, maxY: 1100 };
  return { g, input, singleShort, singleLong, exact, placement, region };
}

describe('joint segment contracts on existing roads', () => {
  it('finds the jointly valid correction when each individual correction violates distance', () => {
    const { g, input, singleShort, singleLong, exact, placement, region } = fixture();
    const shape = SHAPE_BY_ID.square, min = 3999, max = 4001;
    const evaluate = (nodes: number[]) => evaluatePath(g, shape, placement, nodes, min, max);
    expect(evaluate(input).lengthMeters).toBeGreaterThan(min);
    expect(evaluate(input).lengthMeters).toBeLessThan(max);
    expect(evaluate(singleShort).lengthMeters).toBeLessThan(min);
    expect(evaluate(singleLong).lengthMeters).toBeGreaterThan(max);
    expect(evaluate(exact).similarity).toBe(100);
    const result = pairSegmentRepair(g, shape, placement, input, region, { maxAlternatives: 64, maxRoutingAttempts: 128, maxPairs: 512, maxExpanded: 2000 }, min, max);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('pair');
    expect(result!.selectedPair?.bothSinglesNonImproving).toBe(true);
    expect(result!.selectedPair?.betterThanBestSingle).toBe(true);
    expect(result!.alternatives[result!.selectedPair!.a].singleValid).toBe(false);
    expect(result!.alternatives[result!.selectedPair!.b].singleValid).toBe(false);
    expect(result!.evaluated.similarity).toBeGreaterThan(evaluate(input).similarity);
    expect(result!.evaluated.lengthMeters).toBeGreaterThanOrEqual(min);
    expect(result!.evaluated.lengthMeters).toBeLessThanOrEqual(max);
    expect(result!.evaluated.path.slice(1).every((v, i) => hasEdge(g, result!.evaluated.path[i], v))).toBe(true);
    expect(pairEdgeKey(result!.evaluated.path)).not.toBe(pairEdgeKey(input));
    expect(pairEdgeKey(result!.evaluated.path)).toBe(pairEdgeKey(exact));
    expect(result!.afterRaw).toBeGreaterThan(Math.max(result!.inputRaw, result!.phaseZeroInputRaw));
  });

  it('does not report geometric improvement for a new start or reversed traversal of the same roads', () => {
    const { g, exact, placement, region } = fixture(), shape = SHAPE_BY_ID.square;
    const loop = exact.slice(0, -1), shifted = [...loop.slice(7), ...loop.slice(0, 7)]; shifted.push(shifted[0]);
    const reversed = [...shifted].reverse();
    expect(pairEdgeKey(exact)).toBe(pairEdgeKey(reversed));
    expect(pairPhaseZero(g, shape, placement, reversed)).toEqual(pairPhaseZero(g, shape, placement, exact));
    const result = pairSegmentRepair(g, shape, placement, reversed, region, { maxAlternatives: 32, maxRoutingAttempts: 64, maxPairs: 128, maxExpanded: 2000 }, 3999, 4001);
    expect(result!.geometryImprovement).toBe(false);
    expect(result!.kind).toBe('input');
    expect(result!.evaluated.path).toEqual(reversed);
    expect(result!.afterRaw).toBe(result!.inputRaw);
  });
});
