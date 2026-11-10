// 동네 추천 다듬기 병렬화 검증 (실제 도로). PARALLEL_EVAL=결과.json ROAD_DATA_DIR=도로폴더 로 실행한다.
// 사전 기준(결과를 보기 전 고정, 2026-11-11):
//  C1 리팩터 정확성(2026-11-11 확인, 원래 코드 사본과 비교 후 사본 삭제): 6지역 모두 결과가 완전히 같았다. reports/parallel-search-20261111/README.md
//  C2 병렬 품질: 그림마다 순차 몫과 같은 단계 예산을 따로 주고 합친 결과가 순차 대비
//     1위 유사도 평균 하락 ≤ 1, 어느 지역도 1위 하락 > 3 없음, 상위 3개 평균 하락 ≤ 1.
// 고정 12조건 벤치마크는 그림 지정(shape) 모드라 이 변경의 대상이 아니다.
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { budgetSlice, improveOneShape, improveRoutes, improveTargetIds, mergeImproved } from "@/lib/route/qualitySearch";
import { readLocalRoads } from "@/lib/route/roadData.server";
import { SHAPES } from "@/lib/route/shapes";

const OUT = process.env.PARALLEL_EVAL ?? "";
const STEPS = Number(process.env.PARALLEL_STEPS ?? 6000);
const REGIONS: [string, number, number][] = [["해운대", 35.169, 129.131], ["강남", 37.4979, 127.0276], ["둔산", 36.351, 127.385], ["세종", 36.48, 127.289], ["서면", 35.158, 129.06], ["광교", 37.288, 127.05]];

function load(lat: number, lon: number) {
  const dLat = 1000 / 111_000, dLon = 1000 / (111_000 * Math.cos((lat * Math.PI) / 180));
  const bbox: BBox = { south: lat - dLat, north: lat + dLat, west: lon - dLon, east: lon + dLon };
  const graph = graphFromOverpass(readLocalRoads(bbox), bbox, { excludeSteps: true });
  const [minX, minY] = project(graph.origin, bbox.south, bbox.west);
  const [maxX, maxY] = project(graph.origin, bbox.north, bbox.east);
  return { graph, region: { minX, minY, maxX, maxY } };
}

it.skipIf(!OUT)("동네 추천 다듬기: 리팩터 동일성과 병렬 품질", () => {
  const rows = [];
  for (const [name, lat, lon] of REGIONS) {
    const { graph, region } = load(lat, lon);
    const base = { mode: "discover" as const, shapes: SHAPES, region, minMeters: 3000, maxMeters: 8000, prefs: {} };
    // 동네 고리 단계는 셋 모두 같은 입력을 쓴다 (단계 예산의 30%)
    const initial = discoverRoutes(graph, { ...base, poolSize: 300, branchPool: 0, budget: budgetSlice(new StepBudget(STEPS), 0, 0.3) });
    const improveSteps = Math.round(STEPS * 0.7);
    const t0 = Date.now();
    const seqNew = improveRoutes(graph, initial, { ...base, budget: new StepBudget(improveSteps) });
    const tSeq = Date.now() - t0;
    const targets = improveTargetIds(graph, initial, base);
    const tParts: number[] = [];
    const parts = targets.map((id) => {
      const t = Date.now();
      const part = improveOneShape(graph, initial, { ...base, budget: new StepBudget(Math.round(improveSteps / targets.length)) }, id);
      tParts.push(Date.now() - t);
      return part;
    });
    const par = mergeImproved(graph, initial, base, parts);
    const top = (r: typeof seqNew, k: number) => { const s = r.candidates.slice(0, k).map((c) => c.similarity); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0; };
    rows.push({
      region: name, nodes: graph.n, targets,
      seqTop1: top(seqNew, 1), parTop1: top(par, 1), seqTop3: top(seqNew, 3), parTop3: top(par, 3),
      seqCount: seqNew.candidates.length, parCount: par.candidates.length,
      seqMs: tSeq, parWallMs: Math.max(...tParts), parSumMs: tParts.reduce((a, b) => a + b, 0),
    });
    console.log(JSON.stringify(rows.at(-1)));
  }
  const d1 = rows.map((r) => r.parTop1 - r.seqTop1), d3 = rows.map((r) => r.parTop3 - r.seqTop3);
  const summary = {
    steps: STEPS,
    meanTop1Diff: d1.reduce((a, b) => a + b, 0) / d1.length,
    worstTop1Diff: Math.min(...d1),
    meanTop3Diff: d3.reduce((a, b) => a + b, 0) / d3.length,
  };
  const c2 = summary.meanTop1Diff >= -1 && summary.worstTop1Diff >= -3 && summary.meanTop3Diff >= -1;
  writeFileSync(OUT, JSON.stringify({ criteria: "C2 1위 평균 ≥ -1·최악 ≥ -3·상위3 평균 ≥ -1", summary: { ...summary, c2 }, rows }, null, 2));
  console.log(JSON.stringify({ ...summary, c2 }));
  expect(rows.length).toBe(REGIONS.length);
}, 3_600_000);
