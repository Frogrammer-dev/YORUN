import { createServer } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const server = await createServer({ configFile: false, resolve: { alias: { '@': resolve('src') } }, server: { middlewareMode: true, hmr: false } });
try {
  const area = process.argv[2] ?? 'gwangalli';
  if (!['gwangalli', 'seomyeon', 'gangnam'].includes(area)) throw new Error('Unknown frozen area');
  const { graphFromOverpass } = await server.ssrLoadModule('/src/lib/route/osm.ts');
  const source = readFileSync(`eval/recognition/llm-routes-20261010/${area}-roads.json`, 'utf8');
  const rows = JSON.parse(readFileSync('eval/recognition/route-improvement/offline-cascade-20261013/results.json', 'utf8')).cases;
  const bbox = rows.find(row => row.caseId === `${area}-square`).bbox;
  const g = graphFromOverpass(JSON.parse(source), bbox, { detail: 'simple', excludeSteps: true });
  const edges = [];
  for (let v = 0; v < g.n; v++) for (let e = g.adjStart[v]; e < g.adjStart[v + 1]; e++) if (v < g.adjTo[e]) edges.push([v, g.adjTo[e]]);
  writeFileSync(`reports/route-improvement-20261012/${area}-filtered-graph.json`, JSON.stringify({ sourceHash: createHash('sha256').update(source).digest('hex'), bbox, detail: 'simple', excludeSteps: true, nodes: Array.from({ length: g.n }, (_, v) => [g.lat[v], g.lon[v]]), edges }));
  console.log(JSON.stringify({ nodes: g.n, edges: edges.length }));
} finally {
  await server.close();
}
