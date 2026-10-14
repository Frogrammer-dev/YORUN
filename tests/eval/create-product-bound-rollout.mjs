import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const sourcePath = 'src/lib/route/shapeGuidedPortRolloutAStar.ts';
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8');
const expectedSourceHash = 'cdd002cb865d783f91e73ac3b0b5c0379366c096a565ac925041d8ac4735afef';
const protocol = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-astar-20261014/gwangalli/protocol-before-run.json', 'utf8'));
const sourceHash = createHash('sha256').update(bytes).digest('hex');
if (sourceHash !== expectedSourceHash || sourceHash !== protocol.codeHashes[sourcePath]) throw new Error('Frozen AStar source changed');

const replacements = [
  ["import { createOrderedClosureBound } from './orderedClosureBound';", "import { createGuideProductClosureIndex } from './guideProductClosureBound';"],
  ['export function shapeGuidedPortRolloutAStar(', 'export function shapeGuidedPortRolloutProductBound('],
  ['  const select = rolloutPoseSeeds(poses, region);', '  const productPoses: Array<ReturnType<ReturnType<typeof createGuideProductClosureIndex>[\'diagnostics\']> & { poseId: number; setupMs: number; phaseCacheEntriesAfterSearch: number }> = [];\n  let productUnreachableRejected = 0;\n  const select = rolloutPoseSeeds(poses, region);'],
  ['    const phaseCache = new Map<string, ReturnType<typeof continuousArcPhase>>();', '    const phaseCache = new Map<string, ReturnType<typeof continuousArcPhase>>();\n    const productSetupBegan = performance.now(), productClosureIndex = createGuideProductClosureIndex(g, arcs, guide, radius, tol, phaseCache), productSetupMs = performance.now() - productSetupBegan;'],
  ['      const closureBound = createOrderedClosureBound(g, pg, guide, radius, start);', '      const boundSetupBegan = performance.now(), closureBound = productClosureIndex.toStart(start), boundSetupMs = performance.now() - boundSetupBegan;\n      const startSuffixBound = closureBound.estimate(start, 0), startReachable = Number.isFinite(startSuffixBound);\n      let unitUnreachableRejected = 0;'],
  ['const keep = (s: State) => { const incoming =', 'const keep = (s: State) => { const suffixBound = closureBound.estimate(s.node, s.phase); if (!Number.isFinite(suffixBound)) { unitUnreachableRejected++; productUnreachableRejected++; return; } const incoming ='],
  ['heap.push(s, s.cost + closureBound.estimate(s.node, s.phase) / Math.max(p.scale, 1));', 'heap.push(s, s.cost + suffixBound / Math.max(p.scale, 1));'],
  ['start, noStart: false, closureBound: { ...closureBound.diagnostics(), gamma: closureBound.gamma }, expansions: usedBudget,', 'start, noStart: false, closureBound: { ...closureBound.diagnostics(), boundSetupMs, unscaledProxy: true, startReachable, startSuffixBound: startReachable ? startSuffixBound : null }, productUnreachableRejected: unitUnreachableRejected, expansions: usedBudget,'],
  ['    }\n  }\n  const distinct =', '    }\n    productPoses.push({ ...productClosureIndex.diagnostics(), poseId, setupMs: productSetupMs, phaseCacheEntriesAfterSearch: phaseCache.size });\n  }\n  const distinct ='],
  ["priority: 'cost-plus-completed-suffix-lower-bound' as const,", "priority: 'cost-plus-guide-product-suffix-lower-bound' as const, boundUsesUnscaledProxy: true, productInfinityPruning: true, productSetupAndReverseSearchIncludedInExpansionBudget: false,"],
  ['diagnostics: { expansions, nodeInspections,', 'diagnostics: { productPoses, productUnreachableRejected, expansions, nodeInspections,'],
];

let output = source;
for (const [before, after] of replacements) {
  if (output.split(before).length !== 2) throw new Error(`Expected one source anchor: ${before}`);
  output = output.replace(before, after);
}
let restored = output;
for (const [before, after] of replacements.slice().reverse()) {
  if (restored.split(after).length !== 2) throw new Error(`Expected one inverse anchor: ${after}`);
  restored = restored.replace(after, before);
}
if (restored !== source) throw new Error('Anchored inverse failed to restore frozen source');

const target = 'src/lib/route/shapeGuidedPortRolloutProductBound.ts';
if (existsSync(target) && readFileSync(target, 'utf8') !== output) throw new Error('Refusing to overwrite a different experiment');
writeFileSync(target, output);
console.log(JSON.stringify({ sourceHash, outputHash: createHash('sha256').update(output).digest('hex'), replacementCount: replacements.length, inverseRestoredFrozenSource: true }));
