import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scaleInterleavedSeeds } from '@/lib/route/globalSearchScaleInterleaved';

describe('scale-tier coarse routing order', () => {
  it('round-robins four size tiers without changing within-tier rank or any original pose', () => {
    const ranked = Array.from({ length: 8 }, (_, scale) => Array.from({ length: 4 }, (_, rank) => ({ p: { cx: rank, cy: 0, scale: 100 + scale, rotDeg: 0 }, score: scale * 4 + rank }))).flat();
    const before = JSON.stringify(ranked), output = scaleInterleavedSeeds(ranked);
    expect(output).toHaveLength(ranked.length);
    expect(new Set(output).size).toBe(ranked.length);
    expect(output.slice(0, 4).map(entry => entry.p.scale)).toEqual([100, 102, 104, 106]);
    for (let tier = 0; tier < 4; tier++) {
      const inTier = (entry: typeof ranked[number]) => Math.floor((entry.p.scale - 100) / 2) === tier;
      expect(output.filter(inTier)).toEqual(ranked.filter(inTier));
    }
    expect(JSON.stringify(ranked)).toBe(before);
    output.forEach(entry => expect(ranked.includes(entry)).toBe(true));
  });

  it('skips empty and exhausted tiers while preserving every entry exactly once', () => {
    expect(scaleInterleavedSeeds([])).toEqual([]);
    const small = { p: { cx: 0, cy: 0, scale: 100, rotDeg: 0 }, score: 0 };
    const large = Array.from({ length: 5 }, (_, i) => ({ p: { cx: i, cy: 0, scale: 200, rotDeg: 0 }, score: i + 1 }));
    expect(scaleInterleavedSeeds([small, ...large])).toEqual([small, ...large]);
    expect(scaleInterleavedSeeds(large)).toEqual(large);
  });

  it('restores the exact original source by undoing only the name and seed-order change', () => {
    const original = readFileSync('src/lib/route/globalSearch.ts', 'utf8');
    const clone = readFileSync('src/lib/route/globalSearchScaleInterleaved.ts', 'utf8');
    const restored = clone.slice(0, clone.indexOf('\n/* SCALE_INTERLEAVED_GLOBAL_HELPER */\n'))
      .replace('export function globalSearchScaleInterleaved(', 'export function globalSearch(')
      .replace('const seeds=scaleInterleavedSeeds([...buckets.values()].flat().sort((a,b)=>a.score-b.score));', 'const seeds=[...buckets.values()].flat().sort((a,b)=>a.score-b.score);');
    expect(restored).toBe(original);
  });
});
