import { evaluatePath, placeShape, type Placement, type Region, type RouteCandidate } from '@/lib/route/fit';
import { hasEdge, type RoadGraph } from '@/lib/route/graph';
import type { ShapeDef } from '@/lib/route/shapes';

/** Coarse rank order is supplied by globalSearch; saved route poses are never added. */
export function selectRolloutPoses(seeds: readonly Placement[], region: Region, limit = 8) {
  const bins = new Set<string>(), selected: Placement[] = [], used = new Set<string>();
  const identity = (p: Placement) => JSON.stringify(p);
  for (const p of seeds) {
    const x = Math.max(0, Math.min(1, Math.floor(2 * (p.cx - region.minX) / (region.maxX - region.minX))));
    const y = Math.max(0, Math.min(1, Math.floor(2 * (p.cy - region.minY) / (region.maxY - region.minY))));
    const angle = ((p.rotDeg % 360) + 360) % 360;
    const bin = `${x}:${y}:${Math.floor(angle / 90)}`;
    if (bins.has(bin)) continue;
    bins.add(bin); selected.push(p); used.add(identity(p));
    if (selected.length === limit) return selected;
  }
  for (const p of seeds) {
    if (used.has(identity(p))) continue;
    selected.push(p); used.add(identity(p));
    if (selected.length === limit) break;
  }
  return selected;
}

export function rolloutStartPorts(g: RoadGraph, ports: readonly number[], shape: ShapeDef, p: Placement) {
  const [x, y] = placeShape(shape.points, p)[0];
  return ports.map(v => ({ v, distance: Math.hypot(g.x[v] - x, g.y[v] - y) }))
    .filter(entry => entry.distance <= p.scale * .16)
    .sort((a, b) => a.distance - b.distance || g.x[a.v] - g.x[b.v] || g.y[a.v] - g.y[b.v])
    .slice(0, 2).map(entry => entry.v);
}

export function rolloutPathAuditor(g: RoadGraph, shape: ShapeDef, region: Region) {
  const index = new Map<string, number[]>(), key = (lat: number, lon: number) => `${lat.toFixed(7)},${lon.toFixed(7)}`;
  for (let v = 0; v < g.n; v++) { const k = key(g.lat[v], g.lon[v]); index.set(k, [...(index.get(k) ?? []), v]); }
  const nodesFor = (c: RouteCandidate) => c.latlngs.map(([lat, lon]) => {
    const ids = index.get(key(lat, lon));
    if (ids?.length !== 1) throw new Error('Route coordinate does not map to one actual node');
    const v = ids[0];
    if (Math.abs(g.lat[v] - lat) > 1e-10 || Math.abs(g.lon[v] - lon) > 1e-10) throw new Error('Route coordinate changed');
    return v;
  });
  const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  const audit = (nodes: number[], placement: Placement) => {
    if (nodes.length < 4 || nodes[0] !== nodes.at(-1) || !nodes.every((v, i) => inside(g.x[v], g.y[v]) && (!i || hasEdge(g, nodes[i - 1], v)))) throw new Error('Invalid actual closed road path');
    if (!placeShape(shape.points, placement).every(([x, y]) => inside(x, y))) throw new Error('Original template placement outside region');
    const evaluated = evaluatePath(g, shape, placement, nodes, 3000, 8000);
    if (evaluated.lengthMeters < 3000 || evaluated.lengthMeters > 8000 || evaluated.repeatRatio > .2) throw new Error('Native route constraint failed');
    const raw = 100 * Math.exp(-evaluated.meanDev / (.08 * placement.scale) - Math.log1p(.03 * evaluated.zigzagPerKm) + Math.log(.55 + .45 * evaluated.featureCoverage) + evaluated.spikes * Math.log(.9));
    if (!Number.isFinite(raw)) throw new Error('Nonfinite native quality');
    return { evaluated, raw };
  };
  return { nodesFor, audit };
}
