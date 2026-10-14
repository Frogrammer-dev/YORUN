import { DistanceField, placeShape, type Placement, type Region } from './fit';
import type { RoadGraph } from './graph';
import { resample, type ShapeDef } from './shapes';

/** Frozen proposal policy: geometry proposes; distance field only ranks. */
export const ROAD_GEOMETRY_SEED_PARAMS = { version: 3, minChain: 80, straightRatio: .96, junctionContinuationDeg: 10, headingBin: 5, headings: 4, supports: 40, seeds: 48, minSpacing: 60, angleTolerance: 8, aspectTolerance: .15 } as const;
export function roadGeometrySeeds(g: RoadGraph, shape: ShapeDef, region: Region) {
  const P = ROAD_GEOMETRY_SEED_PARAMS, visited = new Set<string>();
  const chains: Array<{ a: number; b: number; length: number; heading: number; nodes: number[] }> = [];
  const key = (a: number, b: number) => a < b ? `${a}:${b}` : `${b}:${a}`;
  const degree = (v: number) => g.adjStart[v + 1] - g.adjStart[v];
  const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  for (let a = 0; a < g.n; a++) for (let e = g.adjStart[a]; e < g.adjStart[a + 1]; e++) {
    const first = g.adjTo[e]; if (visited.has(key(a, first))) continue;
    // Junction-origin paths first; residual pure degree-2 cycles are harmless rejects.
    if (degree(a) === 2 && degree(first) !== 2) continue;
    let prev = a, b = first, length = g.adjLen[e]; const nodes = [a, first]; visited.add(key(a, first));
    while (b !== a) {
      const incoming = Math.atan2(g.y[b] - g.y[prev], g.x[b] - g.x[prev]);
      const continuations: number[] = [];
      for (let ei = g.adjStart[b]; ei < g.adjStart[b + 1]; ei++) {
        const v = g.adjTo[ei]; if (v === prev) continue;
        const outgoing = Math.atan2(g.y[v] - g.y[b], g.x[v] - g.x[b]);
        const delta = Math.abs(Math.atan2(Math.sin(outgoing - incoming), Math.cos(outgoing - incoming))) * 180 / Math.PI;
        if (degree(b) === 2 || delta <= P.junctionContinuationDeg) continuations.push(ei);
      }
      if (continuations.length !== 1) break;
      const nextEdge = continuations[0], next = g.adjTo[nextEdge];
      if (visited.has(key(b, next))) break;
      visited.add(key(b, next)); length += g.adjLen[nextEdge]; prev = b; b = next; nodes.push(next);
    }
    const chord = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]);
    if (length < P.minChain || chord / length < P.straightRatio || !inside(g.x[a], g.y[a]) || !inside(g.x[b], g.y[b])) continue;
    const heading = (Math.atan2(g.y[b] - g.y[a], g.x[b] - g.x[a]) * 180 / Math.PI + 180) % 180;
    chains.push({ a, b, length, heading, nodes });
  }
  const bins = new Map<number, number>();
  for (const c of chains) { const bin = Math.round(c.heading / P.headingBin) * P.headingBin % 180; bins.set(bin, (bins.get(bin) ?? 0) + c.length); }
  const headings = [...bins].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(b => b[0]).filter((a, i, all) => !all.slice(0, i).some(b => Math.min(Math.abs(a - b), 180 - Math.abs(a - b)) < 10)).slice(0, P.headings);
  const field = new DistanceField(g, region, 12), samples = resample(shape.points, 64), proposals: Array<{ placement: Placement; surrogate: number; heading: number; supports: number[] }> = [];
  let finiteSupportRejected = 0, finiteSupportAccepted = 0, aspectRejected = 0, nominalLengthRejected = 0, templateOutsideRejected = 0;
  for (const heading of headings) {
    const r = heading * Math.PI / 180, co = Math.cos(r), si = Math.sin(r);
    const projected = chains.map((c, index) => {
      const u1 = g.x[c.a] * co + g.y[c.a] * si, u2 = g.x[c.b] * co + g.y[c.b] * si;
      const v1 = -g.x[c.a] * si + g.y[c.a] * co, v2 = -g.x[c.b] * si + g.y[c.b] * co;
      const delta = Math.min(Math.abs(c.heading - heading), 180 - Math.abs(c.heading - heading));
      return { ...c, index, delta, u: (u1 + u2) / 2, v: (v1 + v2) / 2, umin: Math.min(u1, u2), umax: Math.max(u1, u2), vmin: Math.min(v1, v2), vmax: Math.max(v1, v2) };
    });
    const horizontal = projected.filter(c => c.delta <= P.angleTolerance).sort((a, b) => b.length - a.length || a.index - b.index).slice(0, P.supports);
    const vertical = projected.filter(c => Math.abs(c.delta - 90) <= P.angleTolerance).sort((a, b) => b.length - a.length || a.index - b.index).slice(0, P.supports);
    for (let i = 0; i < horizontal.length; i++) for (let j = i + 1; j < horizontal.length; j++) {
      const a = horizontal[i], b = horizontal[j], spacing = Math.abs(a.v - b.v); if (spacing < P.minSpacing) continue;
      const vmid = (a.v + b.v) / 2;
      for (let k = 0; k < vertical.length; k++) for (let l = k + 1; l < vertical.length; l++) {
        const c = vertical[k], d = vertical[l], width = Math.abs(c.u - d.u); if (width < P.minSpacing) continue;
        // All four finite chords must reach their projected intersections (80m tolerance).
        if ([c, d].some(v => v.u < Math.max(a.umin, b.umin) - 80 || v.u > Math.min(a.umax, b.umax) + 80 || Math.min(a.v, b.v) < v.vmin - 80 || Math.max(a.v, b.v) > v.vmax + 80)) { finiteSupportRejected++; continue; }
        finiteSupportAccepted++;
        const umid = (c.u + d.u) / 2;
        for (const rotation of [heading, heading + 90, heading + 180, heading + 270]) {
          const phi = (rotation - heading) * Math.PI / 180;
          const ys = shape.points.map(([x, y]) => x * Math.sin(phi) + y * Math.cos(phi)), span = Math.max(...ys) - Math.min(...ys);
          const xs = shape.points.map(([x, y]) => x * Math.cos(phi) - y * Math.sin(phi)), xspan = Math.max(...xs) - Math.min(...xs);
          if (span <= 0) continue;
          const yscale = spacing / span, xscale = width / xspan;
          if (Math.abs(xscale / yscale - 1) > P.aspectTolerance) { aspectRejected++; continue; }
          const scale = (xscale + yscale) / 2;
          if (scale * shape.perimeter < 2000 || scale * shape.perimeter > 8000) { nominalLengthRejected++; continue; }
          const placement = { cx: umid * co - vmid * si, cy: umid * si + vmid * co, scale, rotDeg: rotation };
          if (!placeShape(shape.points, placement).every(([x, y]) => inside(x, y))) { templateOutsideRejected++; continue; }
          const ds = placeShape(samples, placement).map(([x, y]) => field.get(x, y));
          proposals.push({ placement, surrogate: (ds.reduce((s, d) => s + d, 0) / ds.length + .15 * Math.max(...ds)) / scale, heading, supports: [a.index, b.index, c.index, d.index] });
        }
      }
    }
  }
  proposals.sort((a, b) => a.surrogate - b.surrogate || a.placement.cx - b.placement.cx || a.placement.cy - b.placement.cy || a.placement.rotDeg - b.placement.rotDeg);
  const selected: typeof proposals = [];
  for (const p of proposals) {
    if (selected.some(q => Math.hypot(p.placement.cx - q.placement.cx, p.placement.cy - q.placement.cy) < .07 * p.placement.scale && Math.abs(p.placement.scale / q.placement.scale - 1) < .08 && Math.abs(p.placement.rotDeg - q.placement.rotDeg) < 10)) continue;
    selected.push(p); if (selected.length === P.seeds) break;
  }
  return { seeds: selected, supportChains: chains, diagnostics: { chains: chains.length, headings, proposals: proposals.length, selected: selected.length, finiteSupportRejected, finiteSupportAccepted, aspectRejected, nominalLengthRejected, templateOutsideRejected }, params: P };
}
