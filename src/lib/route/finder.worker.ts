/// <reference lib="webworker" />
// 루트 탐색 Web Worker: 화면(지도 조작)이 멈추지 않게 그래프 생성·탐색을 별도 스레드에서 수행한다.

import { discoverRoutes } from "./discover";
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
  mode: "discover" | "shape";
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

const ctx = self as unknown as DedicatedWorkerGlobalScope;

ctx.onmessage = (ev: MessageEvent<FinderRequest>) => {
  const req = ev.data;
  const post = (m: FinderResponse) => ctx.postMessage(m);
  try {
    const boxKey = `${req.dataBox.south},${req.dataBox.west},${req.dataBox.north},${req.dataBox.east}`;
    const gopts: GraphOptions = { excludeSteps: req.excludeSteps, detail: req.detail, avoidUnpaved: req.avoidUnpaved, avoidMajor: req.avoidMajor, preferLit: req.preferLit };
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
    const [minX, minY] = project(graph.origin, req.region.south, req.region.west);
    const [maxX, maxY] = project(graph.origin, req.region.north, req.region.east);
    const region = { minX, minY, maxX, maxY };
    const onProgress = (fraction: number, label: string) => post({ type: "progress", reqId: req.reqId, fraction, label });
    const prefs = { avoidMajor: req.avoidMajor, preferLit: req.preferLit };
    let result: FindResult;
    if (req.mode === "shape" && req.custom && req.custom.parts.length > 1) {
      // 여러 획 그림: 그림 전체를 함께 놓고 획 사이를 이동 구간으로 잇는다
      result = findGroupRoutes(graph, req.custom, { minMeters: req.minMeters, maxMeters: req.maxMeters, region, onProgress });
    } else {
      const target = req.custom ? req.custom.parts[0].shape : req.shape ? SHAPE_BY_ID[req.shape] : null;
      result = discoverRoutes(graph, {
        mode: req.mode === "shape" && target ? "shape" : "discover",
        shapes: req.mode === "shape" && target ? [target] : SHAPES,
        minMeters: req.minMeters,
        maxMeters: req.maxMeters,
        region,
        prefs,
        // 동네 추천: 낙서 인식 모델로 이름을 붙여 볼 동네 고리도 함께 돌려준다
        poolSize: 300,
        onProgress,
      });
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
