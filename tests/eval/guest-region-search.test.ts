// 게스트 기본 기록 후보 찾기. 전국 지역을 훑고 모양별로 유사도 높은 코스를 고른다.
// GUEST_SEARCH=결과폴더 ROAD_DATA_DIR=도로폴더 로 실행한다. 유사도는 후보를 줄이는 데만 쓰고, 최종 선택은 사람이 그림으로 본다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { relativeLine } from "@/lib/battle/trialRecords";
import { discoverRoutes } from "@/lib/route/discover";
import { findRoutes, type RouteCandidate } from "@/lib/route/fit";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { improveRoutes } from "@/lib/route/qualitySearch";
import { readLocalRoads } from "@/lib/route/roadData.server";
import { SHAPE_BY_ID, resample, type ShapeId } from "@/lib/route/shapes";

const OUT = process.env.GUEST_SEARCH ?? "";
const SHAPES: ShapeId[] = ["heart", "star", "dog", "cat", "fish"];
const MIN_METERS = 2000, MAX_METERS = 8000;
const REGIONS: [string, number, number][] = [
  ["강남", 37.4979, 127.0276], ["잠실", 37.5133, 127.1], ["여의도", 37.5219, 126.9245], ["상암", 37.5794, 126.8895], ["마곡", 37.56, 126.83],
  ["일산", 37.659, 126.77], ["분당", 37.383, 127.119], ["동탄", 37.2, 127.095], ["영통", 37.253, 127.07], ["세종", 36.48, 127.289],
  ["둔산", 36.351, 127.385], ["수성", 35.858, 128.63], ["서면", 35.158, 129.06], ["해운대", 35.169, 129.131], ["상무", 35.153, 126.853],
  ["상남", 35.224, 128.68], ["효자", 35.815, 127.11], ["송도", 37.383, 126.643], ["청라", 37.536, 126.645], ["광교", 37.288, 127.05],
];

function loadRegion(lat: number, lon: number) {
  const dLat = 2000 / 111_000, dLon = 2000 / (111_000 * Math.cos((lat * Math.PI) / 180));
  const bbox: BBox = { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
  const graph = graphFromOverpass(readLocalRoads(bbox), bbox, { excludeSteps: true });
  const [minX, minY] = project(graph.origin, bbox.south, bbox.west);
  const [maxX, maxY] = project(graph.origin, bbox.north, bbox.east);
  return { graph, region: { minX, minY, maxX, maxY } };
}

/** 필수 조건: 닫힌 코스, 거리 범위, 잔가지 없음, 같은 길 반복 5% 이하 */
const usable = (c: RouteCandidate) => c.lengthMeters >= MIN_METERS && c.lengthMeters <= MAX_METERS && c.spikes === 0 && c.repeatRatio <= 0.05 && c.latlngs[0][0] === c.latlngs[c.latlngs.length - 1][0] && c.latlngs[0][1] === c.latlngs[c.latlngs.length - 1][1];

it.skipIf(!OUT)("지역별로 게스트 기본 기록 후보를 찾는다", async () => {
  mkdirSync(OUT, { recursive: true });
  type Hit = { region: string; shape: ShapeId; similarity: number; meters: number; cand: RouteCandidate };
  const coarse: Hit[] = [];
  for (const [name, lat, lon] of REGIONS) {
    const { graph, region } = loadRegion(lat, lon);
    for (const shape of SHAPES) {
      const best = findRoutes(graph, { shapes: [shape], minMeters: MIN_METERS, maxMeters: MAX_METERS, region, timeBudgetMs: 1200, resultsPerShape: 2 }).candidates.filter(usable)[0];
      if (best) coarse.push({ region: name, shape, similarity: best.similarity, meters: best.lengthMeters, cand: best });
    }
    console.log("훑음", name, graph.n);
  }
  writeFileSync(path.join(OUT, "coarse.json"), JSON.stringify(coarse.map((h) => ({ region: h.region, shape: h.shape, similarity: h.similarity, meters: h.meters }))));

  const refined: Hit[] = [];
  for (const shape of SHAPES) {
    const top = coarse.filter((h) => h.shape === shape).sort((a, b) => b.similarity - a.similarity).slice(0, 4);
    for (const hit of top) {
      const [, lat, lon] = REGIONS.find(([n]) => n === hit.region)!;
      const { graph, region } = loadRegion(lat, lon);
      const def = SHAPE_BY_ID[shape];
      const initial = discoverRoutes(graph, { mode: "shape", shapes: [def], minMeters: MIN_METERS, maxMeters: MAX_METERS, region, poolSize: 300, branchPool: 0, timeBudgetMs: 6000 } as never);
      const result = improveRoutes(graph, initial, { mode: "shape", shapes: [def], region, minMeters: MIN_METERS, maxMeters: MAX_METERS, timeBudgetMs: 12_000 });
      const best = result.candidates.filter(usable).sort((a, b) => b.similarity - a.similarity)[0] ?? hit.cand;
      refined.push({ region: hit.region, shape, similarity: best.similarity, meters: best.lengthMeters, cand: best });
      console.log("정밀", shape, hit.region, hit.similarity, "->", best.similarity, (best.lengthMeters / 1000).toFixed(1) + "km");
    }
    // 단계마다 저장해 도중에 멈춰도 결과가 남는다
    writeFileSync(path.join(OUT, "refined.json"), JSON.stringify(refined.map((h) => ({ region: h.region, shape: h.shape, similarity: h.similarity, meters: Math.round(h.meters), spikes: h.cand.spikes, repeat: h.cand.repeatRatio, line: relativeLine(h.cand.latlngs) }))));
  }

  // 모양별 상위 3개를 그린다. 지역 이름은 넣지 않아 모양만 보고 고르게 한다
  const cell = 220;
  const rows = SHAPES.map((shape, r) => refined.filter((h) => h.shape === shape).sort((a, b) => b.similarity - a.similarity).slice(0, 3).map((hit, c) => {
    const line = relativeLine(hit.cand.latlngs);
    const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
    const k = (cell * 0.78) / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const x0 = c * cell, y0 = r * cell;
    return `<polyline points="${line.map(([x, y]) => `${(x0 + cell / 2 + (x - mx) * k).toFixed(1)},${(y0 + cell / 2 + (y - my) * k).toFixed(1)}`).join(" ")}" fill="none" stroke="#0a72d6" stroke-width="4" stroke-linejoin="round"/><text x="${x0 + 6}" y="${y0 + 18}" font-size="15">${SHAPE_BY_ID[shape].name} ${c + 1} (유사도 ${hit.similarity}, ${(hit.meters / 1000).toFixed(1)}km)</text>`;
  }).join("")).join("");
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 3}" height="${cell * SHAPES.length}"><rect width="100%" height="100%" fill="#fff"/>${rows}</svg>`)).png().toFile(path.join(OUT, "candidates.png"));
  expect(refined.length).toBeGreaterThan(0);
}, 580_000);

/** 코스를 모양에 가장 잘 맞는 방향으로 돌린다. 위치를 지운 기록이라 방향만 바꿔도 달린 도로 모양은 그대로다 */
function uprightLine(line: readonly (readonly number[])[], target: readonly (readonly [number, number])[]) {
  const pts = target.map(([x, y]) => [x, -y]); // 모양 좌표는 y가 위, 기록은 y가 아래
  let best = { deg: 0, error: Infinity };
  const turned = (deg: number) => {
    const r = (deg * Math.PI) / 180, cos = Math.cos(r), sin = Math.sin(r);
    return line.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
  };
  for (let deg = 0; deg < 360; deg += 3) {
    const t = turned(deg);
    const xs = t.map((p) => p[0]), ys = t.map((p) => p[1]);
    const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const n = t.map(([x, y]) => [(x - mx) / size, (y - my) / size]);
    const nearest = (p: number[], set: number[][]) => Math.min(...set.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1])));
    const error = n.reduce((s, p) => s + nearest(p, pts), 0) / n.length + pts.reduce((s, p) => s + nearest(p, n), 0) / pts.length;
    if (error < best.error) best = { deg, error };
  }
  return { deg: best.deg, line: turned(best.deg).map(([x, y]) => [Math.round(x) + 0, Math.round(y) + 0]) };
}

const UPRIGHT = process.env.GUEST_UPRIGHT ?? "";
it.skipIf(!UPRIGHT)("후보를 세워서 그린다", async () => {
  const refined: { region: string; shape: ShapeId; similarity: number; meters: number; line: number[][] }[] = JSON.parse(readFileSync(path.join(UPRIGHT, "refined.json"), "utf8"));
  const cell = 200, cols = 4;
  const art = SHAPES.map((shape, r) => refined.filter((h) => h.shape === shape).sort((a, b) => b.similarity - a.similarity).slice(0, cols).map((hit, c) => {
    const { line, deg } = uprightLine(hit.line, resample(SHAPE_BY_ID[shape].points, 120));
    const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
    const k = (cell * 0.76) / Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const x0 = c * cell, y0 = r * cell;
    return `<polyline points="${line.map(([x, y]) => `${(x0 + cell / 2 + (x - mx) * k).toFixed(1)},${(y0 + cell / 2 + 6 + (y - my) * k).toFixed(1)}`).join(" ")}" fill="none" stroke="#0a72d6" stroke-width="4" stroke-linejoin="round"/><text x="${x0 + 4}" y="${y0 + 15}" font-size="13">${shape} ${hit.region} ${hit.similarity} ${(hit.meters / 1000).toFixed(1)}km ${deg}°</text>`;
  }).join("")).join("");
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${cell * cols}" height="${cell * SHAPES.length}"><rect width="100%" height="100%" fill="#fff"/>${art}</svg>`)).png().toFile(path.join(UPRIGHT, "upright.png"));
  expect(refined.length).toBeGreaterThan(0);
}, 120_000);

// 그림표를 본 뒤 고른 후보를 기본 기록으로 쓴다. 지역 이름과 위치는 저장하지 않는다.
const PICKS = process.env.GUEST_PICK ?? "";
it.skipIf(!PICKS)("고른 후보로 기본 기록을 만든다", () => {
  const refined: { region: string; shape: ShapeId; similarity: number; meters: number; line: number[][] }[] = JSON.parse(readFileSync(path.join(PICKS, "refined.json"), "utf8"));
  const plan: [ShapeId, string, number, string][] = [["heart", "강남", 375, "corner"], ["star", "상무", 315, "speed"], ["dog", "둔산", 345, "balance"], ["cat", "강남", 325, "speed"], ["fish", "둔산", 370, "corner"]];
  const records = plan.map(([shape, region, paceSecPerKm, style]) => {
    const hit = refined.find((h) => h.shape === shape && h.region === region)!;
    return { id: `guest-${shape}`, name: SHAPE_BY_ID[shape].name, line: uprightLine(hit.line, resample(SHAPE_BY_ID[shape].points, 120)).line, meters: hit.meters, paceSecPerKm, style };
  });
  writeFileSync("src/lib/battle/guestRecords.json", JSON.stringify(records) + "\n");
  expect(records).toHaveLength(5);
});
