import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const source = readFileSync('src/lib/route/shapeGuidedPortRolloutScheduled.ts', 'utf8'), frozen = JSON.parse(readFileSync('eval/recognition/route-improvement/shape-guided-rollout-scheduled-20261013/gwangalli/protocol-before-run.json', 'utf8'));
if (createHash('sha256').update(source).digest('hex') !== frozen.codeHashes['src/lib/route/shapeGuidedPortRolloutScheduled.ts']) throw new Error('Frozen scheduled source changed');
let result = "import { continuousArcPhase, CONTINUOUS_PHASE_PARAMS } from './continuousEdgePhase';\n" + source.replace('export function shapeGuidedPortRolloutScheduled(', 'export function shapeGuidedPortRolloutContinuous(');
const replace = (a, b) => { if (result.split(a).length !== 2) throw new Error(`Ambiguous continuous patch: ${a}`); result = result.replace(a, b); };
replace('  const select = rolloutPoseSeeds(poses, region);', '  let actualArcAttempts = 0, emittedPhaseBranches = 0, budgetTruncatedPhaseBranches = 0, dpCacheHits = 0, dpCacheMisses = 0, dpIntervalTests = 0, dpPhaseChoices = 0, dpIntegralCalls = 0, dpPhaseCapSkipped = 0;\n  const select = rolloutPoseSeeds(poses, region);');
replace('    for (let startId = 0; startId < 2; startId++) {', '    const phaseCache = new Map<string, ReturnType<typeof continuousArcPhase>>();\n    for (let startId = 0; startId < 2; startId++) {');
const advanceStart = result.indexOf('      const advance = '), advanceEnd = result.indexOf('\n', advanceStart); if (advanceStart < 0) throw new Error('Missing original greedy advance'); result = result.slice(0, advanceStart) + result.slice(advanceEnd + 1);
replace('      advance(initial, start); let beam = [initial]; const stages = [];', '      let beam = [initial]; const stages = [];');
const transitionStart = result.indexOf('      const transition = '), transitionEnd = result.indexOf('      const search = ', transitionStart);
if (transitionStart < 0 || transitionEnd < 0) throw new Error('Missing original transition block');
const transition = [
'      const transition = (s: State, a: Arc, turnWeight: number): State[] => {',
'        if (usedBudget >= limit || s.path.length >= P.maxArcDepth) return []; actualArcAttempts++;',
'        const spendOne = () => { usedBudget++; expansions++; };',
'        const meters = s.meters + a.meters, repeated = s.repeated + (s.used.has(a.edgeId) ? a.meters : 0);',
'        if (meters > 8000 || repeated / 8000 > .2) { spendOne(); return []; }',
'        if (meters + (distances.get(a.to) ?? Infinity) > 8000 || s.path.length + 1 + (hops.get(a.to) ?? Infinity) > P.maxArcDepth) { lowerBoundRejected++; spendOne(); return []; }',
'        const cacheKey = `${a.id}:${s.phase}`; let options = phaseCache.get(cacheKey);',
'        if (options) dpCacheHits++; else {',
'          options = continuousArcPhase(g, a.nodes, guide, s.phase, radius, tol); phaseCache.set(cacheKey, options); dpCacheMisses++;',
'          dpIntervalTests += options.work.intervalTests; dpPhaseChoices += options.work.phaseChoices; dpIntegralCalls += options.work.integralCalls; dpPhaseCapSkipped += options.work.phaseChoiceCapSkipped;',
'          nodeInspections += options.work.edgePhaseEvaluations; unitNodeInspections += options.work.edgePhaseEvaluations;',
'        }',
'        if (!options.labels.length) { spendOne(); return []; }',
'        let internalTurn = 0; for (let i = 1; i < a.nodes.length - 1; i++) { const u = a.nodes[i - 1], v = a.nodes[i], w = a.nodes[i + 1]; internalTurn += angle(Math.atan2(g.y[v] - g.y[u], g.x[v] - g.x[u]), Math.atan2(g.y[w] - g.y[v], g.x[w] - g.x[v])); }',
'        const physicalTurn = internalTurn + (s.path.length ? angle(s.last, a.first) : 0), states: State[] = [];',
'        for (let i = 0; i < options.labels.length; i++) {',
'          if (usedBudget >= limit) { budgetTruncatedPhaseBranches += options.labels.length - i; break; } spendOne(); emittedPhaseBranches++;',
'          const label = options.labels[i], used = new Map(s.used); used.set(a.edgeId, (used.get(a.edgeId) ?? 0) + 1);',
'          const t: State = { ...s, node: a.to, phase: label.phase, path: [...s.path, a.id], used, meters, repeated, hash: hash(`${a.from}:${a.to}:${a.edgeId}:${label.phase}`, s.hash), history: [...used].sort((a, b) => a[0] - b[0]).map(([e, n]) => `${e}:${n}`).join(","), first: s.path.length ? s.first : a.first, last: a.last, zeroAdvances: s.zeroAdvances + label.zeroDistancePhaseAdvances, cost: s.cost + (label.proxyExtra + turnWeight * physicalTurn) / Math.max(p.scale, 1), phaseMeters: s.phaseMeters.map((v, k) => v + label.phaseNativeMeters[k]), phaseNodes: s.phaseNodes.map((ns, k) => [...new Set([...ns, ...label.phaseActualNodes[k]])]) };',
'          unitZeroAdvances += label.zeroDistancePhaseAdvances; states.push(t);',
'        }',
'        return states;',
'      };',
].join('\n') + '\n';
result = result.slice(0, transitionStart) + transition + result.slice(transitionEnd);
replace('const t = transition(s, a, turnWeight); if (t) keep(t);', 'for (const t of transition(s, a, turnWeight)) keep(t);');
replace("scheduling: 'remaining-unit' as const, callCapIsRemainingUnitBudget: true, actualWorkEqualAcrossArms: false", "scheduling: 'remaining-unit' as const, callCapIsRemainingUnitBudget: true, actualWorkEqualAcrossArms: false, continuousPhase: CONTINUOUS_PHASE_PARAMS, transitionBudgetCountsReturnedPhaseBranches: true");
replace('diagnostics: { expansions, nodeInspections, lowerBoundArcInspections,', 'diagnostics: { expansions, nodeInspections, nodeInspectionsCountsEdgePhaseEvaluations: true, actualArcAttempts, emittedPhaseBranches, budgetTruncatedPhaseBranches, dpCacheHits, dpCacheMisses, dpIntervalTests, dpPhaseChoices, dpIntegralCalls, dpPhaseCapSkipped, lowerBoundArcInspections,');
writeFileSync('src/lib/route/shapeGuidedPortRolloutContinuous.ts', result);
console.log('Continuous actual-edge optional phase copy persisted. Frozen scheduled source SHA unchanged.');
