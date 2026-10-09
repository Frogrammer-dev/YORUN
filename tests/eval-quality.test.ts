// 코스 품질 평가 도구 (EVAL_DIR 환경변수가 있을 때만 실행).
// 알고리즘 자체 점수와 별개로: 불필요한 꺾임(지그재그), 뾰족한 특징점(귀·꼭짓점) 보존, 95% 이탈을 잰다.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { findRoutes, findThinSpikes, placeShape, type RouteCandidate } from "@/lib/route/fit";
import { pointSegDist, project, type Origin } from "@/lib/route/graph";
import { ROAD_RULES, graphFromOverpass, type GraphOptions } from "@/lib/route/osm";
import { TUNING } from "@/lib/route/fit";
import { SHAPES, SHAPE_BY_ID, resample, type ShapeId } from "@/lib/route/shapes";
import { rdpIndices } from "@/lib/art/rdp";

const AREAS = [
  { name: "gwangalli", file: "busan.json", bbox: { south: 35.143, west: 129.1, north: 35.166, east: 129.128 } },
  { name: "seomyeon", file: "seomyeon.json", bbox: { south: 35.145, west: 129.048, north: 35.17, east: 129.076 } },
  { name: "gangnam", file: "gangnam.json", bbox: { south: 37.49, west: 127.02, north: 37.515, east: 127.051 } },
];

type XY = [number, number];
const turnCount = (pts: XY[], tol: number, minDeg: number) => {
  const keep = rdpIndices(pts, tol);
  let n = 0;
  for (let k = 1; k < keep.length - 1; k++) {
    const [a, b, c] = [pts[keep[k - 1]], pts[keep[k]], pts[keep[k + 1]]];
    let d = ((Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) >= minDeg) n++;
  }
  return n;
};
const distToLine = (p: XY, line: XY[]) => {
  let b = Infinity;
  for (let i = 1; i < line.length; i++) b = Math.min(b, pointSegDist(p[0], p[1], line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]));
  return b;
};

export function quality(c: RouteCandidate, origin: Origin) {
  const shape = SHAPE_BY_ID[c.shapeId as ShapeId];
  const p = c.placement;
  const route = c.latlngs.map(([la, lo]) => project(origin, la, lo) as XY);
  const outline = placeShape(shape.points, p);
  const km = c.lengthMeters / 1000;
  const routeTurns = turnCount(route, 10, 45);
  const spikes = Math.max(0, turnCount(route, 10, 150) - turnCount(outline, p.scale * 0.01, 150)) + findThinSpikes(route).length;
  const shapeTurns = turnCount(outline, p.scale * 0.01, 45);
  // 뾰족한 특징점: 외곽선에서 45° 이상 꺾이는 꼭짓점
  const corners: XY[] = [];
  const pts = shape.points.slice(0, -1);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], cc = pts[(i + 1) % pts.length];
    let d = ((Math.atan2(cc[1] - b[1], cc[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) >= 45) corners.push(placeShape([b], p)[0]);
  }
  const hit = corners.filter((v) => distToLine(v, route) <= 0.08 * p.scale).length;
  const devs = resample(outline, 150).map((q) => distToLine(q as XY, route)).sort((x, y) => x - y);
  return {
    excessTurnsPerKm: Math.max(0, routeTurns - shapeTurns) / km,
    cornerCoverage: corners.length ? hit / corners.length : 1,
    p95: devs[Math.floor(devs.length * 0.95)] / p.scale,
    spikes,
  };
}

it.skipIf(!process.env.EVAL_DIR)("품질 평가", () => {
  const dir = process.env.EVAL_DIR!;
  const label = process.env.EVAL_LABEL ?? "run";
  const opts: GraphOptions = JSON.parse(process.env.EVAL_GRAPH ?? '{"excludeSteps":true}');
  Object.assign(TUNING, JSON.parse(process.env.EVAL_TUNING ?? "{}"));
  Object.assign(ROAD_RULES, JSON.parse(process.env.EVAL_RULES ?? "{}"));
  const summary: string[] = [];
  const out: Record<string, unknown> = {};
  let sumJag = 0, sumCov = 0, sumP95 = 0, sumSpk = 0, n = 0;
  for (const a of AREAS) {
    const json = JSON.parse(readFileSync(join(dir, a.file), "utf8"));
    const g = graphFromOverpass(json, a.bbox, opts);
    const [x0, y0] = project(g.origin, a.bbox.south, a.bbox.west);
    const [x1, y1] = project(g.origin, a.bbox.north, a.bbox.east);
    const t = Date.now();
    const from = process.env.EVAL_FROM ? JSON.parse(readFileSync(join(dir, process.env.EVAL_FROM), "utf8"))[a.name] : null;
    const r = from
      ? { candidates: from.candidates as RouteCandidate[] }
      : findRoutes(g, { shapes: SHAPES, minMeters: 3000, maxMeters: 8000, region: { minX: x0, minY: y0, maxX: x1, maxY: y1 }, resultsPerShape: 1 });
    summary.push(`[${a.name}] nodes=${g.n} edges=${g.edgeCount} ${Date.now() - t}ms`);
    for (const c of r.candidates) {
      const q = quality(c, g.origin);
      sumJag += q.excessTurnsPerKm; sumCov += q.cornerCoverage; sumP95 += q.p95; sumSpk += q.spikes; n++;
      summary.push(`  ${c.shapeName.padEnd(6)} sim=${String(c.similarity).padStart(3)} len=${c.lengthMeters} 지그재그=${q.excessTurnsPerKm.toFixed(1)}/km 특징=${Math.round(q.cornerCoverage * 100)}% p95=${(q.p95 * 100).toFixed(1)}% 가시=${q.spikes}`);
    }
    out[a.name] = { bbox: a.bbox, candidates: r.candidates };
  }
  summary.push(`평균(${n}) 지그재그=${(sumJag / n).toFixed(2)}/km 특징=${Math.round((sumCov / n) * 100)}% p95=${((sumP95 / n) * 100).toFixed(1)}% 가시=${(sumSpk / n).toFixed(2)}/코스`);
  console.log(summary.join("\n"));
  writeFileSync(join(dir, `eval-${label}.json`), JSON.stringify(out));
}, 600_000);
