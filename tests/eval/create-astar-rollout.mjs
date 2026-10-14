import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const sourcePath = 'src/lib/route/shapeGuidedPortRolloutNoBacktrack.ts';
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8');
const protocol = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-no-backtrack-20261014/gwangalli/protocol-before-run.json', 'utf8'));
if (createHash('sha256').update(bytes).digest('hex') !== protocol.codeHashes[sourcePath]) throw new Error('Frozen NoBacktrack source changed');
const replacements = [
  ["import { pointSegDist, type RoadGraph } from './graph';", "import type { RoadGraph } from './graph';\nimport { createOrderedClosureBound } from './orderedClosureBound';"],
  ['export function shapeGuidedPortRolloutNoBacktrack(', 'export function shapeGuidedPortRolloutAStar('],
  ['      const limit = P.caseExpansions / 16,', '      const closureBound = createOrderedClosureBound(g, pg, guide, radius, start);\n      const limit = P.caseExpansions / 16,'],
  ['if (list.includes(s)) heap.push(s, s.cost); else labelsRejected++;', 'if (list.includes(s)) heap.push(s, s.cost + closureBound.estimate(s.node, s.phase) / Math.max(p.scale, 1)); else labelsRejected++;'],
  ['start, noStart: false, expansions: usedBudget,', 'start, noStart: false, closureBound: { ...closureBound.diagnostics(), gamma: closureBound.gamma }, expansions: usedBudget,'],
  ["scheduling: 'remaining-unit' as const,", "scheduling: 'remaining-unit' as const, priority: 'cost-plus-completed-suffix-lower-bound' as const, prefixOptimalityClaim: false, nativeQOptimalityClaim: false, closureBoundSetupIncludedInExpansionBudget: false,"],
];
let output = source;
for (const [before, after] of replacements) {
  if (output.split(before).length !== 2) throw new Error(`Expected one source anchor: ${before}`);
  output = output.replace(before, after);
}
const target = 'src/lib/route/shapeGuidedPortRolloutAStar.ts';
if (existsSync(target) && readFileSync(target, 'utf8') !== output) throw new Error('Refusing to overwrite a different experiment');
writeFileSync(target, output);
