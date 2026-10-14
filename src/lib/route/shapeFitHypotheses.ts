import type { Placement } from './fit';
import { loopSamples, shapeSamples } from './loops';
import type { ShapeDef } from './shapes';

type XY = [number, number];
export interface ShapeFitHypothesis { placement: Placement; residual: number; shift: number; direction: 'forward' | 'reverse'; }

/** Multiple cyclic correspondences, using translation, rotation and positive
 * uniform scale only. Reversing BOTH sample orders preserves orientation:
 * no reflected template, nonuniform scaling, or score-based seam search.
 */
export function shapeFitHypotheses(loopXY: XY[], shape: ShapeDef, maxHypotheses = 8): ShapeFitHypothesis[] {
  const source = shapeSamples(shape), target = loopSamples(loopXY), all: ShapeFitHypothesis[] = [];
  if (source.length !== 48 || target.length !== 48) return [];
  for (const direction of ['forward', 'reverse'] as const) {
    const src = direction === 'forward' ? source : [...source].reverse();
    const dst = direction === 'forward' ? target : [...target].reverse();
    for (let shift = 0; shift < 48; shift++) {
      const paired = dst.map((_, i) => dst[(i + shift) % 48]);
      const sx = src.reduce((s, p) => s + p[0], 0) / 48, sy = src.reduce((s, p) => s + p[1], 0) / 48;
      const tx = paired.reduce((s, p) => s + p[0], 0) / 48, ty = paired.reduce((s, p) => s + p[1], 0) / 48;
      let dot = 0, cross = 0, sourceEnergy = 0, targetEnergy = 0;
      for (let i = 0; i < 48; i++) {
        const x = src[i][0] - sx, y = src[i][1] - sy, X = paired[i][0] - tx, Y = paired[i][1] - ty;
        dot += x * X + y * Y; cross += x * Y - y * X;
        sourceEnergy += x * x + y * y; targetEnergy += X * X + Y * Y;
      }
      if (!(sourceEnergy > 0 && targetEnergy > 0)) continue;
      const scale = Math.hypot(dot, cross) / sourceEnergy, angle = Math.atan2(cross, dot);
      if (!(scale > 0 && Number.isFinite(scale))) continue;
      all.push({ placement: { cx: tx - scale * (sx * Math.cos(angle) - sy * Math.sin(angle)), cy: ty - scale * (sx * Math.sin(angle) + sy * Math.cos(angle)), scale, rotDeg: angle * 180 / Math.PI }, residual: Math.max(0, targetEnergy - (dot * dot + cross * cross) / sourceEnergy) / targetEnergy, shift, direction });
    }
  }
  all.sort((a, b) => a.residual - b.residual || a.shift - b.shift || a.direction.localeCompare(b.direction));
  const selected: ShapeFitHypothesis[] = [];
  for (const h of all) {
    const p = h.placement;
    const similar = selected.some(s => {
      const q = s.placement, rotation = Math.abs(((p.rotDeg - q.rotDeg + 540) % 360) - 180);
      return rotation < 8 && Math.hypot(p.cx - q.cx, p.cy - q.cy) < .02 * Math.max(p.scale, q.scale) && Math.abs(Math.log(p.scale / q.scale)) < .02;
    });
    if (!similar) selected.push(h);
    if (selected.length >= Math.max(1, maxHypotheses)) break;
  }
  return selected;
}
