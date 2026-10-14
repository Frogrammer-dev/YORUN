import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { DistanceField, routePlacement, type Placement } from '@/lib/route/fit';
import { globalSearch } from '@/lib/route/globalSearch';
import { globalSearchAllPoseSeeds, poseScaleDiversityMetadata, selectPoseScaleDiversity } from '@/lib/route/globalSearchAllPoseSeeds';
import { project } from '@/lib/route/graph';
import { graphFromOverpass } from '@/lib/route/osm';
import { SHAPE_BY_ID } from '@/lib/route/shapes';

vi.mock('@/lib/route/fit', async () => {
  const original = await vi.importActual<typeof import('@/lib/route/fit')>('@/lib/route/fit');
  return { ...original, routePlacement: vi.fn(() => { throw new Error('Coarse-only diagnostic attempted actual routing'); }) };
});

it('restores the entire frozen original body by undoing only export name and catalog truncation', () => {
  const bytes = readFileSync('src/lib/route/globalSearch.ts'), source = bytes.toString(), clone = readFileSync('src/lib/route/globalSearchAllPoseSeeds.ts', 'utf8');
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308');
  const restored = clone.slice(0, clone.indexOf('\n/* ALL_POSE_SCALE_DIVERSITY_HELPER */\n')).replace('export function globalSearchAllPoseSeeds(', 'export function globalSearch(').replace('placementSeeds:seeds.map(s=>s.p)', 'placementSeeds:seeds.slice(0,48).map(s=>s.p)');
  expect(restored).toBe(source);
});

it('retains all ordered native coarse seeds with the identical first48 and no route evaluation', () => {
  vi.clearAllMocks();
  const roadBytes = readFileSync('eval/recognition/llm-routes-20261010/gwangalli-roads.json');
  expect(createHash('sha256').update(roadBytes).digest('hex')).toBe('e31aa49adb02b6ec5e74759ad5fb3b2111084013df6ff48391ebd88d42ddf828');
  const bbox = { south: 35.143, west: 129.100, north: 35.166, east: 129.128 };
  const g = graphFromOverpass(JSON.parse(roadBytes.toString()), bbox, { detail: 'simple', excludeSteps: true });
  const [minX, minY] = project(g.origin, bbox.south, bbox.west), [maxX, maxY] = project(g.origin, bbox.north, bbox.east), region = { minX, minY, maxX, maxY }, shape = SHAPE_BY_ID.square;
  const field = new DistanceField(g, region, 12), original = globalSearch(g, shape, region, 0, true, true, { distanceField: field }), all = globalSearchAllPoseSeeds(g, shape, region, 0, true, true, { distanceField: field });
  expect(original.evaluated).toBe(0); expect(all.evaluated).toBe(0); expect(all.pool).toEqual([]); expect(all.candidate).toBeNull();
  expect(all.coarseSeeds).toBe(original.coarseSeeds); expect(all.placementSeeds.length).toBe(all.coarseSeeds); expect(all.coarseSeeds).toBeGreaterThan(48);
  expect(all.placementSeeds.slice(0, 48)).toEqual(original.placementSeeds); expect(routePlacement).not.toHaveBeenCalled();
  const metadata = poseScaleDiversityMetadata(all.placementSeeds, region, shape), selected = selectPoseScaleDiversity(all.placementSeeds, region, shape);
  expect(metadata.scaleValues).toHaveLength(8); expect(metadata.entries.map(e => e.pose)).toEqual(all.placementSeeds);
  expect(metadata.entries.map(e => e.rank)).toEqual(all.placementSeeds.map((_, i) => i)); expect(selected).toHaveLength(8);
  expect(new Set(selected.slice(0, 4).map(p => metadata.entries.find(e => e.pose === p)!.scaleTier))).toEqual(new Set([0, 1, 2, 3]));
  for (const p of selected) expect(all.placementSeeds.includes(p)).toBe(true);
  console.log(JSON.stringify({ diagnostic: 'native-coarse-only-full-catalog', catalogCount: all.coarseSeeds, originalReturned: original.placementSeeds.length, scaleCount: metadata.scaleValues.length, selectedScales: selected.map(p => p.scale), first48Identical: true, routingCalls: vi.mocked(routePlacement).mock.calls.length, qualityGainClaim: false }));
}, 120000);

it('covers scale tiers before rank fill and preserves every original pose object and polygon', () => {
  const region = { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 }, seeds: Placement[] = [];
  for (let scale = 100; scale < 108; scale++) for (let center = 0; center < 8; center++) for (const rotDeg of [0, 90, 180, 270]) seeds.push({ cx: center * 20, cy: 0, scale, rotDeg });
  const before = JSON.stringify(seeds), metadata = poseScaleDiversityMetadata(seeds, region, SHAPE_BY_ID.square), selected = selectPoseScaleDiversity(seeds, region, SHAPE_BY_ID.square);
  expect(selected).toHaveLength(8); expect(JSON.stringify(seeds)).toBe(before); expect(metadata.symmetryDegrees).toBe(90);
  expect(new Set(selected.slice(0, 4).map(p => metadata.entries.find(e => e.pose === p)!.scaleTier))).toEqual(new Set([0, 1, 2, 3]));
  for (const p of selected) expect(seeds.includes(p)).toBe(true);
  expect(new Set(metadata.entries.slice(0, 4).map(e => e.outlineOrbit)).size).toBe(1);
});

it('retains distinct original phase variants as fallback when physical outline diversity is exhausted', () => {
  const region = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 }, seeds = [0, 90, 180, 270].map(rotDeg => ({ cx: 0, cy: 0, scale: 200, rotDeg }));
  expect(selectPoseScaleDiversity(seeds, region, SHAPE_BY_ID.square)).toEqual(seeds);
  expect(poseScaleDiversityMetadata(seeds, region, SHAPE_BY_ID.star).symmetryDegrees).toBe(72);
});
