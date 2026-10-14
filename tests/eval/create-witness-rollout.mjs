import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const sourcePath = 'src/lib/route/shapeGuidedPortRolloutProductStages.ts';
const target = 'src/lib/route/shapeGuidedPortRolloutWitness.ts';
const source = readFileSync(sourcePath, 'utf8');
const hash = s => createHash('sha256').update(s).digest('hex');
const expected = '3fd8205b351274692ba349cdd2a9268bc40437715be3b0018938ccdc67163093';
if (hash(source) !== expected) throw new Error('Frozen ProductStages source changed');
const newline = source.includes('\r\n') ? '\r\n' : '\n';
const lines = s => s.replaceAll('\n', newline);
const replacements = [
  ["import { pairEdgeKey, pairPhaseZero } from './pairSegmentRepair';", "import { pairEdgeKey, pairPhaseZero } from './pairSegmentRepair';\nimport { createNativeGuideWitnessIndex, selectWitnessLabels, selectWitnessBeam, testWitnessPrefixes, type NativeGuideWitness } from './nativeGuideWitness';"],
  ['phaseNodes: number[][]; };', 'phaseNodes: number[][]; witness: NativeGuideWitness; witnessRescueIds: number[]; witnessStateId: number; witnessParentStateId: number | null; };'],
  ['export function shapeGuidedPortRolloutProductStages(g: RoadGraph, pg: ExactRoadPortGraph, shape: ShapeDef, region: Region, poses: Placement[], feedback: boolean) {', 'export function shapeGuidedPortRolloutWitness(g: RoadGraph, pg: ExactRoadPortGraph, shape: ShapeDef, region: Region, poses: Placement[], feedback: boolean, witnessEnabled = true) {'],
  ['prefixHash: number; suffixTurnWeight: number }; zeroAdvances:', 'prefixHash: number; suffixTurnWeight: number; witnessRescueIds: number[]; goalArcPath: number[]; goalStateId: number }; nativeWitness: { guideToRoute: number; featureCoverage: number; guideSamples: number; features: number }; zeroAdvances:'],
  ['  let productUnreachableRejected = 0, maxCallCapOvershoot = 0;', '  let productUnreachableRejected = 0, maxCallCapOvershoot = 0;\n  type WitnessCompetitor = { cost: number; hash: number; incoming: number; phase: number; lengthBucket: number; arcPath: number[] };\n  const witnessPoses: Array<{ poseId: number } & ReturnType<ReturnType<typeof createNativeGuideWitnessIndex>[\'diagnostics\']>> = [];\n  const witnessRescueTraces: Array<{ id: number; unit: number; stage: number; reason: string; prefixHash: number; phase: number; parentRescueIds: number[]; arcPath: number[]; stateId: number; parentStateId: number | null; cost: number; incoming: number; lengthBucket: number; costCompetitors?: WitnessCompetitor[] }> = [];\n  const witnessRescueKeys = new Map<string, number>();\n  let witnessRescueAttempts = 0, witnessRescuesUntraced = 0, witnessStateCopies = 0, witnessLineageCopies = 0, witnessLineageElementsCopied = 0;'],
  ['    const phaseCache = new Map<string, ReturnType<typeof continuousArcPhase>>();', '    const witnessIndex = createNativeGuideWitnessIndex(g, shape, p, guide);\n    const phaseCache = new Map<string, ReturnType<typeof continuousArcPhase>>();'],
  ['      const initial: State = { node: start,', '      let activeStage = 0;\n      const markWitnessRescue = (s: State, reason: string, competitors?: WitnessCompetitor[]) => {\n        if (!witnessEnabled) return; witnessRescueAttempts++;\n        const key = `${unit}:${s.witnessStateId}:${reason}`; let id = witnessRescueKeys.get(key);\n        if (id === undefined) {\n          if (witnessRescueTraces.length >= 512) { witnessRescuesUntraced++; return; }\n          id = witnessRescueTraces.length; witnessRescueKeys.set(key, id);\n          witnessRescueTraces.push({ id, unit, stage: activeStage, reason, prefixHash: s.hash, phase: s.phase, parentRescueIds: s.witnessRescueIds.slice(), arcPath: s.path.slice(), stateId: s.witnessStateId, parentStateId: s.witnessParentStateId, cost: s.cost, incoming: s.path.at(-1) ?? -1, lengthBucket: Math.floor(s.meters / 500), costCompetitors: competitors });\n        }\n        if (!s.witnessRescueIds.includes(id)) s.witnessRescueIds.push(id);\n      };\n      const initial: State = { node: start,'],
  ['phaseNodes: Array.from({ length: lastPhase + 1 }, () => []) };', 'phaseNodes: Array.from({ length: lastPhase + 1 }, () => []), witness: witnessIndex.initial(start), witnessRescueIds: [], witnessStateId: witnessStateCopies++, witnessParentStateId: null };'],
  ['        const physicalTurn = internalTurn + (s.path.length ? angle(s.last, a.first) : 0), states: State[] = [];', '        const physicalTurn = internalTurn + (s.path.length ? angle(s.last, a.first) : 0), states: State[] = [];\n        const nextWitness = witnessIndex.append(s.witness, a);'],
  ['phaseNodes: s.phaseNodes.map((ns, k) => [...new Set([...ns, ...label.phaseActualNodes[k]])]) };', 'phaseNodes: s.phaseNodes.map((ns, k) => [...new Set([...ns, ...label.phaseActualNodes[k]])]), witness: nextWitness, witnessRescueIds: s.witnessRescueIds.slice(), witnessStateId: witnessStateCopies++, witnessParentStateId: s.witnessStateId };'],
  ['          unitZeroAdvances += label.zeroDistancePhaseAdvances; states.push(t);', '          witnessLineageCopies++; witnessLineageElementsCopied += s.witnessRescueIds.length;\n          unitZeroAdvances += label.zeroDistancePhaseAdvances; states.push(t);'],
  ['list.push(s); list.sort((a, b) => a.cost - b.cost || a.hash - b.hash); if (list.length > 4) list.pop(); labels.set(key, list);', 'list.push(s); const oldPolicy = list.slice().sort((a, b) => a.cost - b.cost || a.hash - b.hash).slice(0, 4), retained = selectWitnessLabels(list, witnessIndex, s.phase, witnessEnabled); for (const t of retained) if (!oldPolicy.includes(t)) markWitnessRescue(t, \'label\', oldPolicy.map(v => ({ cost: v.cost, hash: v.hash, incoming: v.path.at(-1) ?? -1, phase: v.phase, lengthBucket: Math.floor(v.meters / 500), arcPath: v.path.slice() }))); labels.set(key, retained);'],
  ['if (list.includes(s)) heap.push(s, s.cost + suffixBound / Math.max(p.scale, 1)); else labelsRejected++; };', 'if (retained.includes(s)) heap.push(s, s.cost + suffixBound / Math.max(p.scale, 1)); else labelsRejected++; };'],
  ['        const reached = search(beam, Math.ceil(lastPhase * stage / 4), prefixCap, 30, false), { tested, outsideControl, control: counterfactualControl } = rolloutTestPrefixes(reached);', '        activeStage = stage;\n        const selectionPhase = Math.ceil(lastPhase * stage / 4);\n        const reached = search(beam, selectionPhase, prefixCap, 30, false), originalTests = rolloutTestPrefixes(reached);\n        const { tested, outsideControl, control: counterfactualControl } = testWitnessPrefixes(reached, witnessIndex, selectionPhase, witnessEnabled, rolloutTestPrefixes);\n        for (const prefix of tested) if (!originalTests.tested.includes(prefix)) markWitnessRescue(prefix, \'tested-prefix\');'],
  ['provenance: { unit, stage, prefixHash: prefix.hash, suffixTurnWeight: turnWeight }, zeroAdvances:', 'provenance: { unit, stage, prefixHash: prefix.hash, suffixTurnWeight: turnWeight, witnessRescueIds: goal.witnessRescueIds.slice(), goalArcPath: goal.path.slice(), goalStateId: goal.witnessStateId }, nativeWitness: witnessIndex.summary(goal.witness), zeroAdvances:'],
  ['        const { selected, scored, feedbackEliteSelected, proxySelected, hashSelected } = selectRolloutBeam(reached, feedbackQ, feedback);', '        const { selected, scored, feedbackEliteSelected, proxySelected, hashSelected, witnessSelected } = selectWitnessBeam(reached, feedbackQ, feedback, witnessIndex, selectionPhase, witnessEnabled, selectRolloutBeam);\n        const originalBeam = selectRolloutBeam(reached, feedbackQ, feedback).selected;\n        for (const prefix of selected) if (!originalBeam.includes(prefix)) markWitnessRescue(prefix, \'stage-beam\');'],
  ['feedbackEliteSelected, feedbackOutsideControlSelected, selectedSetDifference, proxySelected, hashSelected, retainedFeedbackPrefixes:', 'feedbackEliteSelected, feedbackOutsideControlSelected, selectedSetDifference, proxySelected, hashSelected, witnessSelected, retainedFeedbackPrefixes:'],
  ['    productPoses.push({ ...productClosureIndex.diagnostics(), poseId, setupMs: productSetupMs, phaseCacheEntriesAfterSearch: phaseCache.size });', '    witnessPoses.push({ poseId, ...witnessIndex.diagnostics() });\n    productPoses.push({ ...productClosureIndex.diagnostics(), poseId, setupMs: productSetupMs, phaseCacheEntriesAfterSearch: phaseCache.size });'],
  ['immediateMacroReverseExcluded: true }, feedback, selectedPoses:', 'immediateMacroReverseExcluded: true, witnessPolicy: witnessEnabled, witnessWorkIncludedInExpansionBudget: false, witnessTraceCap: 512, nativeWitnessQBoundClaim: false }, feedback, selectedPoses:'],
  ['  const distinct = new Map<string, typeof pool[number]>();', '  const witnessCompletedLineage = pool.filter(c => c.provenance.witnessRescueIds.length).map(c => ({ unit: c.provenance.unit, stage: c.provenance.stage, raw: c.raw, goalStateId: c.provenance.goalStateId, goalArcPath: c.provenance.goalArcPath, witnessRescueIds: c.provenance.witnessRescueIds, nativeNodes: c.nodes }));\n  const distinct = new Map<string, typeof pool[number]>();'],
  ['diagnostics: { maxCallCapOvershoot, productPoses,', 'diagnostics: { witnessPoses, witnessRescueTraces, witnessCompletedLineage, witnessRescueAttempts, witnessRescuesUntraced, witnessStateCopies, witnessLineageCopies, witnessLineageElementsCopied, maxCallCapOvershoot, productPoses,'],
];

let output = source;
for (const [beforeText, afterText] of replacements) {
  const before = lines(beforeText), after = lines(afterText);
  if (output.split(before).length !== 2) throw new Error(`Expected one source anchor: ${beforeText}`);
  output = output.replace(before, after);
}
let restored = output;
for (const [beforeText, afterText] of replacements.slice().reverse()) {
  const before = lines(beforeText), after = lines(afterText);
  if (restored.split(after).length !== 2) throw new Error(`Expected one inverse anchor: ${afterText}`);
  restored = restored.replace(after, before);
}
if (restored !== source || hash(restored) !== expected) throw new Error('Inverse did not restore exact frozen bytes');
if (process.argv.includes('--check')) {
  if (!existsSync(target) || readFileSync(target, 'utf8') !== output) throw new Error('Witness clone does not match controlled transform');
} else {
  const replaceHash = process.argv.find(s => s.startsWith('--replace-generated='))?.split('=')[1];
  if (existsSync(target) && readFileSync(target, 'utf8') !== output && hash(readFileSync(target, 'utf8')) !== replaceHash) throw new Error('Refusing to overwrite another experiment');
  writeFileSync(target, output);
}
console.log(JSON.stringify({ sourceHash: hash(source), outputHash: hash(output), anchors: replacements.length, inverseRestoredFrozenSource: true, checkOnly: process.argv.includes('--check') }));
