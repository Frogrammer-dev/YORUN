import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { hasEdge, project } from '@/lib/route/graph';
import { evaluatePath, placeShape, type Placement } from '@/lib/route/fit';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { pairPhaseZero } from '@/lib/route/pairSegmentRepair';

type State = { valid: boolean; path: number[]; placement: Placement; latlngs: [number, number][]; rawSimilarity: number; nativeMeters: number; projectedMeters: number; repeatRatio: number; projectedRepeatRatio: number; edgeHash?: string };
type Arm = { mode: string; level?: number; output?: State; rounds?: Array<{ round: number; output: State }> };
type Item = { id: string; area: string; bbox: BBox; roadHash: string; shapeId: ShapeId; baseline: State; poseOnly?: Array<{ output: State }>; arms: Arm[] };
const base = 'eval/recognition/relation-generation-20261021';
const roads = 'eval/recognition/route-improvement/holdout';
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');

it.skipIf(!process.env.RELATION_AUDIT_RUN)('independently recomputes all six native-road cases and reports geometric, not semantic, improvements', () => {
  const runs = process.env.RELATION_AUDIT_RUN!.split(',');
  for (const run of runs) {
    expect(run).toMatch(/^[a-z0-9-]+$/);
    const file = `${base}/${run}/results.json`, bytes = readFileSync(file);
    const data = JSON.parse(bytes.toString()) as { spec: { denominator: number; source?: string; sourceSha256?: string; codeHashes: Record<string, string> }; cases: Item[] };
    expect(data.cases).toHaveLength(6); expect(data.spec.denominator).toBe(6);
    expect(new Set(data.cases.map(c => c.id)).size).toBe(6);
    expect(data.cases.map(c => c.id).sort()).toEqual(['daejeon-dunsan', 'daegu-center', 'seoul-songpa'].flatMap(area => ['animal', 'object'].map(family => `${area}-${family}`)).sort());
    if (run !== 'trial-v1') {
      const original = JSON.parse(readFileSync(`${base}/trial-v1/results.json`, 'utf8')) as { cases: Item[] };
      for (const item of data.cases) {
        const sourceCase = original.cases.find(c => c.id === item.id)!;
        expect(item.shapeId).toBe(sourceCase.shapeId); expect(item.bbox).toEqual(sourceCase.bbox);
        expect(item.baseline.path).toEqual(sourceCase.baseline.path); expect(item.baseline.placement).toEqual(sourceCase.baseline.placement);
      }
    }
    if (data.spec.sourceSha256) expect(hash(readFileSync(data.spec.source!))).toBe(data.spec.sourceSha256);
    const currentMismatch = [];
    for (const [source, sha] of Object.entries(data.spec.codeHashes)) {
      const stem = `${base}/${run}/sources/${source.replaceAll('/', '__')}`;
      const snapshot = [stem, `${stem}.source.txt`].find(f => existsSync(f));
      if (snapshot) expect(hash(readFileSync(snapshot)), snapshot).toBe(sha);
      if (hash(readFileSync(source)) !== sha) currentMismatch.push(source);
      if (['src/lib/route/fit.ts', 'src/lib/route/shapes.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts'].includes(source)) expect(hash(readFileSync(source)), source).toBe(sha);
    }
    const rows: Array<{ id: string; mode: string; level: number; rawSimilarity: number; baseline: number; edgeChanged: boolean; poseChanged: boolean; baselineAtPose: number; canonicalAtPose: number; edgeBetterAtFinalPose: boolean }> = [];
    for (const item of data.cases) {
      const raw = readFileSync(`${roads}/${item.area}-roads.json`); expect(hash(raw)).toBe(item.roadHash);
      const g = graphFromOverpass(JSON.parse(raw.toString()), item.bbox, { detail: 'simple', excludeSteps: true });
      const [minX, minY] = project(g.origin, item.bbox.south, item.bbox.west), [maxX, maxY] = project(g.origin, item.bbox.north, item.bbox.east);
      const shape = SHAPE_BY_ID[item.shapeId]; expect(shape).toBeDefined();
      const inside = (x: number, y: number) => x >= minX - 1e-7 && x <= maxX + 1e-7 && y >= minY - 1e-7 && y <= maxY + 1e-7;
      const score = (nodes: number[], p: Placement) => {
        const e = evaluatePath(g, shape, p, nodes, 3000, 8000);
        const q = e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
        return 100 * Math.exp(-q);
      };
      const check = (state: State) => {
        expect(state.valid).toBe(true); expect(state.path.length).toBeGreaterThanOrEqual(4);
        expect(state.path[0]).toBe(state.path.at(-1)); expect(state.latlngs).toHaveLength(state.path.length);
        let native = 0, projected = 0, repeated = 0, projectedRepeated = 0;
        const edges = new Set<string>();
        state.path.forEach((v, i) => {
          expect(Number.isInteger(v) && v >= 0 && v < g.n).toBe(true);
          expect(inside(g.x[v], g.y[v])).toBe(true); expect(state.latlngs[i]).toEqual([g.lat[v], g.lon[v]]);
          if (!i) return;
          const a = state.path[i - 1]; expect(hasEdge(g, a, v)).toBe(true);
          let length = NaN;
          for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === v) { length = g.adjLen[k]; break; }
          expect(Number.isFinite(length) && length >= 0).toBe(true);
          const d = Math.hypot(g.x[v] - g.x[a], g.y[v] - g.y[a]), key = a < v ? `${a}:${v}` : `${v}:${a}`;
          native += length; projected += d;
          if (edges.has(key)) { repeated += length; projectedRepeated += d; } edges.add(key);
        });
        expect(native).toBeGreaterThanOrEqual(3000); expect(native).toBeLessThanOrEqual(8000);
        expect(projected).toBeGreaterThanOrEqual(3000); expect(projected).toBeLessThanOrEqual(8000);
        expect(repeated / native).toBeLessThanOrEqual(.2); expect(projectedRepeated / projected).toBeLessThanOrEqual(.2);
        expect(state.nativeMeters).toBeCloseTo(native, 7); expect(state.projectedMeters).toBeCloseTo(projected, 7);
        expect(state.repeatRatio).toBeCloseTo(repeated / native, 10); expect(state.projectedRepeatRatio).toBeCloseTo(projectedRepeated / projected, 10);
        expect(Number.isFinite(state.placement.scale) && state.placement.scale > 0).toBe(true);
        expect(placeShape(shape.points, state.placement).every(([x, y]) => inside(x, y))).toBe(true);
        const rawScore = score(state.path, state.placement); expect(state.rawSimilarity).toBeCloseTo(rawScore, 8);
        const edgeHash = hash([...edges].sort().join(',')); if (state.edgeHash) expect(state.edgeHash).toBe(edgeHash);
        return { rawScore, edgeHash };
      };
      const initial = check(item.baseline);
      const initialCanonical = score(pairPhaseZero(g, shape, item.baseline.placement, item.baseline.path), item.baseline.placement);
      for (const control of item.poseOnly ?? []) {
        const value = check(control.output); expect(value.edgeHash).toBe(initial.edgeHash); expect(control.output.path).toEqual(item.baseline.path);
      }
      const arms = item.arms.flatMap(a => a.rounds ? a.rounds.map(r => ({ mode: a.mode, level: r.round, output: r.output })) : [{ mode: a.mode, level: a.level!, output: a.output! }]);
      for (const arm of arms) {
        const result = check(arm.output), p = arm.output.placement;
        const samePose = JSON.stringify(p) === JSON.stringify(item.baseline.placement);
        const changed = result.edgeHash !== initial.edgeHash;
        const baselineAtPose = score(item.baseline.path, p);
        const canonicalAtPose = score(pairPhaseZero(g, shape, p, item.baseline.path), p);
        expect(result.rawScore).toBeGreaterThanOrEqual(initial.rawScore - 1e-8);
        if (changed) expect(result.rawScore).toBeGreaterThanOrEqual(initialCanonical - 1e-8);
        if (changed && samePose) {
          expect(result.rawScore).toBeGreaterThan(baselineAtPose + 1e-8);
          expect(result.rawScore).toBeGreaterThan(canonicalAtPose + 1e-8);
        }
        if (!changed && samePose) expect(arm.output.path).toEqual(item.baseline.path);
        rows.push({ id: item.id, mode: arm.mode, level: arm.level, rawSimilarity: result.rawScore, baseline: initial.rawScore, edgeChanged: changed, poseChanged: !samePose, baselineAtPose, canonicalAtPose, edgeBetterAtFinalPose: changed && result.rawScore > Math.max(baselineAtPose, canonicalAtPose) + 1e-8 });
      }
    }
    const keys = [...new Set(rows.map(r => `${r.mode}|${r.level}`))];
    const summaries = keys.map(key => {
      const r = rows.filter(r => `${r.mode}|${r.level}` === key); expect(r).toHaveLength(6);
      return { key, denominator: 6, meanRaw: r.reduce((s, v) => s + v.rawSimilarity, 0) / 6, edgeChanged: r.filter(v => v.edgeChanged).length, poseChanged: r.filter(v => v.poseChanged).length, edgeBetterAtFinalPose: r.filter(v => v.edgeBetterAtFinalPose).length };
    });
    writeFileSync(`${base}/audit-${run}.json`, JSON.stringify({ status: 'PASS', resultSha256: hash(bytes), run, caseCount: 6, evaluatedStates: rows.length + 6, extraPoseControlStates: data.cases.reduce((n, c) => n + (c.poseOnly?.length ?? 0), 0), sourceCurrentMismatch: currentMismatch, summaries, rows, semanticValidation: false }, null, 2));
    console.log(JSON.stringify({ audit: run, status: 'PASS', evaluatedStates: rows.length + 6, summaries }));
  }
}, 300000);
