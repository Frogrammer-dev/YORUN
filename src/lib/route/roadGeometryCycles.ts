import type { RoadGraph } from './graph';
import type { roadGeometrySeeds } from './roadGeometrySeeds';

export const ROAD_GEOMETRY_CYCLE_PARAMS = { cycleCap: 48, parallelDeg: 10, perpendicularDeg: 10, minMeters: 3000, maxMeters: 8000, selection: 'deterministic geometry key before score' } as const;
/** Four corridor intersections require identical graph node IDs. No geometric bridges. */
export function roadGeometryCycles(g: RoadGraph, support: ReturnType<typeof roadGeometrySeeds>) {
  const chains = support.supportChains, sets = chains.map(c => new Set(c.nodes));
  const angle = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b));
  const common = (a: number, b: number) => chains[a].nodes.filter(v => sets[b].has(v));
  const segment = (c: number, a: number, b: number) => {
    const path = chains[c].nodes, i = path.indexOf(a), j = path.indexOf(b);
    return i < j ? path.slice(i, j + 1) : path.slice(j, i + 1).reverse();
  };
  const geometries = new Map<string, number[]>(); let connectedRectangles = 0, tooShort = 0, tooLong = 0, minObservedLength = Infinity, maxObservedLength = 0;
  for (let a = 0; a < chains.length; a++) for (let b = a + 1; b < chains.length; b++) {
    if (angle(chains[a].heading, chains[b].heading) > 10 || common(a, b).length) continue;
    const crosses: Array<{ c: number; va: number; vb: number }> = [];
    for (let c = 0; c < chains.length; c++) {
      if (Math.abs(angle(chains[a].heading, chains[c].heading) - 90) > 10) continue;
      const ca = common(a, c), cb = common(b, c); if (ca.length !== 1 || cb.length !== 1) continue;
      crosses.push({ c, va: ca[0], vb: cb[0] });
    }
    for (let i = 0; i < crosses.length; i++) for (let j = i + 1; j < crosses.length; j++) {
      const c = crosses[i], d = crosses[j]; if (angle(chains[c.c].heading, chains[d.c].heading) > 10 || common(c.c, d.c).length) continue;
      if (new Set([c.va, c.vb, d.va, d.vb]).size !== 4) continue;
      const nodes = [...segment(a, c.va, d.va), ...segment(d.c, d.va, d.vb).slice(1), ...segment(b, d.vb, c.vb).slice(1), ...segment(c.c, c.vb, c.va).slice(1)];
      let length = 0;
      for (let n = 1; n < nodes.length; n++) { const a = nodes[n - 1], b = nodes[n]; for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) if (g.adjTo[e] === b) { length += g.adjLen[e]; break; } }
      connectedRectangles++; minObservedLength = Math.min(minObservedLength, length); maxObservedLength = Math.max(maxObservedLength, length);
      if (length < 3000) { tooShort++; continue; } if (length > 8000) { tooLong++; continue; }
      const key = nodes.slice(1).map((v, n) => { const u = nodes[n]; return u < v ? `${u}:${v}` : `${v}:${u}`; }).sort().join('|');
      geometries.set(key, nodes);
    }
  }
  const candidates = [...geometries].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 48).map(([geometryKey, nodes]) => ({ geometryKey, nodes }));
  return { candidates, diagnostics: { connectedRectangles, connectedCountIncludesDuplicateCycles: true, tooShort, tooLong, minObservedLength: Number.isFinite(minObservedLength) ? minObservedLength : null, maxObservedLength, uniqueValidLengthCycles: geometries.size, selected: candidates.length }, params: ROAD_GEOMETRY_CYCLE_PARAMS };
}
