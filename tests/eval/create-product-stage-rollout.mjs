import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const sourcePath = 'src/lib/route/shapeGuidedPortRolloutProductBound.ts';
const bytes = readFileSync(sourcePath), source = bytes.toString('utf8');
const expectedSourceHash = '65d580fcf0ff3479e3bc0a4bfc7cded67e25cf0a019dfb684fcf98639ad7185e';
const protocol = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-product-bound-20261014/gwangalli/protocol-before-run.json', 'utf8'));
const sourceHash = createHash('sha256').update(bytes).digest('hex');
if (sourceHash !== expectedSourceHash || sourceHash !== protocol.codeHashes[sourcePath]) throw new Error('Frozen ProductBound source changed');

const replacements = [
  ['export function shapeGuidedPortRolloutProductBound(', 'export function shapeGuidedPortRolloutProductStages('],
  ['  let productUnreachableRejected = 0;', '  let productUnreachableRejected = 0, maxCallCapOvershoot = 0;'],
  ['capReached: boolean }> = []; let feedbackSelectionBudgetMarker: number | null = null;', 'capReached: boolean; callCapOvershoot: number }> = []; let feedbackSelectionBudgetMarker: number | null = null;\n      let feedbackRescueBudgetMarker: number | null = null;'],
  ['effectiveCap = remainingAtStart;', 'effectiveCap = Math.min(cap, remainingAtStart);'],
  ['        searchCalls.push({ completion,', '        const callCapOvershoot = Math.max(0, usedBudget - began - effectiveCap); maxCallCapOvershoot = Math.max(maxCallCapOvershoot, callCapOvershoot);\n        searchCalls.push({ completion,'],
  ['capReached: usedBudget - began >= effectiveCap });', 'capReached: usedBudget - began >= effectiveCap, callCapOvershoot });'],
  ['{ tested, outsideControl } = rolloutTestPrefixes(reached);', '{ tested, outsideControl, control: counterfactualControl } = rolloutTestPrefixes(reached);'],
  ['        if (feedback && feedbackEliteSelected > 0', '        const selectedOnly = selected.filter(s => !counterfactualControl.includes(s)), controlOnly = counterfactualControl.filter(s => !selected.includes(s));\n        const feedbackOutsideControlSelected = selectedOnly.filter(s => feedbackQ.has(s)).length;\n        const selectedSetDifference = { selectedOnlyHashes: selectedOnly.map(s => s.hash), controlOnlyHashes: controlOnly.map(s => s.hash), symmetricCount: selectedOnly.length + controlOnly.length };\n        if (feedback && feedbackOutsideControlSelected > 0 && feedbackRescueBudgetMarker === null) feedbackRescueBudgetMarker = usedBudget;\n        if (feedback && feedbackEliteSelected > 0'],
  ['feedbackEliteSelected, proxySelected, hashSelected, retainedFeedbackPrefixes:', 'feedbackEliteSelected, feedbackOutsideControlSelected, selectedSetDifference, proxySelected, hashSelected, retainedFeedbackPrefixes:'],
  ['afterFeedbackExpansions: feedbackSelectionBudgetMarker === null ? 0 : usedBudget - feedbackSelectionBudgetMarker });', 'afterFeedbackExpansions: feedbackSelectionBudgetMarker === null ? 0 : usedBudget - feedbackSelectionBudgetMarker, afterFeedbackRescueExpansions: feedbackRescueBudgetMarker === null ? 0 : usedBudget - feedbackRescueBudgetMarker, maxCallCapOvershoot: Math.max(0, ...searchCalls.map(call => call.callCapOvershoot)) });'],
  ["scheduling: 'remaining-unit' as const,", "scheduling: 'fixed-subcaps' as const, callCapOvershootMaxPhaseBranches: 3,"],
  ['callCapIsRemainingUnitBudget: true,', 'callCapIsRemainingUnitBudget: false,'],
  ['diagnostics: { productPoses, productUnreachableRejected, expansions,', 'diagnostics: { maxCallCapOvershoot, productPoses, productUnreachableRejected, expansions,'],
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

const target = 'src/lib/route/shapeGuidedPortRolloutProductStages.ts';
if (existsSync(target) && readFileSync(target, 'utf8') !== output) throw new Error('Refusing to overwrite a different experiment');
writeFileSync(target, output);
console.log(JSON.stringify({ sourceHash, outputHash: createHash('sha256').update(output).digest('hex'), replacementCount: replacements.length, inverseRestoredFrozenSource: true }));
