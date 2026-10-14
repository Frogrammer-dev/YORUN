import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const sourcePath = 'src/lib/route/shapeGuidedPortRolloutContinuous.ts';
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8');
const protocol = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-continuous-20261013/gwangalli/protocol-before-run.json', 'utf8'));
if (createHash('sha256').update(bytes).digest('hex') !== protocol.codeHashes[sourcePath]) throw new Error('Frozen continuous source changed');
const replacements = [
  ['export function shapeGuidedPortRolloutContinuous(', 'export function shapeGuidedPortRolloutNoBacktrack('],
  ['let actualArcAttempts = 0,', 'let immediateReverseRejected = 0, actualArcAttempts = 0,'],
  ['const spendOne = () => { usedBudget++; expansions++; };', 'const spendOne = () => { usedBudget++; expansions++; };\n        const previousArc = s.path.at(-1);\n        if (previousArc !== undefined && a.edgeId === arcs[previousArc].edgeId && a.id !== previousArc) { spendOne(); immediateReverseRejected++; return []; }'],
  ['transitionBudgetCountsReturnedPhaseBranches: true', 'transitionBudgetCountsReturnedPhaseBranches: true, immediateMacroReverseExcluded: true'],
  ['actualArcAttempts, emittedPhaseBranches,', 'actualArcAttempts, immediateReverseRejected, emittedPhaseBranches,'],
];
let output = source;
for (const [before, after] of replacements) {
  if (output.split(before).length !== 2) throw new Error(`Expected one source anchor: ${before}`);
  output = output.replace(before, after);
}
const target = 'src/lib/route/shapeGuidedPortRolloutNoBacktrack.ts';
if (existsSync(target) && readFileSync(target, 'utf8') !== output) throw new Error('Refusing to overwrite a different experiment');
writeFileSync(target, output);
