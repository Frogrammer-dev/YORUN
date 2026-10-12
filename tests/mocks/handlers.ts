// 외부 서비스 가짜 응답 (MSW). 단위 테스트(msw/node)와 브라우저 E2E(@msw/playwright)가 같은 정의를 쓴다.
// - Overpass(길 데이터): 요청한 영역을 덮는 바둑판 길을 만들어 준다. 점·길 번호가 전역 격자 기준이라
//   넓은 영역을 여러 칸으로 나눠 받아도 겹치는 길이 같은 번호로 합쳐진다 (앱의 칸 나눠 받기 검증).
// - Open-Meteo(고도): 좌표 수만큼 완만한 언덕.
// - OpenFreeMap(바탕 지도): 배경색만 있는 최소 스타일, 지도 타일은 1×1 PNG.
// 이 파일은 앱 코드(@/ 경로)를 가져오지 않는다. Playwright 실행기에서도 그대로 읽히게 하기 위함.

import { http, HttpResponse, type HttpHandler } from "msw";

export const OVERPASS_URL = /overpass/;
export const ELEVATION_URL = /api\.open-meteo\.com\/v1\/elevation/;

/** 바둑판 간격 (m) */
const STEP = 70;
const M_PER_DEG = 111_195;

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Overpass 질의 문자열에서 (남,서,북,동) 영역을 꺼낸다 */
export function bboxOfQuery(query: string): BBox | null {
  const m = query.match(/\((-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)\)/);
  if (!m) return null;
  const [south, west, north, east] = m.slice(1).map(Number);
  return { south, west, north, east };
}

/**
 * 영역을 덮는 바둑판 길 (가로줄은 생활도로, 세로줄은 보행로). 점 번호는 전역 격자 위치로 정해 칸 경계에서 겹쳐도 같다.
 * 기준 위도는 영역과 상관없이 고정(35°)해 경도 간격이 칸마다 달라지지 않게 한다.
 */
export function gridOverpass(b: BBox, step = STEP) {
  const dLat = step / M_PER_DEG, dLon = step / (M_PER_DEG * Math.cos((35 * Math.PI) / 180));
  const i0 = Math.floor(b.south / dLat), i1 = Math.ceil(b.north / dLat);
  const j0 = Math.floor(b.west / dLon), j1 = Math.ceil(b.east / dLon);
  const id = (i: number, j: number) => i * 1_000_000 + j;
  const elements: Array<Record<string, unknown>> = [];
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) elements.push({ type: "node", id: id(i, j), lat: i * dLat, lon: j * dLon });
  // 길은 칸마다 잘리면 서로 다른 길이 되므로, 한 줄을 이웃 점 두 개짜리 조각으로 나눠 전역 번호를 붙인다
  for (let i = i0; i <= i1; i++)
    for (let j = j0; j < j1; j++) elements.push({ type: "way", id: 2e12 + id(i, j), nodes: [id(i, j), id(i, j + 1)], tags: { highway: "residential", name: `가로${i}` } });
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i < i1; i++) elements.push({ type: "way", id: 3e12 + id(i, j), nodes: [id(i, j), id(i + 1, j)], tags: { highway: "footway", name: `세로${j}` } });
  return { osm3s: { timestamp_osm_base: "2026-10-01T00:00:00Z" }, elements };
}

/** 좌표 수만큼 완만한 언덕 (20m → 50m → 20m) */
export function hillElevation(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 20 + 30 * Math.sin((i / Math.max(1, n)) * Math.PI));
}

/** 1×1 투명 PNG */
const PNG_1PX = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

export interface MockOptions {
  /** Overpass 응답을 바꾸고 싶을 때 (예: 실제 지도 데이터 고정본) */
  overpass?: (bbox: BBox) => { elements: unknown[] } & Record<string, unknown>;
  /** 요청 수를 세고 싶을 때 */
  onOverpass?: (bbox: BBox) => void;
  onElevation?: (count: number) => void;
}

export function createHandlers(o: MockOptions = {}): HttpHandler[] {
  return [
    http.post(OVERPASS_URL, async ({ request }) => {
      const body = await request.text();
      const query = new URLSearchParams(body).get("data") ?? "";
      const b = request.headers.get("content-type")?.includes("application/json") ? JSON.parse(body) as BBox : bboxOfQuery(query);
      if (!b) return HttpResponse.json({ error: "bad query" }, { status: 400 });
      o.onOverpass?.(b);
      return HttpResponse.json((o.overpass ?? gridOverpass)(b) as Parameters<typeof HttpResponse.json>[0]);
    }),
    http.get(ELEVATION_URL, ({ request }) => {
      const n = (new URL(request.url).searchParams.get("latitude") ?? "").split(",").filter(Boolean).length;
      o.onElevation?.(n);
      return HttpResponse.json({ elevation: hillElevation(n) });
    }),
    http.get(/tiles\.openfreemap\.org\/styles\//, () =>
      HttpResponse.json({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef0f2" } }] }),
    ),
    http.get(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, () => new HttpResponse(PNG_1PX, { headers: { "content-type": "image/png" } })),
  ];
}

export const handlers = createHandlers();
