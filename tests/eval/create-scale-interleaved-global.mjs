import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'src/lib/route/globalSearch.ts';
const frozenHash = '8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308';
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(bytes) !== frozenHash) throw new Error('Original global search source changed');
const replacements = [
  ['export function globalSearch(', 'export function globalSearchScaleInterleaved('],
  ['const seeds=[...buckets.values()].flat().sort((a,b)=>a.score-b.score);', 'const seeds=scaleInterleavedSeeds([...buckets.values()].flat().sort((a,b)=>a.score-b.score));'],
];
let body = source;
for (const [before, after] of replacements) {
  if (body.split(before).length !== 2) throw new Error('Expected one anchor: ' + before);
  body = body.replace(before, after);
}
const marker = '\n/* SCALE_INTERLEAVED_GLOBAL_HELPER */\n';
const helper = String.raw`export const SCALE_INTERLEAVED_GLOBAL_PARAMS = { scaleTiers: 4, basis: 'distinct-original-scale-percentile-rank', order: 'tier-rank-round-robin', emptyTiersSkipped: true, exhaustedTiersSkipped: true, coarseScoreUnchanged: true, originalPosesOnly: true, templateAndQUnchanged: true } as const;

/** Reorders original coarse entries only; this creates no route, pose or score. */
export function scaleInterleavedSeeds<T extends { p: Placement; score: number }>(ranked: readonly T[]): T[] {
  const scales = [...new Set(ranked.map(entry => entry.p.scale))].sort((a, b) => a - b);
  const tiers = Array.from({ length: 4 }, () => [] as T[]);
  for (const entry of ranked) {
    const tier = Math.min(3, Math.floor(4 * scales.indexOf(entry.p.scale) / Math.max(1, scales.length)));
    tiers[tier].push(entry);
  }
  const result: T[] = [];
  for (let rank = 0; result.length < ranked.length; rank++) {
    for (const tier of tiers) if (rank < tier.length) result.push(tier[rank]);
  }
  return result;
}
`;
const output = body + marker + helper;
let restored = output.slice(0, output.indexOf(marker));
for (const [before, after] of replacements.slice().reverse()) restored = restored.replace(after, before);
if (sha(Buffer.from(restored)) !== frozenHash || restored !== source) throw new Error('Inverse source identity failed');
const target = 'src/lib/route/globalSearchScaleInterleaved.ts';
if (existsSync(target) && readFileSync(target, 'utf8') !== output) throw new Error('Refusing to overwrite different experiment');
writeFileSync(target, output);
console.log(JSON.stringify({ sourcePath, frozenHash, target, targetHash: sha(Buffer.from(output)), inverseIdentity: true, changes: ['export-name', 'original-coarse-order-across-four-scale-tiers'], originalSearchBodyPreserved: true }));
