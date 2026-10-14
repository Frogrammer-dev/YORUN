import type { Region } from './fit';
import type { RoadGraph } from './graph';
import { maximalRoadCorridors, MAXIMAL_CORRIDOR_PARAMS, type CorridorTrace } from './roadCorridorDecomposition';

export const CLIPPED_CORRIDOR_PARAMS = { ...MAXIMAL_CORRIDOR_PARAMS, insideExistingNodeRunsOnly: true, interpolation: false, cornerConnectors: false } as const;
/** Preserve actual inside-node portions; never insert an intersection at the bbox boundary. */
export function clippedRoadCorridors(g: RoadGraph, region: Region) {
  const traces: CorridorTrace[] = [], original = maximalRoadCorridors(g, region, t => traces.push(t));
  const chains: typeof original.chains = []; let outsideRawChains = 0, clippedRuns = 0, acceptedClippedRuns = 0, tooShortRuns = 0, notStraightRuns = 0, boundaryEdgesExcluded = 0;
  const inside = (v: number) => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY;
  const append = (input: number[], clipped: boolean) => {
    if (input.length < 2) { if (clipped) tooShortRuns++; return; }
    const nodes = input.slice(); let length = 0;
    for (let i = 1; i < nodes.length; i++) {
      let found = false; const a = nodes[i - 1], b = nodes[i];
      for (let ei = g.adjStart[a]; ei < g.adjStart[a + 1]; ei++) if (g.adjTo[ei] === b) { length += g.adjLen[ei]; found = true; break; }
      if (!found) throw new Error('Corridor clipping attempted a nonexistent edge');
    }
    if (length < MAXIMAL_CORRIDOR_PARAMS.minChain) { if (clipped) tooShortRuns++; return; }
    const a = nodes[0], b = nodes.at(-1)!;
    if (Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]) / length < MAXIMAL_CORRIDOR_PARAMS.straightRatio) { if (clipped) notStraightRuns++; return; }
    if (g.x[a] > g.x[b] || (g.x[a] === g.x[b] && g.y[a] > g.y[b])) nodes.reverse();
    const from = nodes[0], to = nodes.at(-1)!, heading = (Math.atan2(g.y[to] - g.y[from], g.x[to] - g.x[from]) * 180 / Math.PI + 180) % 180;
    chains.push({ a: from, b: to, length, heading, nodes }); if (clipped) acceptedClippedRuns++;
  };
  for (const trace of traces) {
    if (trace.reason === 'circular') continue;
    if (trace.nodes.every(inside)) { if (trace.reason === 'selected') append(trace.nodes, false); continue; }
    outsideRawChains++;
    for (let i = 1; i < trace.nodes.length; i++) if (!inside(trace.nodes[i - 1]) || !inside(trace.nodes[i])) boundaryEdgesExcluded++;
    let run: number[] = [];
    const flush = () => { if (run.length) { clippedRuns++; append(run, true); run = []; } };
    for (const v of trace.nodes) { if (inside(v)) run.push(v); else flush(); } flush();
  }
  chains.sort((a, b) => g.x[a.a] - g.x[b.a] || g.y[a.a] - g.y[b.a] || g.x[a.b] - g.x[b.b] || g.y[a.b] - g.y[b.b]);
  return { chains, params: CLIPPED_CORRIDOR_PARAMS, diagnostics: { original: original.diagnostics, outsideRawChains, clippedRuns, acceptedClippedRuns, tooShortRuns, notStraightRuns, boundaryEdgesExcluded, selectedChains: chains.length, originalSelectedPreserved: original.chains.length } };
}
