/// <reference lib="webworker" />
// 루트 탐색 Web Worker: 화면(지도 조작)이 멈추지 않게 그래프 생성·탐색을 별도 스레드에서 수행한다.

import { discoverRoutes } from "./discover";
import { findRunningCourses } from "./runCourses";
import { TimeBudget } from "./budget";
import { budgetSlice, improveRoutes } from "./qualitySearch";
import type { FindResult } from "./fit";
import { project, type RoadGraph } from "./graph";
import { findGroupRoutes } from "./group";
import { graphFromOverpass, mergeOverpass, type BBox, type GraphOptions, type OverpassJson, type RoadDetail } from "./osm";
import { SHAPES, SHAPE_BY_ID, type ShapeGroup, type ShapeId } from "./shapes";

export type FinderRequest = {
  type: "find";
  reqId: number;
  /** Overpass 응답 원문들 (넓은 영역은 여러 칸으로 나눠 받는다). 이미 받은 영역을 다시 찾을 때는 null로 보내 캐시를 쓴다. */
  texts: string[] | null;
  /** 길 데이터를 받은 영역 (그래프 기준) */
  dataBox: BBox;
  /** 그림을 놓을 탐색 영역 (dataBox 안) */
  region: BBox;
  /** discover: 동네 고리 코스를 먼저 찾아 닮은 그림을 붙인다, shape: 지정·직접 만든 그림을 찾는다 */
  mode: "discover" | "shape" | "running";
  /** running 모드의 출발점 [위도, 경도] */
  start?: [number, number];
  /** shape 모드에서 찾을 기본 그림 */
  shape?: ShapeId;
  /** shape 모드에서 사용자가 그리거나 글자·이미지로 만든 그림 (shape보다 우선). 여러 획일 수 있다 */
  custom?: ShapeGroup;
  minMeters: number;
  maxMeters: number;
  excludeSteps: boolean;
  /** 길 단순화 수준 */
  detail: RoadDetail;
  /** 길 조건 */
  avoidUnpaved?: boolean;
  avoidMajor?: boolean;
  preferLit?: boolean;
  preferCarFree?: boolean;
  avoidTunnels?: boolean;
  /** (실험) 동네 추천에 왕복 가지를 붙인 코스도 넣기 */
  branches?: boolean;
  /** Keep selected-area candidates while comparing nearby streets as well. */
  nearby?: boolean;
};

export type FinderResponse =
  | { type: "progress"; reqId: number; fraction: number; label: string }
  | {
      type: "result";
      reqId: number;
      result: FindResult;
      graph: { nodes: number; edges: number; dataTimestamp: string | null };
      /** 탐색에 쓴 길: [lat1, lon1, lat2, lon2, ...] 간선마다 4개 */
      roads: number[];
    }
  | { type: "error"; reqId: number; code: "bad_data" | "no_roads" | "no_cache" | "internal"; message: string };

let cache: { key: string; json: OverpassJson; graph: RoadGraph } | null = null;
const innerGraphs = new WeakMap<RoadGraph, Map<string, RoadGraph>>();

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<FinderRequest>) => {
  const req = ev.data;
  const post = (m: FinderResponse) => ctx.postMessage(m);
  try {
    const boxKey = `${req.dataBox.south},${req.dataBox.west},${req.dataBox.north},${req.dataBox.east}`;
    const gopts: GraphOptions = { excludeSteps: req.excludeSteps, detail: req.detail, avoidUnpaved: req.avoidUnpaved, avoidMajor: req.avoidMajor, preferLit: req.preferLit, preferCarFree: req.preferCarFree, avoidTunnels: req.avoidTunnels };
    const key = `${boxKey}|${JSON.stringify(gopts)}`;
    let graph: RoadGraph;
    if (req.texts === null) {
      if (!cache || !cache.key.startsWith(`${boxKey}|`)) {
        post({ type: "error", reqId: req.reqId, code: "no_cache", message: "지도 데이터를 다시 받아야 해요." });
        return;
      }
      graph = cache.key === key ? cache.graph : graphFromOverpass(cache.json, req.dataBox, gopts);
      cache = { key, json: cache.json, graph };
    } else {
      let json: OverpassJson;
      try {
        json = mergeOverpass(req.texts);
      } catch {
        post({ type: "error", reqId: req.reqId, code: "bad_data", message: "지도 데이터를 읽지 못했어요." });
        return;
      }
      graph = graphFromOverpass(json, req.dataBox, gopts);
      cache = { key, json, graph };
    }
    if (graph.n < 20) {
      post({ type: "error", reqId: req.reqId, code: "no_roads", message: "이 영역에는 달릴 수 있는 길 데이터가 거의 없어요." });
      return;
    }
    if (req.region.south < req.dataBox.south || req.region.north > req.dataBox.north || req.region.west < req.dataBox.west || req.region.east > req.dataBox.east) throw new Error("검색 영역의 길 데이터를 다시 받아야 해요.");
    const compareNearby = !!req.nearby && !req.custom?.parts.some((_,i)=>i>0) && JSON.stringify(req.region) !== JSON.stringify(req.dataBox);
    let localGraph = graph;
    if (compareNearby) {
      const innerKey = `${req.region.south},${req.region.west},${req.region.north},${req.region.east}`;
      const maps = innerGraphs.get(graph) ?? new Map<string,RoadGraph>();
      localGraph = maps.get(innerKey) ?? graphFromOverpass(cache!.json,req.region,gopts);
      maps.set(innerKey,localGraph);
      if (maps.size > 2) maps.delete(maps.keys().next().value!);
      innerGraphs.set(graph,maps);
    }
    const [minX, minY] = project(localGraph.origin, req.region.south, req.region.west);
    const [maxX, maxY] = project(localGraph.origin, req.region.north, req.region.east);
    const region = { minX, minY, maxX, maxY };
    const onProgress = (fraction: number, label: string) => post({ type: "progress", reqId: req.reqId, fraction, label });
    const prefs = { avoidMajor: req.avoidMajor, preferLit: req.preferLit, preferCarFree: req.preferCarFree };
    let result: FindResult;
    if (req.mode === "running") {
      // 러닝 코스: 그림과 무관하게 출발점에서 돌아오는 쾌적한 고리
      const r = findRunningCourses(localGraph, { start: project(localGraph.origin, req.start![0], req.start![1]), minMeters: req.minMeters, maxMeters: req.maxMeters, region, budget: new TimeBudget(25_000), prefs: { avoidMajor: req.avoidMajor, preferCarFree: req.preferCarFree }, onProgress });
      if ("error" in r) {
        post({ type: "error", reqId: req.reqId, code: "no_roads", message: "출발점 400m 안에 달릴 수 있는 길이 없어요. 출발점을 길 가까이로 옮겨 주세요." });
        return;
      }
      result = r;
    } else if (req.mode === "shape" && req.custom && req.custom.parts.length > 1) {
      // 여러 획 그림: 그림 전체를 함께 놓고 획 사이를 이동 구간으로 잇는다
      result = findGroupRoutes(localGraph, req.custom, { minMeters: req.minMeters, maxMeters: req.maxMeters, region, onProgress });
    } else {
      const target = req.custom ? req.custom.parts[0].shape : req.shape ? SHAPE_BY_ID[req.shape] : null;
      const shapes = req.mode === "shape" && target ? [target] : SHAPES;
      const budget = new TimeBudget(compareNearby ? 75_000 : Math.min(75_000, 45_000 * Math.max(1, Math.round((maxX-minX)/4500)) * Math.max(1, Math.round((maxY-minY)/4500))));
      const localEnd = compareNearby ? .6 : 1;
      result = discoverRoutes(localGraph, {
        mode: req.mode === "shape" && target ? "shape" : "discover",
        shapes,
        minMeters: req.minMeters,
        maxMeters: req.maxMeters,
        region,
        prefs,
        // 동네 추천: 낙서 인식 모델로 이름을 붙여 볼 동네 고리도 함께 돌려준다
        poolSize: 300,
        branchPool: req.branches ? 300 : 0,
        budget: budgetSlice(budget,0,.3*localEnd),
        onProgress: (fraction,label) => onProgress(fraction*.3*localEnd,label),
      });
      result = improveRoutes(localGraph,result,{
        mode: req.mode === "shape" && target ? "shape" : "discover", shapes, region,
        minMeters:req.minMeters, maxMeters:req.maxMeters, prefs,
        budget:budgetSlice(budget,.3*localEnd,localEnd),
        onProgress:(fraction,label)=>onProgress((.3+fraction*.7)*localEnd,label),
      });
      if (compareNearby && budget.ok()) {
        const [wideMinX,wideMinY]=project(graph.origin,req.dataBox.south,req.dataBox.west);
        const [wideMaxX,wideMaxY]=project(graph.origin,req.dataBox.north,req.dataBox.east);
        const previous = result;
        const wider = improveRoutes(graph,result,{
          mode:req.mode === "shape" && target ? "shape" : "discover", shapes,
          region:{minX:wideMinX,minY:wideMinY,maxX:wideMaxX,maxY:wideMaxY},
          minMeters:req.minMeters,maxMeters:req.maxMeters,prefs,
          budget:budgetSlice(budget,localEnd,1),
          onProgress:(fraction,label)=>onProgress(localEnd+fraction*(1-localEnd),`주변 동네 ${label}`.trim()),
        });
        // Keep an already validated local best if wider graph mapping or time limits lose it.
        if ((wider.candidates[0]?.similarity ?? -1) < (previous.candidates[0]?.similarity ?? -1)) {
          wider.candidates = [previous.candidates[0],...wider.candidates.filter(c=>c.id!==previous.candidates[0].id)].slice(0,8);
        }
        result = wider;
      }
    }
    const roads: number[] = [];
    for (let a = 0; a < graph.n; a++)
      for (let k = graph.adjStart[a]; k < graph.adjStart[a + 1]; k++) {
        const b = graph.adjTo[k];
        if (b > a) roads.push(graph.lat[a], graph.lon[a], graph.lat[b], graph.lon[b]);
      }
    post({ type: "result", reqId: req.reqId, result, graph: { nodes: graph.n, edges: graph.edgeCount, dataTimestamp: graph.dataTimestamp }, roads });
  } catch (e) {
    post({ type: "error", reqId: req.reqId, code: "internal", message: (e as Error)?.message ?? "탐색 중 오류" });
  }
};
