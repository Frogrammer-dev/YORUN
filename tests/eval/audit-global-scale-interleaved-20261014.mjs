import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const folder = 'eval/recognition/route-improvement/global-scale-interleaved-20261014/gwangalli';
const target = path.join(folder, 'type-only-repair-validation.json');
if (existsSync(target)) throw new Error('Do not overwrite audit evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const resultBytes = readFileSync(path.join(folder, 'results.json')), result = JSON.parse(resultBytes.toString());
const harness = 'tests/eval/global-scale-interleaved-20261014.test.ts';
const annotation = '  const records: Array<{ caseId: string; originalBefore: number; arms: Array<{ globalSimilarity: number; globalRaw: number; after: number; afterRaw: number; improvement: boolean; evaluated: number; rejected: unknown[] }> }> = [];';
const current = readFileSync(harness, 'utf8'), frozen = readFileSync(path.join(folder, path.basename(harness) + '.source'), 'utf8');
if (current.split(annotation).length !== 2 || current.replace(annotation, '  const records = [];') !== frozen) throw new Error('The post-run change was not exactly the erased result array annotation');
for (const [file, expected] of Object.entries(result.protocol.codeHashes)) {
  const snapshot = readFileSync(path.join(folder, path.basename(file) + '.source'));
  if (hash(snapshot) !== expected) throw new Error('Snapshot hash mismatch: ' + file);
  if (file !== harness && hash(readFileSync(file)) !== expected) throw new Error('Execution module changed: ' + file);
}
if (hash(readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json')) !== result.protocol.inputHash) throw new Error('Input changed');
if (hash(readFileSync('eval/recognition/llm-routes-20261010/gwangalli-roads.json')) !== result.protocol.roadHash) throw new Error('Roads changed');
writeFileSync(target, JSON.stringify({
  resultSha256: hash(resultBytes), frozenHarnessSha256: result.protocol.codeHashes[harness], currentHarnessSha256: hash(current),
  exactInverseTypeOnlyChange: true, changedExecutableStatements: 0, oldSnapshotPreserved: true,
  remainingSourceAndInputHashesMatch: true, originalRunPassedRuntimeAssertions: true,
  originalRunHadPrecedingTypecheckError: 'result array inference only', repairedCurrentTypecheckPassed: true,
  reranFieldEvaluation: false, qualityOutputsModified: false,
}, null, 2));
console.log(JSON.stringify({ target, exactInverseTypeOnlyChange: true, changedExecutableStatements: 0, resultSha256: hash(resultBytes) }));
