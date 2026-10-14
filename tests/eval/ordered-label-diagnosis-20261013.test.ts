import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { evaluatePath, placeShape, type RouteCandidate } from '@/lib/route/fit';
import { project } from '@/lib/route/graph';
import { graphFromOverpass, type BBox } from '@/lib/route/osm';
import { orderedContourPath } from '@/lib/route/orderedContourPath';
import { SHAPE_BY_ID, type ShapeId } from '@/lib/route/shapes';
import { orderedContourPathObserved } from './ordered-contour-observer';

it.skipIf(!process.env.ORDERED_LABEL_DIAGNOSIS)('observes length-resource collisions without changing single-label search', () => {
  const out = path.resolve('eval/recognition/route-improvement/ordered-label-diagnosis-20261013'); mkdirSync(out, { recursive: true });
  const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const corePath = 'src/lib/route/orderedContourPath.ts', observerPath = 'tests/eval/ordered-contour-observer.ts', core = readFileSync(corePath), observer = readFileSync(observerPath);
  const stripped = observer.toString().replaceAll("from '@/lib/route/", "from './").replace('export function orderedContourPathObserved(', 'export function orderedContourPath(').replace('options:OrderedContourOptions,observe:(event:Record<string,number>)=>void){', 'options:OrderedContourOptions){').replace('observe({kind:0,state:next,proposedCost:c,storedCost:cost[next],proposedLength:len,storedLength:length[next],accepted:+(c<cost[next]),minMeters});', '').replace('observe({kind:1,state:s,phase,bins,node,start,length:length[s],cost:c,minMeters});', '');
  expect(stripped).toBe(core.toString());
  const inputFile = 'eval/recognition/route-improvement/offline-cascade-20261013/results.json', input = readFileSync(inputFile), rows = JSON.parse(input.toString()).cases as Array<{ caseId: string; candidate: RouteCandidate; bbox: BBox; sourceHash: string }>;
  const codeFiles = [corePath, observerPath, 'tests/eval/ordered-label-diagnosis-20261013.test.ts', 'src/lib/route/fit.ts', 'src/lib/route/graph.ts', 'src/lib/route/osm.ts', 'src/lib/route/shapes.ts'];
  const codeHashes = Object.fromEntries(codeFiles.map(f => { const b = readFileSync(f); writeFileSync(path.join(out, `${path.basename(f)}.source`), b); return [f, hash(b)]; }));
  const protocol = { inputHash: hash(input), codeHashes, observerLiteralIdentity: true, originalParameters: { bins: [32, 64], reverse: [false, true], radiusFraction: .16, normalizedCost: true, guideWeight: 3, maxExpanded: 400000 }, latestPlacementPositiveControlOnly: true, noAutomaticGainClaim: true, noHoldout: true };
  writeFileSync(path.join(out, 'protocol-before-run.json'), JSON.stringify(protocol, null, 2));
  const cases = [];
  for (const row of rows) {
    const road = readFileSync(`eval/recognition/llm-routes-20261010/${row.caseId.split('-')[0]}-roads.json`); expect(hash(road)).toBe(row.sourceHash);
    const g = graphFromOverpass(JSON.parse(road.toString()), row.bbox, { detail: 'simple', excludeSteps: true }), shape = SHAPE_BY_ID[row.candidate.shapeId as ShapeId], p = row.candidate.placement;
    const [minX, minY] = project(g.origin, row.bbox.south, row.bbox.west), [maxX, maxY] = project(g.origin, row.bbox.north, row.bbox.east), region = { minX, minY, maxX, maxY }, first = placeShape(shape.points, p)[0], start = g.nodeIndex.nearest(first[0], first[1], p.scale * .16);
    for (const bins of [32, 64]) for (const reverse of [false, true]) {
      const options = { bins, reverse, guideWeight: 3, radiusFraction: .16, normalizedCost: true, expectedRoadMeters: row.candidate.lengthMeters, maxExpanded: 400000 };
      let updateAttempts = 0, rejectedLongerByCheaperShorter = 0, acceptedShorterOverLonger = 0, crossingMinRejected = 0, finalStartBelowMin = 0, finalStartValid = 0, maxRejectedLengthDifference = 0, minClosedLength = Infinity, maxClosedLength = 0;
      const witnesses: Array<Record<string, number>> = [], observe = (e: Record<string, number>) => {
        if (e.kind === 0) {
          updateAttempts++;
          if (!e.accepted && Number.isFinite(e.storedCost) && e.proposedCost >= e.storedCost && e.proposedLength > e.storedLength + 1e-3) {
            rejectedLongerByCheaperShorter++; maxRejectedLengthDifference = Math.max(maxRejectedLengthDifference, e.proposedLength - e.storedLength);
            if (e.proposedLength >= 3000 && e.storedLength < 3000) { crossingMinRejected++; if (witnesses.length < 5) witnesses.push(e); }
          }
          if (e.accepted && Number.isFinite(e.storedCost) && e.proposedLength + 1e-3 < e.storedLength) acceptedShorterOverLonger++;
        } else if (e.phase === bins && e.node === start) {
          minClosedLength = Math.min(minClosedLength, e.length); maxClosedLength = Math.max(maxClosedLength, e.length);
          if (e.length < 3000) finalStartBelowMin++; else finalStartValid++;
        }
      };
      const began = Date.now(), original = orderedContourPath(g, shape, p, region, start, options), observed = orderedContourPathObserved(g, shape, p, region, start, options, observe);
      expect(observed).toEqual(original); expect(hash(readFileSync(corePath))).toBe(codeHashes[corePath]);
      const evaluation = observed.path ? evaluatePath(g, shape, p, observed.path, 3000, 8000) : null;
      const output = { caseId: row.caseId, bins, reverse, updateAttempts, rejectedLongerByCheaperShorter, acceptedShorterOverLonger, crossingMinRejected, finalStartBelowMin, finalStartValid, maxRejectedLengthDifference, minClosedLength: Number.isFinite(minClosedLength) ? minClosedLength : null, maxClosedLength, expanded: observed.expanded, maxExpandedReached: observed.expanded >= 400000, pathFound: !!observed.path, evaluation, witnesses, exactOriginalReturnIdentity: true, elapsedMs: Date.now() - began };
      cases.push(output); writeFileSync(path.join(out, `${row.caseId}-${bins}-${reverse}.json`), JSON.stringify(output, null, 2));
    }
  }
  expect(cases).toHaveLength(48);
  const summary = { trials: cases.length, pathsFound: cases.filter(c => c.pathFound).length, capped: cases.filter(c => c.maxExpandedReached).length, rejectedLongerByCheaperShorter: cases.reduce((s, c) => s + c.rejectedLongerByCheaperShorter, 0), crossingMinRejected: cases.reduce((s, c) => s + c.crossingMinRejected, 0), finalStartBelowMin: cases.reduce((s, c) => s + c.finalStartBelowMin, 0), acceptedShorterOverLonger: cases.reduce((s, c) => s + c.acceptedShorterOverLonger, 0), elapsedMs: cases.reduce((s, c) => s + c.elapsedMs, 0) };
  writeFileSync(path.join(out, 'results.json'), JSON.stringify({ protocol, summary, cases }, null, 2)); console.log(JSON.stringify(summary));
}, 1800000);
