import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Read-only check: Git checkout must preserve the byte-frozen source and clones.
const files = ['src/lib/route/globalSearch.ts', 'src/lib/route/globalSearchAllPoseSeeds.ts', 'src/lib/route/globalSearchScaleInterleaved.ts'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
for (const file of files) {
  const local = hash(readFileSync(file)), staged = hash(execFileSync('git', ['show', ':' + file]));
  if (local !== staged) throw new Error('Git staging changed frozen experiment bytes: ' + file);
  console.log(JSON.stringify({ file, sha256: local, stagedBytesMatch: true }));
}
