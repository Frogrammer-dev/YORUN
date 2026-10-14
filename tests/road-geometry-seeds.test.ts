import { expect, it } from 'vitest';
import { placeShape } from '@/lib/route/fit';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { roadGeometrySeeds } from '@/lib/route/roadGeometrySeeds';
import { roadGeometryCycles } from '@/lib/route/roadGeometryCycles';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

it('proposes deterministic uniform placements from a connected synthetic road grid', () => {
  const origin = makeOrigin(35, 129), lat: number[] = [], lon: number[] = [], edges: Array<{ a: number; b: number; factor: number }> = [];
  for (let y = 0; y <= 12; y++) for (let x = 0; x <= 12; x++) {
    const ll = unproject(origin, x * 100, y * 100); lat.push(ll[0]); lon.push(ll[1]);
    const n = y * 13 + x; if (x) edges.push({ a: n - 1, b: n, factor: 1 }); if (y) edges.push({ a: n - 13, b: n, factor: 1 });
  }
  const g = buildGraph(origin, lat, lon, edges, null), region = { minX: -1, minY: -1, maxX: 1201, maxY: 1201 };
  const a = roadGeometrySeeds(g, SHAPE_BY_ID.square, region), b = roadGeometrySeeds(g, SHAPE_BY_ID.square, region);
  expect(a).toEqual(b); expect(a.seeds.length).toBeGreaterThan(0); expect(a.seeds.length).toBeLessThanOrEqual(48);
  for (const s of a.seeds) {
    expect(s.supports).toHaveLength(4);
    expect(placeShape(SHAPE_BY_ID.square.points, s.placement).every(([x, y]) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY)).toBe(true);
  }
  const cycles = roadGeometryCycles(g, a); expect(cycles.candidates.length).toBeGreaterThan(0); expect(cycles.candidates.length).toBeLessThanOrEqual(48);
  for (const { nodes } of cycles.candidates) expect(nodes[0]).toBe(nodes.at(-1));
});
