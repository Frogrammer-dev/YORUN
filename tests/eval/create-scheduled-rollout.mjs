import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = readFileSync('src/lib/route/shapeGuidedPortRolloutBeam.ts', 'utf8');
const protocol = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-20261013/gwangalli/protocol-before-run.json', 'utf8'));
if (createHash('sha256').update(source).digest('hex') !== protocol.codeHashes['src/lib/route/shapeGuidedPortRolloutBeam.ts']) throw new Error('Original quality pilot source changed');
let result = source.replace('export function shapeGuidedPortRolloutBeam(', 'export function shapeGuidedPortRolloutScheduled(');
const patches = [
  ['      const initial: State =', '      const searchCalls: Array<{ completion: boolean; targetPhase: number; maxPhase: number; prefixSeedPhases: number[]; nativeSeedMeters: number[]; effectiveCap: number; legacyCap: number; budgetUsedBefore: number; budgetUsedAfter: number; expanded: number; remainingBefore: number; remainingAfter: number; unusedCallCap: number; heapRemaining: number; goalResults: number; capReached: boolean }> = []; let feedbackSelectionBudgetMarker: number | null = null;\n      const initial: State ='],
  ['        const heap = new Heap<State>(), labels = new Map<string, State[]>(), results: State[] = [], began = usedBudget;', '        const remainingAtStart = limit - usedBudget, effectiveCap = remainingAtStart; let maxPoppedPhase = -1;\n        const heap = new Heap<State>(), labels = new Map<string, State[]>(), results: State[] = [], began = usedBudget;'],
  ['usedBudget - began < cap', 'usedBudget - began < effectiveCap'],
  ['usedBudget - began >= cap', 'usedBudget - began >= effectiveCap'],
  ['          if (completion && s.phase === lastPhase && s.node === start && s.meters < 3000) belowMinRejected++;', '          maxPoppedPhase = Math.max(maxPoppedPhase, s.phase);\n          if (completion && s.phase === lastPhase && s.node === start && s.meters < 3000) belowMinRejected++;'],
  ['        return results;', '        searchCalls.push({ completion, targetPhase, maxPhase: maxPoppedPhase, prefixSeedPhases: seeds.map(s => s.phase), nativeSeedMeters: seeds.map(s => s.meters), effectiveCap, legacyCap: cap, budgetUsedBefore: began, budgetUsedAfter: usedBudget, expanded: usedBudget - began, remainingBefore: remainingAtStart, remainingAfter: limit - usedBudget, unusedCallCap: effectiveCap - (usedBudget - began), heapRemaining: heap.size, goalResults: results.length, capReached: usedBudget - began >= effectiveCap });\n        return results;'],
  ['        stages.push({ stage, reached:', '        if (feedback && feedbackEliteSelected > 0 && feedbackSelectionBudgetMarker === null) feedbackSelectionBudgetMarker = usedBudget;\n        stages.push({ stage, reached:'],
  ['lowerBoundRejected, phaseAdvanceWithoutMovement: unitZeroAdvances, stages });', 'lowerBoundRejected, phaseAdvanceWithoutMovement: unitZeroAdvances, stages, searchCalls, unusedUnitBudget: limit - usedBudget, afterFeedbackExpansions: feedbackSelectionBudgetMarker === null ? 0 : usedBudget - feedbackSelectionBudgetMarker });'],
  ['return { params: P, feedback, selectedPoses:', "return { params: { ...P, scheduling: 'remaining-unit' as const, callCapIsRemainingUnitBudget: true, actualWorkEqualAcrossArms: false }, feedback, selectedPoses:"],
];
for (const [before, after] of patches) { if (result.split(before).length !== 2) throw new Error(`Expected unique scheduler patch: ${before}`); result = result.replace(before, after); }
writeFileSync('src/lib/route/shapeGuidedPortRolloutScheduled.ts', result);
console.log('Scheduled copy persisted. Frozen original source SHA verified. Only intra-unit call ceilings and diagnostics changed.');
