import type { Region } from './fit';
import type { RoadGraph } from './graph';
import type { clippedRoadCorridors } from './clippedRoadCorridors';

export const ROAD_CONNECTOR_CYCLE_PARAMS = { radius: 60, maxConnectorMeters: 120, routingCalls: 512, maxExpanded: 18000, cycleCap: 48, parallelDeg: 10, perpendicularDeg: 10, selection: 'geometry key before quality', localCircleOnly: true } as const;
type Chains = ReturnType<typeof clippedRoadCorridors>['chains'];
export function corridorIntersection(g: RoadGraph, a: Chains[number], b: Chains[number]): [number, number] | null {
  const ax = g.x[a.a], ay = g.y[a.a], dx = g.x[a.b] - ax, dy = g.y[a.b] - ay, bx = g.x[b.a], by = g.y[b.a], ex = g.x[b.b] - bx, ey = g.y[b.b] - by, det = dx * ey - dy * ex;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((bx - ax) * ey - (by - ay) * ex) / det; return [ax + t * dx, ay + t * dy];
}

export function roadConnectorCyclesDiagnostic(g: RoadGraph, chains: Chains, region: Region) {
  const P = ROAD_CONNECTOR_CYCLE_PARAMS, angle = (a: number, b: number) => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)), sets = chains.map(c => new Set(c.nodes));
  const inside = (v: number) => g.x[v] >= region.minX && g.x[v] <= region.maxX && g.y[v] >= region.minY && g.y[v] <= region.maxY;
  const pairKey = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const links = new Map<string, { a: number; b: number; path: number[]; shared: boolean }>();
  const pending: Array<{ a: number; b: number; center: [number, number]; starts: number[]; targets: number[] }> = [];
  let multipleSharedRejected = 0, noLocalEndpoints = 0, routingCalls = 0, expandedTotal = 0, routingFailed = 0, routedLinks = 0;
  for (let a = 0; a < chains.length; a++) for (let b = a + 1; b < chains.length; b++) {
    if (Math.abs(angle(chains[a].heading, chains[b].heading) - 90) > P.perpendicularDeg) continue;
    const common = chains[a].nodes.filter(v => sets[b].has(v));
    if (common.length === 1) { links.set(pairKey(a, b), { a, b, path: common, shared: true }); continue; }
    if (common.length > 1) { multipleSharedRejected++; continue; }
    const center = corridorIntersection(g, chains[a], chains[b]); if (!center) continue;
    const local = (v: number) => inside(v) && Math.hypot(g.x[v] - center[0], g.y[v] - center[1]) <= P.radius;
    const starts = chains[a].nodes.filter(local), targets = chains[b].nodes.filter(local);
    if (!starts.length || !targets.length) { noLocalEndpoints++; continue; }
    pending.push({ a, b, center, starts, targets });
  }
  // Pair order comes from coordinate-sorted maximal chains, without quality or saved routes.
  for (const p of pending.slice(0, P.routingCalls)) {
    routingCalls++; const target = new Set(p.targets), dist = new Map<number, number>(), prev = new Map<number, number>(), open = new Set(p.starts), closed = new Set<number>();
    p.starts.forEach(v => { dist.set(v, 0); prev.set(v, -1); }); let found = -1, expanded = 0;
    while (open.size) {
      let u = -1, best = Infinity;
      for (const v of open) if (dist.get(v)! < best || (dist.get(v) === best && (u < 0 || g.x[v] < g.x[u] || (g.x[v] === g.x[u] && g.y[v] < g.y[u])))) { u = v; best = dist.get(v)!; }
      open.delete(u); if (closed.has(u)) continue; closed.add(u);
      if (target.has(u)) { found = u; break; } if (++expanded > P.maxExpanded) break;
      for (let ei = g.adjStart[u]; ei < g.adjStart[u + 1]; ei++) {
        const v = g.adjTo[ei]; if (closed.has(v) || !inside(v) || Math.hypot(g.x[v] - p.center[0], g.y[v] - p.center[1]) > P.radius) continue;
        const next = best + Math.hypot(g.x[v] - g.x[u], g.y[v] - g.y[u]); if (next > P.maxConnectorMeters || next >= (dist.get(v) ?? Infinity)) continue;
        dist.set(v, next); prev.set(v, u); open.add(v);
      }
    }
    expandedTotal += expanded; if (found < 0) { routingFailed++; continue; }
    const path: number[] = []; for (let v = found; v !== -1; v = prev.get(v)!) path.push(v); path.reverse();
    links.set(pairKey(p.a, p.b), { a: p.a, b: p.b, path, shared: false }); routedLinks++;
  }
  const corner = (a: number, b: number) => { const link = links.get(pairKey(a, b)); if (!link) return null; const path = link.a === a ? link.path : link.path.slice().reverse(); return { start: path[0], end: path.at(-1)!, path }; };
  const segment = (c: number, a: number, b: number) => { const ns = chains[c].nodes, i = ns.indexOf(a), j = ns.indexOf(b); return i < j ? ns.slice(i, j + 1) : ns.slice(j, i + 1).reverse(); };
  const geometries = new Map<string, { nodes: number[]; usesConnector: boolean }>(); let totalCycles = 0, tooShort = 0, tooLong = 0, repeatedRejected = 0;
  for (let a = 0; a < chains.length; a++) for (let b = a + 1; b < chains.length; b++) {
    if (angle(chains[a].heading, chains[b].heading) > P.parallelDeg || chains[a].nodes.some(v => sets[b].has(v))) continue;
    const crosses = chains.map((_, c) => ({ c, ac: corner(a, c), bc: corner(b, c) })).filter(v => v.ac && v.bc);
    for (let i = 0; i < crosses.length; i++) for (let j = i + 1; j < crosses.length; j++) {
      const c = crosses[i], d = crosses[j]; if (angle(chains[c.c].heading, chains[d.c].heading) > P.parallelDeg || chains[c.c].nodes.some(v => sets[d.c].has(v))) continue;
      const ac = c.ac!, bc = c.bc!, ad = d.ac!, bd = d.bc!;
      const parts = [segment(a, ac.start, ad.start), ad.path, segment(d.c, ad.end, bd.end), bd.path.slice().reverse(), segment(b, bd.start, bc.start), bc.path, segment(c.c, bc.end, ac.end), ac.path.slice().reverse()];
      const nodes = [...parts[0], ...parts.slice(1).flatMap(ns => ns.slice(1))]; if (nodes.length < 4 || nodes[0] !== nodes.at(-1)) continue;
      totalCycles++; let length = 0, repeated = 0; const used = new Set<string>(), edgeKeys = [];
      for (let n = 1; n < nodes.length; n++) { const a = nodes[n - 1], b = nodes[n], len = Math.hypot(g.x[a] - g.x[b], g.y[a] - g.y[b]), k = pairKey(a, b); length += len; if (used.has(k)) repeated += len; used.add(k); edgeKeys.push(k); }
      if (length < 3000) { tooShort++; continue; } if (length > 8000) { tooLong++; continue; } if (repeated / length > .2) { repeatedRejected++; continue; }
      geometries.set(edgeKeys.sort().join('|'), { nodes, usesConnector: [ac, bc, ad, bd].some(v => v.path.length > 1) });
    }
  }
  return { diagnosticLinks: [...links.values()], candidates: [...geometries].sort((a, b) => a[0].localeCompare(b[0])).slice(0, P.cycleCap).map(([geometryKey, c]) => ({ geometryKey, ...c })), allGeometryKeysBeforeCap: [...geometries.keys()].sort(), diagnostics: { sharedLinks: links.size - routedLinks, pendingLocalPairs: pending.length, routingCalls, routingBudgetSkipped: Math.max(0, pending.length - P.routingCalls), expandedTotal, routingFailed, routedLinks, multipleSharedRejected, noLocalEndpoints, totalCycles, tooShort, tooLong, repeatedRejected, uniqueBeforeCap: geometries.size }, params: P };
}

