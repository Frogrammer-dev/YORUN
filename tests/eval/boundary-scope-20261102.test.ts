import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DIVERSITY_CATALOG } from '@/lib/route/diversityCatalog';
import { DISTINCTIVE_FEATURES } from '@/lib/route/distinctiveFeatures';
import type { Placement } from '@/lib/route/fit';

it.skipIf(!process.env.ROAD_BOUNDARY_PREPARE)('freezes all25 kinds and shared placements before any boundary-generation outputs', () => {
  const folder = 'eval/recognition/road-ranker-20261102';
  const input = `${folder}/diversity-v11.json`, output = `${folder}/boundary-bank-v14.json`;
  expect(existsSync(output), 'Never replace a prepared placement bank').toBe(false);
  const raw = readFileSync(input);
  type Row = { id: string; area: string; proposalShape: string; generatorPlacement?: Placement; generatorSimilarity?: number };
  const source = JSON.parse(raw.toString()) as { status: string; results: Row[]; provenance: { sourceSnapshots: unknown[] } };
  expect(source.status).toBe('complete'); expect(source.results).toHaveLength(1003);
  const areas = [...new Set(source.results.map(r => r.area))]; expect(areas).toHaveLength(3);
  expect(DIVERSITY_CATALOG).toHaveLength(25); expect(DISTINCTIVE_FEATURES).toHaveLength(25);
  const cases = areas.flatMap(area => DIVERSITY_CATALOG.map(item => {
    const rows = source.results.filter(r => r.area === area && r.proposalShape === item.key && r.generatorPlacement)
      .sort((a, b) => (b.generatorSimilarity ?? -Infinity) - (a.generatorSimilarity ?? -Infinity) || a.id.localeCompare(b.id, 'en'));
    const bases: { sourceId: string; pose: Placement }[] = [];
    for (const row of rows) {
      const pose = row.generatorPlacement!;
      expect([pose.cx, pose.cy, pose.scale, pose.rotDeg].every(Number.isFinite)).toBe(true);
      if (pose.scale <= 0 || bases.some(b => JSON.stringify(b.pose) === JSON.stringify(pose))) continue;
      bases.push({ sourceId: row.id, pose }); if (bases.length === 3) break;
    }
    expect(bases.length, `No base pose for ${area}/${item.key}`).toBeGreaterThan(0);
    const poses: { sourceId: string; pose: Placement }[] = [];
    for (const base of bases) for (const x of [0, -.05, .05]) for (const y of [0, -.05, .05]) for (const angle of [0, -15, 15]) {
      const pose = { ...base.pose, cx: base.pose.cx + x * base.pose.scale, cy: base.pose.cy + y * base.pose.scale, rotDeg: base.pose.rotDeg + angle };
      if (poses.length < 60 && !poses.some(p => JSON.stringify(p.pose) === JSON.stringify(pose))) poses.push({ sourceId: base.sourceId, pose });
    }
    return { area, key: item.key, kind: item.kind, template: item.shape,
      definition: DISTINCTIVE_FEATURES.find(d => d.key === item.key), poses };
  }));
  expect(cases).toHaveLength(75);
  const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  writeFileSync(output, JSON.stringify({ input, inputSHA256: sha(raw), preparationCodeSHA256: sha(readFileSync('tests/eval/boundary-scope-20261102.test.ts')),
    definitionsSHA256: sha(readFileSync('src/lib/route/distinctiveFeatures.ts')), cases,
    sourceSnapshots: source.provenance.sourceSnapshots,
    policy: 'Same fixed poses for A/B; top3 distinct generator poses, 0/-5%/+5% translation and 0/-15/+15deg, first60 unique; no new roads searched',
    generationExecuted: false, independentHoldout: false, humanRecognitionMeasured: false,
    unsupportedPolicyProposal: 'Keep all25 targets; report definition absence explicitly. Fallback must be pre-registered before generation.' }, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ requests: cases.length, supportedKinds: DISTINCTIVE_FEATURES.filter(d => d.supported).length,
    unsupportedKinds: DISTINCTIVE_FEATURES.filter(d => !d.supported).map(d => d.key), placements: cases.reduce((s, c) => s + c.poses.length, 0) }) + '\n');
});
