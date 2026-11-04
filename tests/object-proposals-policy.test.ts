import { beforeEach, expect, it, vi } from 'vitest';
import { buildGraph, makeOrigin, unproject } from '@/lib/route/graph';
import { StepBudget } from '@/lib/route/budget';
import type { RouteCandidate } from '@/lib/route/fit';
import { globalSearch } from '@/lib/route/globalSearch';
import { generateObjectProposals } from '@/lib/route/objectProposals';
import { OBJECT_TEMPLATES } from '@/lib/route/objectTemplates';

vi.mock('@/lib/route/globalSearch', () => ({globalSearch: vi.fn()}));
const search = vi.mocked(globalSearch);
const templates = OBJECT_TEMPLATES.slice(0, 2);
const options = {area: 'test-area', roadHash: 'frozen-road-hash', idPrefix: 'policy'};

function fixture() {
  const origin = makeOrigin(37, 127);
  const points: [number, number][] = [[-500, -500], [500, -500], [500, 500], [-500, 500]];
  const ll = points.map(([x, y]) => unproject(origin, x, y));
  const graph = buildGraph(origin, ll.map(p => p[0]), ll.map(p => p[1]),
    [{a: 0, b: 1, factor: 1}, {a: 1, b: 2, factor: 1}, {a: 2, b: 3, factor: 1}, {a: 3, b: 0, factor: 1}], null);
  const path = points.map(([x, y]) => graph.nodeIndex.nearest(x, y, 1));
  path.push(path[0]);
  const latlngs = path.map(v => [graph.lat[v], graph.lon[v]] as [number, number]);
  const candidate = (similarity: number, rotation = 0, line = latlngs): RouteCandidate => ({
    latlngs: line, similarity, placement: {cx: 0, cy: 0, scale: 1000, rotDeg: rotation},
  } as RouteCandidate);
  return {graph, candidate, latlngs, region: {minX: -1000, minY: -1000, maxX: 1000, maxY: 1000}};
}

function found(pool: RouteCandidate[]) {
  return {candidate: pool[0] ?? null, pool, evaluated: pool.length, coarseSeeds: 20, placementSeeds: []};
}

beforeEach(() => search.mockReset());

it('keeps both intents for the same road, independent of template order; graph coordinates stay unchanged', () => {
  const {graph, candidate, region} = fixture();
  search.mockImplementation((_g, shape) => found([candidate(shape === templates[0].shape ? 70 : 90)]));
  const a = generateObjectProposals(graph, region, templates, options);
  const b = generateObjectProposals(graph, region, [...templates].reverse(), options);
  expect(a.results).toHaveLength(2);
  expect(a.results[0].geometryKey).toBe(a.results[1].geometryKey);
  expect(a.results.map(r => r.proposalShape).sort()).toEqual(templates.map(t => t.key).sort());
  expect([...a.results].sort((x, y) => x.proposalShape.localeCompare(y.proposalShape)))
    .toEqual([...b.results].sort((x, y) => x.proposalShape.localeCompare(y.proposalShape)));
  for (const row of a.results) {
    expect(row.xy).toEqual(row.path.map(v => [graph.x[v], graph.y[v]]));
    expect(row.latlon).toEqual(row.path.map(v => [graph.lat[v], graph.lon[v]]));
  }
  expect(a.counts.every(c => c.budgetBefore === null && c.budgetAfter === null && !c.partial)).toBe(true);
});

it('keeps the highest-similarity placement per intent/geometry, including reversed traversal; ties keep first', () => {
  const {graph, candidate, latlngs, region} = fixture();
  search.mockReturnValue(found([candidate(50, 0), candidate(95, 90, [...latlngs].reverse()), candidate(95, 180)]));
  const out = generateObjectProposals(graph, region, templates.slice(0, 1), options);
  expect(out.results).toHaveLength(1);
  expect(out.results[0]).toMatchObject({proposalPoolRank: 2, generatorSimilarity: 95, generatorPlacement: {rotDeg: 90}});
  expect(out.counts[0]).toMatchObject({added: 1, duplicates: 2, replaced: 1});
});

it('explicit legacy mode keeps v7 first-wins behavior across both placements and intents', () => {
  const {graph, candidate, region} = fixture();
  search.mockReturnValueOnce(found([candidate(50), candidate(95, 90)])).mockReturnValueOnce(found([candidate(99)]));
  const out = generateObjectProposals(graph, region, templates, {...options, preserveHypotheses: false});
  expect(out.results).toHaveLength(1);
  expect(out.results[0]).toMatchObject({proposalShape: templates[0].key, generatorSimilarity: 50, proposalPoolRank: 1});
  expect(out.counts.map(c => c.duplicates)).toEqual([1, 1]);
  expect(out.counts.every(c => c.preserveHypotheses === false)).toBe(true);
});

it('retains all requests when a shared budget expires; partial valid output is not recorded as a road failure', () => {
  const {graph, candidate, region} = fixture();
  const budget = new StepBudget(1);
  const onProgress = vi.fn();
  search.mockImplementation(() => { budget.spend(2); return found([candidate(80)]); });
  const out = generateObjectProposals(graph, region, templates, {...options, budget, onProgress});
  expect(search).toHaveBeenCalledTimes(1);
  expect(out.results).toHaveLength(1);
  expect(out.counts).toHaveLength(2);
  expect(onProgress).toHaveBeenCalledTimes(2);
  expect(out.counts[0]).toMatchObject({budgetBefore: 1, budgetAfter: 0, budgetExhausted: true, partial: true, status: 'budget_exhausted', added: 1, failures: {}, error: null});
  expect(out.counts[1]).toMatchObject({budgetBefore: 0, budgetAfter: 0, budgetExhausted: true, partial: true, status: 'budget_exhausted', evaluated: 0, returned: 0, failures: {}, error: null});
});

it('distinguishes a zero-remaining boundary step from exhaustion, and does not leak budget into a new call', () => {
  const {graph, candidate, region} = fixture();
  const budget = new StepBudget(1);
  budget.spend(); // remaining()==0 but ok() is still true at the exact boundary
  search.mockImplementation(() => { budget.spend(); return found([]); });
  const exhausted = generateObjectProposals(graph, region, templates.slice(0, 1), {...options, budget});
  expect(search).toHaveBeenCalledTimes(1);
  expect(exhausted.counts[0]).toMatchObject({budgetBefore: 0, budgetExhausted: true});
  search.mockReturnValue(found([candidate(80)]));
  const fresh = generateObjectProposals(graph, region, templates.slice(0, 1), options);
  expect(fresh.results).toHaveLength(1);
  expect(fresh.counts[0]).toMatchObject({budgetBefore: null, budgetAfter: null, budgetExhausted: false, partial: false, status: 'complete'});
});

it('records search errors separately from exhaustion and preserves later request counts', () => {
  const {graph, region} = fixture();
  search.mockImplementationOnce(() => { throw new Error('search failed'); }).mockReturnValueOnce(found([]));
  const out = generateObjectProposals(graph, region, templates, {...options, budget: new StepBudget(100)});
  expect(out.counts).toHaveLength(2);
  expect(out.counts[0]).toMatchObject({status: 'error', error: 'Error: search failed', partial: true, budgetExhausted: false, failures: {}});
  expect(out.counts[1]).toMatchObject({status: 'complete', error: null, partial: false, budgetExhausted: false});
});

it('records an ordinary empty search and an invalid road without pretending the budget expired', () => {
  const {graph, candidate, latlngs, region} = fixture();
  const nearMiss = latlngs.map(p => [...p] as [number, number]);
  nearMiss[1][0] += 1e-10;
  search.mockReturnValueOnce(found([])).mockReturnValueOnce(found([candidate(99, 0, nearMiss)]));
  const out = generateObjectProposals(graph, region, templates, options);
  expect(out.results).toHaveLength(0);
  expect(out.counts[0]).toMatchObject({status: 'complete', returned: 0, budgetExhausted: false, failures: {}});
  expect(out.counts[1]).toMatchObject({status: 'complete', returned: 1, budgetExhausted: false, failures: {exact_path_recovery: 1}});
});
