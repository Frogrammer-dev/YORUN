// 부스 도로에서 앱의 코스 탐색 엔진으로 코스를 찾는다. 지도 좌표는 y가 아래로, 엔진 좌표는 y가 위로 간다.

import { findRoutes } from "@/lib/route/fit";
import { buildGraph, makeOrigin, project, unproject, type RawEdge, type RoadGraph } from "@/lib/route/graph";
import { groupFromLoops, type ShapeDef } from "@/lib/route/shapes";
import { nodes, templates, type Course, type Shape } from "./course";
import roads from "./roads.json";

const ORIGIN = makeOrigin(37.5, 127.03);
export const SEARCH = { radiusM: 1000, minMeters: 2000, maxMeters: 6000, timeBudgetMs: 4000 };

let graph: RoadGraph | null = null;
function boothGraph(): RoadGraph {
  if (graph) return graph;
  const lats: number[] = [], lons: number[] = [];
  for (const [x, y] of nodes) {
    const [lat, lon] = unproject(ORIGIN, x, -y);
    lats.push(lat);
    lons.push(lon);
  }
  const edges: RawEdge[] = roads.edges.map(([a, b]) => ({ a, b, factor: 1 }));
  graph = buildGraph(ORIGIN, lats, lons, edges, null);
  return graph;
}

function nearestNode(x: number, y: number): number {
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - y) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

/** 준비된 모양을 엔진이 쓰는 모양으로 바꾼다 */
export function presetShape(shape: Shape): ShapeDef | null {
  return groupFromLoops([templates[shape].map(([x, y]) => [x, y] as [number, number])], { name: shape })?.parts[0]?.shape ?? null;
}

export interface BoothSearchResult extends Course {
  /** 엔진이 고른 자리에 놓인 원본 윤곽 (지도 좌표) */
  outline: number[][];
  similarity: number;
}

/** 찾지 못하면 null. 부르는 쪽이 단순 연결 방식으로 대신한다 */
export function findBoothCourse(shape: ShapeDef, center: number[], options: { timeBudgetMs?: number; maxMeters?: number } = {}): BoothSearchResult | null {
  const [cx, cy] = [center[0], -center[1]];
  const { radiusM, minMeters } = SEARCH;
  const { timeBudgetMs = SEARCH.timeBudgetMs, maxMeters = SEARCH.maxMeters } = options;
  const region = { minX: cx - radiusM, maxX: cx + radiusM, minY: cy - radiusM, maxY: cy + radiusM };
  const best = findRoutes(boothGraph(), { shapes: [shape], minMeters, maxMeters, region, timeBudgetMs, resultsPerShape: 1 }).candidates[0];
  if (!best) return null;
  const toMap = ([lat, lon]: [number, number]) => {
    const [x, y] = project(ORIGIN, lat, lon);
    return [x, -y];
  };
  const path = best.latlngs.map(toMap).map(([x, y]) => nearestNode(x, y)).filter((id, i, all) => id !== all[i - 1]);
  if (path.length < 4) return null;
  const distance = path.slice(1).reduce((sum, id, i) => sum + Math.hypot(nodes[id][0] - nodes[path[i]][0], nodes[id][1] - nodes[path[i]][1]), 0);
  return { path, distance, outline: best.outline.map(toMap), similarity: best.similarity };
}
