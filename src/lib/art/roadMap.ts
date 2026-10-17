// 작품 아래에 흐리게 깔 실제 도로망. 작품을 만들 때 이 브라우저에서 한 번 계산해 이 기기(IndexedDB)에만 보관한다.
// 서버·공유 링크로는 보내지 않는다 (도로망 모양만으로도 장소를 알아낼 수 있다).
// 좌표는 normalizeSegments와 같은 u·v(그림 창 0~1)라서 작품 선 위에 그대로 겹친다.

import type { Pt } from "@/lib/contracts/types";
import { EARTH_RADIUS_M } from "@/lib/gpx/metrics";
import type { GpxPoint } from "@/lib/gpx/parser";
import { fetchOverpass, type BBox } from "@/lib/route/osm";
import { rdpIndices } from "./rdp";

const toRad = (d: number) => (d * Math.PI) / 180;
/** 그림 창 한 변이 이보다 크면 도로가 너무 빽빽해 지도를 만들지 않는다 */
const MAX_WINDOW_METERS = 8000;
const MAX_POINTS = 20_000;

interface Frame {
  bbox: BBox;
  toUv: (lat: number, lon: number) => Pt;
}

/** normalizeSegments와 같은 투영·중심·배율. 그림 창(u·v 0~1)이 덮는 위경도 범위도 함께 돌려준다. */
export function artFrame(segments: GpxPoint[][]): Frame | null {
  const all = segments.flat();
  if (!all.length) return null;
  const lats = all.map((p) => p.lat), lons = all.map((p) => p.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const φ0 = toRad((minLat + maxLat) / 2), λ0 = toRad((minLon + maxLon) / 2), cosφ0 = Math.cos(φ0);
  const proj = (lat: number, lon: number) => [EARTH_RADIUS_M * cosφ0 * (toRad(lon) - λ0), EARTH_RADIUS_M * (toRad(lat) - φ0)];
  const xy = all.map((p) => proj(p.lat, p.lon));
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(...ys), yMax = Math.max(...ys);
  const L = Math.max(xMax - xMin, yMax - yMin);
  if (!(L > 0) || L / 0.9 > MAX_WINDOW_METERS) return null;
  const xc = (xMin + xMax) / 2, yc = (yMin + yMax) / 2;
  // u = 0.5 + 0.9(x−xc)/L 이므로 u∈[0,1] ⇔ |x−xc| ≤ L/1.8
  const half = L / 1.8;
  const deg = (m: number) => (m / EARTH_RADIUS_M) * (180 / Math.PI);
  const latC = deg(yc) + (φ0 * 180) / Math.PI, lonC = deg(xc / cosφ0) + (λ0 * 180) / Math.PI;
  return {
    bbox: { south: latC - deg(half), north: latC + deg(half), west: lonC - deg(half / cosφ0), east: lonC + deg(half / cosφ0) },
    toUv: (lat, lon) => {
      const [x, y] = proj(lat, lon);
      return [0.5 + (0.9 * (x - xc)) / L, 0.5 - (0.9 * (y - yc)) / L];
    },
  };
}

/** 선분을 그림 창 [0,1]² 안으로 자른다 (Liang–Barsky). 창 밖이면 null. */
function clip(p: Pt, q: Pt): [Pt, Pt] | null {
  let t0 = 0, t1 = 1;
  const dx = q[0] - p[0], dy = q[1] - p[1];
  for (const [pp, qq] of [[-dx, p[0]], [dx, 1 - p[0]], [-dy, p[1]], [dy, 1 - p[1]]]) {
    if (pp === 0) {
      if (qq < 0) return null;
      continue;
    }
    const r = qq / pp;
    if (pp < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }
  return [[p[0] + t0 * dx, p[1] + t0 * dy], [p[0] + t1 * dx, p[1] + t1 * dy]];
}

interface OverpassLike {
  elements: Array<{ type: string; id: number; lat?: number; lon?: number; nodes?: number[] }>;
}

/** 도로 자료(Overpass 형식)의 길마다 그림 창 안 부분만 u·v 선으로. 창 1000 기준 1.5 오차로 단순화. */
export function roadMapLines(json: OverpassLike, toUv: Frame["toUv"]): Pt[][] {
  const nodes = new Map<number, Pt>();
  for (const el of json.elements) if (el.type === "node" && el.lat != null && el.lon != null) nodes.set(el.id, toUv(el.lat, el.lon));
  const lines: Pt[][] = [];
  const push = (l: Pt[]) => {
    if (l.length < 2) return;
    const keep = rdpIndices(l.map(([u, v]) => [u * 1000, v * 1000] as const), 1.5);
    lines.push(keep.map((i) => [Math.round(l[i][0] * 1e4) / 1e4, Math.round(l[i][1] * 1e4) / 1e4] as Pt));
  };
  for (const el of json.elements) {
    if (el.type !== "way" || !el.nodes) continue;
    let cur: Pt[] = [];
    for (let i = 1; i < el.nodes.length; i++) {
      const a = nodes.get(el.nodes[i - 1]), b = nodes.get(el.nodes[i]);
      const seg = a && b ? clip(a, b) : null;
      if (!seg) {
        push(cur);
        cur = [];
        continue;
      }
      if (!cur.length) cur.push(seg[0]);
      cur.push(seg[1]);
      // 창 밖으로 나가면 선을 끊는다
      if (seg[1][0] !== b![0] || seg[1][1] !== b![1]) {
        push(cur);
        cur = [];
      }
    }
    push(cur);
  }
  // ponytail: 점이 너무 많으면 통째로 포기한다. 필요해지면 짧은 골목부터 덜어내기.
  return lines.reduce((s, l) => s + l.length, 0) > MAX_POINTS ? [] : lines;
}

/** 작품을 기다리게 하지 않고 뒤에서 받아 저장한다. 공용 도로 서버는 30초 넘게 걸리기도 한다. */
export function attachRoadMap(artworkId: string, segments: GpxPoint[][]) {
  void buildRoadMap(segments, AbortSignal.timeout(60_000)).then((m) => m && RoadMapStore.save(artworkId, m));
}

/** 기록 주변 도로망. 도로 자료를 못 받거나 범위가 너무 넓으면 null (작품은 지도 없이 그대로 만든다). */
export async function buildRoadMap(segments: GpxPoint[][], signal?: AbortSignal): Promise<Pt[][] | null> {
  const frame = artFrame(segments);
  if (!frame) return null;
  try {
    const { text } = await fetchOverpass(frame.bbox, signal);
    const lines = roadMapLines(JSON.parse(text) as OverpassLike, frame.toUv);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

// ───────── 이 기기 전용 보관 (작품 id → 도로망) ─────────

const DB_NAME = "yorun-roadmaps";
const STORE = "maps";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("indexeddb_unavailable"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_open_failed"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error("indexeddb_tx_failed"));
    });
  } finally {
    db.close();
  }
}

/** 도로망이 저장되면 알린다 (detail = 작품 id). 작품방이 듣고 다시 읽는다. */
export const ROAD_MAP_EVENT = "yorun:roadmap";
// 도로망이 도착하기 전에 작품 id가 바뀐 경우(임시 → 계정 저장) 새 id로 저장하기 위한 별칭
const aliases = new Map<string, string>();

/** 실패해도 작품 흐름을 막지 않는다 (지도는 장식) */
export const RoadMapStore = {
  async save(artworkId: string, lines: Pt[][]) {
    const id = aliases.get(artworkId) ?? artworkId;
    await run("readwrite", (s) => s.put(lines, id)).catch(() => undefined);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ROAD_MAP_EVENT, { detail: id }));
  },
  load: (artworkId: string) => run<Pt[][]>("readonly", (s) => s.get(artworkId)).catch(() => undefined),
  remove: (artworkId: string) => run("readwrite", (s) => s.delete(artworkId)).catch(() => undefined),
  /** 임시 작품이 계정에 저장되며 id가 바뀔 때 */
  async rename(from: string, to: string) {
    const lines = await this.load(from);
    if (!lines) {
      aliases.set(from, to);
      return;
    }
    await this.save(to, lines);
    await this.remove(from);
  },
  clearAll: () => run("readwrite", (s) => s.clear()).catch(() => undefined),
};
