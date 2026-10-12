import { evaluatePath, placeShape, type Evaluated, type Placement, type Region } from "./fit";
import type { RoadGraph } from "./graph";
import type { ShapeDef } from "./shapes";
import type { Budget } from "./budget";

/** Fit an unchanged template to an unchanged road path with similarity transforms only. */
export function refinePathPlacement(
  g: RoadGraph,
  shape: ShapeDef,
  initial: Placement,
  path: number[],
  region: Region,
  minMeters: number,
  maxMeters: number,
  maxEvaluations = 160,
  budget?: Budget,
): { placement: Placement; evaluated: Evaluated; evaluations: number } | null {
  const inside = (x: number, y: number) => x >= region.minX && x <= region.maxX && y >= region.minY && y <= region.maxY;
  if (path.length < 4 || path[0] !== path[path.length-1] || path.some(v => !inside(g.x[v], g.y[v]))) return null;
  let evaluations = 0;
  const check = (p: Placement) => {
    if ((budget && !budget.ok()) || evaluations >= maxEvaluations || p.scale < initial.scale * .8 || p.scale > initial.scale * 1.2 ||
      Math.abs(p.cx - initial.cx) > initial.scale * .2 || Math.abs(p.cy - initial.cy) > initial.scale * .2 ||
      Math.abs(p.rotDeg - initial.rotDeg) > 30 || !placeShape(shape.points, p).every(([x,y]) => inside(x,y))) return null;
    evaluations++;
    budget?.spend();
    const e = evaluatePath(g, shape, p, path, minMeters, maxMeters);
    if (e.lengthMeters < minMeters || e.lengthMeters > maxMeters || e.repeatRatio > .2) return null;
    return e;
  };
  // Negative log of the unchanged, unrounded similarity expression. Lower is better.
  const objective = (e: Evaluated, p: Placement) => e.meanDev / (.08 * p.scale) + Math.log1p(.03 * e.zigzagPerKm) - Math.log(.55 + .45 * e.featureCoverage) - e.spikes * Math.log(.9);
  let bestP = { ...initial };
  let best = check(bestP);
  if (!best) return null;
  let bestScore = objective(best,bestP);
  for (const fraction of [.06,.03,.015,.0075,.00375]) {
    for (let round = 0; round < 3 && evaluations < maxEvaluations; round++) {
      let improved = false;
      const origin = bestP;
      for (const [dx,dy,ds,dr] of [[1,0,0,0],[-1,0,0,0],[0,1,0,0],[0,-1,0,0],[0,0,1,0],[0,0,-1,0],[0,0,0,1],[0,0,0,-1]]) {
        const p = {cx:origin.cx+dx*fraction*initial.scale,cy:origin.cy+dy*fraction*initial.scale,scale:origin.scale*(1+ds*fraction),rotDeg:origin.rotDeg+dr*fraction*100};
        const e = check(p);
        if (!e) continue;
        const score = objective(e,p);
        if (score < bestScore - 1e-7) {best=e;bestP=p;bestScore=score;improved=true;}
      }
      if (!improved) break;
    }
  }
  return {placement:bestP,evaluated:{...best,fit:bestP},evaluations};
}
