// OpenStreetMap(Overpass) 보행 길 데이터 → 도로 그래프.
// 지도 데이터는 현장 통행 가능 여부·공사·임시 통제를 보장하지 않는다 (15.3: 결과 화면에 미확인으로 표시).

import { EDGE_LIT, EDGE_MAJOR, EDGE_STEPS, EDGE_UNLIT, EDGE_UNPAVED, buildGraph, makeOrigin, type RawEdge, type RoadGraph } from "./graph";

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** 달리기에 쓸 수 있는 길 종류와 비용 가중치(큰길은 덜 선호). 고속도로·자동차 전용도로는 제외. */
export const HIGHWAY_FACTOR: Record<string, number> = {
  footway: 1,
  path: 1,
  pedestrian: 1,
  living_street: 1,
  residential: 1,
  service: 1.05,
  unclassified: 1.05,
  track: 1.1,
  cycleway: 1.1,
  tertiary: 1.1,
  tertiary_link: 1.1,
  secondary: 1.25,
  secondary_link: 1.25,
  primary: 1.4,
  primary_link: 1.4,
  steps: 3,
};

export const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

export function buildOverpassQuery(b: BBox): string {
  const kinds = Object.keys(HIGHWAY_FACTOR).join("|");
  const box = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(6)).join(",");
  return `[out:json][timeout:180];way["highway"~"^(${kinds})$"]["area"!="yes"](${box});(._;>;);out body qt;`;
}

interface OsmNode {
  type: "node";
  id: number;
  lat: number;
  lon: number;
}
interface OsmWay {
  type: "way";
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
export interface OverpassJson {
  osm3s?: { timestamp_osm_base?: string };
  elements: Array<OsmNode | OsmWay | { type: string }>;
}

/**
 * 길 단순화 수준 (그림이 삐죽삐죽해지는 주원인은 골목·보도·횡단보도·진입로 같은 잔길이다)
 * - simple: 큰길·이어진 생활도로·이름 있는 산책로 위주 (기본)
 * - normal: 도로와 겹치는 보도·횡단보도·진입로·짧은 무명 보행로 제외
 * - detailed: 보행 가능한 모든 길
 */
export type RoadDetail = "simple" | "normal" | "detailed";

export interface GraphOptions {
  excludeSteps: boolean;
  detail?: RoadDetail;
  /** 비포장 길(흙·자갈 등) 빼기 */
  avoidUnpaved?: boolean;
  /** 큰 차도(primary·secondary·tertiary)를 더 피하기 */
  avoidMajor?: boolean;
  /** 가로등 있는 길 우선 (lit=yes가 아닌 길에 벌점) */
  preferLit?: boolean;
}

const MAJOR = /^(primary|secondary|tertiary|unclassified)$/;

/** 큰길 위주(simple)에서 이름 없는 길을 남기는 최소 길이(길 한 조각 기준). 실제 데이터 평가로 조정. */
export const ROAD_RULES = { residentialMinLen: 150, trailMinLen: 250, shortTrailMinLen: 80 };
const TRAIL = /^(footway|path|cycleway)$/;

/** 이 길을 달리기 경로에 넣을 수 있는가 (lengthM: 길 전체 길이) */
export function wayUsable(tags: Record<string, string> | undefined, opts: GraphOptions, lengthM = Infinity): number | null {
  if (!tags) return null;
  const hw = tags.highway ?? "";
  const f = HIGHWAY_FACTOR[hw];
  if (f == null) return null;
  if (tags.area === "yes") return null;
  if (/^(private|no)$/.test(tags.access ?? "") && !/^(yes|designated|permissive)$/.test(tags.foot ?? "")) return null;
  if (/^(no|private|use_sidepath)$/.test(tags.foot ?? "")) return null;
  if (opts.excludeSteps && hw === "steps") return null;
  if (hw === "cycleway" && !/^(yes|designated|permissive)$/.test(tags.foot ?? "")) return null;

  const detail = opts.detail ?? "simple";
  if (detail === "detailed") return f;
  const named = !!(tags.name || tags["name:ko"]);
  // 도로를 한 번 더 그린 선(보도·횡단보도)과 진입로는 경로를 지그재그로 만든다
  if (/^(sidewalk|crossing|traffic_island|access_aisle)$/.test(tags.footway ?? "")) return null;
  if (hw === "service" && /^(parking_aisle|driveway|drive-through|emergency_access)$/.test(tags.service ?? "")) return null;
  if (hw === "track") return null;
  if (TRAIL.test(hw) && !named && lengthM < ROAD_RULES.shortTrailMinLen) return null;
  if (detail === "normal") return f;

  // simple
  if (MAJOR.test(hw)) return f;
  if (hw === "residential") return named || lengthM >= ROAD_RULES.residentialMinLen ? f : null;
  if (hw === "living_street") return named ? f : null;
  if (hw === "pedestrian") return f;
  if (TRAIL.test(hw)) return named || lengthM >= ROAD_RULES.trailMinLen ? f : null;
  return null; // service, *_link, steps 등
}

/** 막다른 길을 반복해서 잘라낸다. 닫힌 그림 코스에는 쓰이지 않고 스냅 시 가시를 만든다. */
function pruneDeadEnds(edges: RawEdge[], nodeCount: number): RawEdge[] {
  let cur = edges;
  for (let round = 0; round < 50; round++) {
    const deg = new Int32Array(nodeCount);
    for (const e of cur) {
      deg[e.a]++;
      deg[e.b]++;
    }
    const next = cur.filter((e) => deg[e.a] > 1 && deg[e.b] > 1);
    if (next.length === cur.length) return next;
    cur = next;
  }
  return cur;
}

export function graphFromOverpass(json: OverpassJson, bbox: BBox, opts: GraphOptions = { excludeSteps: true }): RoadGraph {
  const origin = makeOrigin((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2);
  const idx = new Map<number, number>();
  const lats: number[] = [], lons: number[] = [];
  for (const el of json.elements) {
    if (el.type !== "node") continue;
    const n = el as OsmNode;
    if (!Number.isFinite(n.lat) || !Number.isFinite(n.lon)) continue;
    idx.set(n.id, lats.length);
    lats.push(n.lat);
    lons.push(n.lon);
  }
  const edges: RawEdge[] = [];
  for (const el of json.elements) {
    if (el.type !== "way") continue;
    const w = el as OsmWay;
    if (!Array.isArray(w.nodes)) continue;
    let len = 0;
    for (let i = 1; i < w.nodes.length; i++) {
      const a = idx.get(w.nodes[i - 1]), b = idx.get(w.nodes[i]);
      if (a !== undefined && b !== undefined) len += Math.hypot((lats[a] - lats[b]) * 111_195, (lons[a] - lons[b]) * 111_195 * origin.cos0);
    }
    let factor = wayUsable(w.tags, opts, len);
    if (factor == null) continue;
    const flags = wayFlags(w.tags);
    if (opts.avoidUnpaved && flags & EDGE_UNPAVED) continue;
    if (opts.avoidMajor && flags & EDGE_MAJOR) factor *= 2;
    if (opts.preferLit && !(flags & EDGE_LIT)) factor *= 1.3;
    for (let i = 1; i < w.nodes.length; i++) {
      const a = idx.get(w.nodes[i - 1]), b = idx.get(w.nodes[i]);
      if (a === undefined || b === undefined || a === b) continue;
      edges.push({ a, b, factor, flags });
    }
  }
  return buildGraph(origin, lats, lons, pruneDeadEnds(edges, lats.length), json.osm3s?.timestamp_osm_base ?? null);
}

/** 브라우저에서 Overpass 호출. 실패하면 다음 서버를 시도한다. */
export async function fetchOverpass(bbox: BBox, signal?: AbortSignal): Promise<{ text: string; endpoint: string }> {
  const body = new URLSearchParams({ data: buildOverpassQuery(bbox) });
  let lastErr: unknown = null;
  for (const ep of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(ep, { method: "POST", body, signal, headers: { Accept: "application/json" } });
      if (res.status === 429 || res.status === 504) {
        lastErr = new Error(`overpass_busy_${res.status}`);
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`overpass_${res.status}`);
        continue;
      }
      return { text: await res.text(), endpoint: ep };
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("overpass_failed");
}

const UNPAVED = /^(unpaved|dirt|earth|ground|grass|gravel|fine_gravel|sand|mud|compacted|pebblestone|woodchips|rock)$/;

/** OSM 태그 → 길 성격 비트 (EDGE_*) */
export function wayFlags(tags: Record<string, string> | undefined): number {
  if (!tags) return 0;
  const hw = tags.highway ?? "";
  let f = 0;
  if (/^(primary|primary_link|secondary|secondary_link|tertiary|tertiary_link)$/.test(hw)) f |= EDGE_MAJOR;
  if (UNPAVED.test(tags.surface ?? "") || (hw === "track" && !tags.surface) || (hw === "path" && !tags.surface && !tags.name)) f |= EDGE_UNPAVED;
  if (/^(yes|24\/7|automatic|limited|interval)$/.test(tags.lit ?? "")) f |= EDGE_LIT;
  else if (tags.lit === "no") f |= EDGE_UNLIT;
  if (hw === "steps") f |= EDGE_STEPS;
  return f;
}

/** 영역을 한 변 maxSide(m) 이하 칸으로 나눈다 (넓은 영역을 서버 부담 없이 나눠 받기) */
export function splitBBox(b: BBox, maxSide = 5000): BBox[] {
  const latM = (b.north - b.south) * 111_195;
  const lonM = (b.east - b.west) * 111_195 * Math.cos((((b.north + b.south) / 2) * Math.PI) / 180);
  const ny = Math.max(1, Math.ceil(latM / maxSide)), nx = Math.max(1, Math.ceil(lonM / maxSide));
  const out: BBox[] = [];
  for (let i = 0; i < ny; i++)
    for (let j = 0; j < nx; j++)
      out.push({
        south: b.south + ((b.north - b.south) * i) / ny,
        north: b.south + ((b.north - b.south) * (i + 1)) / ny,
        west: b.west + ((b.east - b.west) * j) / nx,
        east: b.west + ((b.east - b.west) * (j + 1)) / nx,
      });
  return out;
}

/** 넓은 영역: 칸마다 차례로 받는다 (동시에 보내면 공용 서버가 거절하기 쉽다) */
export async function fetchOverpassTiles(bbox: BBox, signal?: AbortSignal, onTile?: (done: number, total: number) => void): Promise<string[]> {
  const tiles = splitBBox(bbox);
  const texts: string[] = [];
  for (let i = 0; i < tiles.length; i++) {
    onTile?.(i, tiles.length);
    texts.push((await fetchOverpass(tiles[i], signal)).text);
  }
  onTile?.(tiles.length, tiles.length);
  return texts;
}

/** 여러 칸의 Overpass 응답을 하나로 (칸 경계에 걸친 길·점은 한 번만) */
export function mergeOverpass(texts: string[]): OverpassJson {
  const seen = new Set<string>();
  const out: OverpassJson = { elements: [] };
  for (const t of texts) {
    const j = JSON.parse(t) as OverpassJson;
    if (!Array.isArray(j.elements)) throw new Error("no elements");
    out.osm3s ??= j.osm3s;
    for (const el of j.elements) {
      const k = `${el.type}/${(el as { id?: number }).id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.elements.push(el);
    }
  }
  return out;
}
