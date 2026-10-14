import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'src/lib/route/globalSearch.ts';
const frozenHash = '8d2ccd481557ab8e32074df47cd53a75a436980b420bd2fc589ad7137f321308';
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8');
const sha = value => createHash('sha256').update(value).digest('hex');
if (sha(bytes) !== frozenHash) throw new Error('Frozen original globalSearch source changed');
const replacements = [
  ['export function globalSearch(', 'export function globalSearchAllPoseSeeds('],
  ['placementSeeds:seeds.slice(0,48).map(s=>s.p)', 'placementSeeds:seeds.map(s=>s.p)'],
];
let body = source;
for (const [before, after] of replacements) {
  if (body.split(before).length !== 2) throw new Error('Expected one source anchor: ' + before);
  body = body.replace(before, after);
}
const marker = '\n/* ALL_POSE_SCALE_DIVERSITY_HELPER */\n';
const helper = String.raw`export const ALL_POSE_SELECTION_PARAMS = { scaleTiers: 4, tierBasis: 'distinct-original-scale-percentile-rank', firstPass: 'coarse-best-one-per-tier', fill: 'space-then-symmetry-angle-then-original-rank', originalPosesOnly: true, outlineToleranceMeters: .000001, qualityLabelsUsed: false } as const;

export interface PoseScaleDiversityEntry { pose: Placement; rank: number; scaleTier: number; spaceKey: string; angleKey: number; outlineOrbit: string; }

/** Rotational symmetry around the polygon centroid; no new placement is created. */
function originalPolygonRotationPeriod(shape: ShapeDef) {
  const ps = shape.points.slice(0, -1), n = ps.length;
  if (!n) return 360;
  const cx = ps.reduce((s, p) => s + p[0], 0) / n, cy = ps.reduce((s, p) => s + p[1], 0) / n;
  for (let offset = 1; offset < n; offset++) {
    const radians = 2 * Math.PI * offset / n, c = Math.cos(radians), s = Math.sin(radians);
    if (ps.every(([x, y], i) => { const q = ps[(i + offset) % n]; return Math.hypot((x - cx) * c - (y - cy) * s - (q[0] - cx), (x - cx) * s + (y - cy) * c - (q[1] - cy)) < 1e-8; })) return 360 * offset / n;
  }
  return 360;
}

/** Same physical polygon under a cyclic seam; keep phase variants in the catalog. */
function outlineOrbit(shape: ShapeDef, pose: Placement) {
  const points = placeShape(shape.points, pose).slice(0, -1).map(([x, y]) => Math.round(x * 1e6) + ',' + Math.round(y * 1e6));
  if (!points.length) return '';
  return points.map((_, i) => [...points.slice(i), ...points.slice(0, i)].join(';')).sort()[0];
}

/** Metadata retains every catalog item and its original coarse rank exactly. */
export function poseScaleDiversityMetadata(seeds: readonly Placement[], region: Region, shape: ShapeDef) {
  const scaleValues = [...new Set(seeds.map(p => p.scale))].sort((a, b) => a - b), symmetryDegrees = originalPolygonRotationPeriod(shape);
  const entries: PoseScaleDiversityEntry[] = seeds.map((pose, rank) => {
    const x = Math.min(1, Math.max(0, Math.floor(2 * (pose.cx - region.minX) / Math.max(1e-9, region.maxX - region.minX))));
    const y = Math.min(1, Math.max(0, Math.floor(2 * (pose.cy - region.minY) / Math.max(1e-9, region.maxY - region.minY))));
    const normalizedAngle = ((pose.rotDeg % symmetryDegrees) + symmetryDegrees) % symmetryDegrees;
    return { pose, rank, scaleTier: Math.min(3, Math.floor(4 * scaleValues.indexOf(pose.scale) / Math.max(1, scaleValues.length))), spaceKey: x + ':' + y, angleKey: Math.min(3, Math.floor(4 * normalizedAngle / symmetryDegrees)), outlineOrbit: outlineOrbit(shape, pose) };
  });
  return { scaleValues, symmetryDegrees, entries };
}

/** Four scale tiers first, then spatial/angle coverage, always original poses. */
export function selectPoseScaleDiversity(seeds: readonly Placement[], region: Region, shape: ShapeDef, limit = 8): Placement[] {
  const { entries } = poseScaleDiversityMetadata(seeds, region, shape), selected: PoseScaleDiversityEntry[] = [], identities = new Set<string>(), orbits = new Set<string>(), spaces = new Set<string>(), angles = new Set<number>();
  const take = (entry: PoseScaleDiversityEntry) => {
    const p = entry.pose, identity = [p.cx, p.cy, p.scale, p.rotDeg].join(':');
    if (selected.length >= limit || identities.has(identity)) return;
    selected.push(entry); identities.add(identity); orbits.add(entry.outlineOrbit); spaces.add(entry.spaceKey); angles.add(entry.angleKey);
  };
  const tierBests = [0, 1, 2, 3].map(tier => entries.find(entry => entry.scaleTier === tier)).filter((entry): entry is PoseScaleDiversityEntry => !!entry).sort((a, b) => a.rank - b.rank);
  tierBests.forEach(take);
  for (const entry of entries) if (!spaces.has(entry.spaceKey) && !orbits.has(entry.outlineOrbit)) take(entry);
  for (const entry of entries) if (!angles.has(entry.angleKey) && !orbits.has(entry.outlineOrbit)) take(entry);
  for (const entry of entries) if (!orbits.has(entry.outlineOrbit)) take(entry);
  // A symmetric orbit can still provide distinct original phase-zero/start ports.
  for (const entry of entries) take(entry);
  return selected.map(entry => entry.pose);
}
`;
const output = body + marker + helper;
let restored = output.slice(0, output.indexOf(marker));
for (const [before, after] of replacements.slice().reverse()) restored = restored.replace(after, before);
if (sha(Buffer.from(restored)) !== frozenHash || restored !== source) throw new Error('Inverse source identity failed');
const target = 'src/lib/route/globalSearchAllPoseSeeds.ts';
if (existsSync(target) && readFileSync(target, 'utf8') !== output) throw new Error('Refusing to overwrite a different experiment');
writeFileSync(target, output);
console.log(JSON.stringify({ sourcePath, frozenHash, target, targetHash: sha(Buffer.from(output)), inverseIdentity: true, coreChanges: ['export-name', 'return-all-coarse-pose-seeds'], qualityCallsAdded: 0 }));
