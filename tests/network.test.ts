// 외부 서버와 주고받는 부분: 공용 가짜 응답(tests/mocks/handlers.ts)으로 네트워크 단에서 가로챈다.
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchElevation } from "@/lib/route/elevation";
import { OVERPASS_ENDPOINTS, fetchOverpass, fetchOverpassTiles, graphFromOverpass, mergeOverpass } from "@/lib/route/osm";
import { createHandlers, type BBox } from "./mocks/handlers";

const requested: BBox[] = [];
let elevationCalls = 0;
const server = setupServer(...createHandlers({ onOverpass: (b) => requested.push(b), onElevation: () => elevationCalls++ }));

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  requested.length = 0;
  elevationCalls = 0;
});
afterAll(() => server.close());

const box = (side: number): BBox => {
  const dLat = side / 111_195, dLon = side / (111_195 * Math.cos((37.5 * Math.PI) / 180));
  return { south: 37.5, west: 127.0, north: 37.5 + dLat, east: 127.0 + dLon };
};

describe("길 데이터 (Overpass)", () => {
  it("요청한 영역의 길을 받아 그래프를 만든다", async () => {
    const b = box(1000);
    const { text, endpoint } = await fetchOverpass(b);
    expect(endpoint).toBe(OVERPASS_ENDPOINTS[0]);
    expect(requested).toHaveLength(1);
    expect(requested[0].south).toBeCloseTo(b.south, 5);
    const g = graphFromOverpass(JSON.parse(text), b);
    expect(g.n).toBeGreaterThan(100);
  });

  it("첫 서버가 바쁘면(429) 다음 서버로", async () => {
    server.use(http.post(OVERPASS_ENDPOINTS[0], () => new HttpResponse(null, { status: 429 })));
    const { endpoint } = await fetchOverpass(box(500));
    expect(endpoint).toBe(OVERPASS_ENDPOINTS[1]);
  });

  it("모든 서버가 바쁘면 '바쁨' 오류", async () => {
    server.use(http.post(/overpass/, () => new HttpResponse(null, { status: 504 })));
    await expect(fetchOverpass(box(500))).rejects.toThrow(/busy/);
  });

  it("취소하면 다음 서버를 시도하지 않고 바로 멈춘다", async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(fetchOverpass(box(500), ac.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(requested).toHaveLength(0);
  });

  it("10km 영역은 5km 칸 4개로 나눠 받고, 칸 경계의 길·점은 한 번만 합친다", async () => {
    const steps: string[] = [];
    const texts = await fetchOverpassTiles(box(10_000), undefined, (d, t) => steps.push(`${d}/${t}`));
    expect(requested).toHaveLength(4);
    expect(steps).toEqual(["0/4", "1/4", "2/4", "3/4", "4/4"]);
    const merged = mergeOverpass(texts);
    const ids = merged.elements.map((e) => `${e.type}/${(e as { id: number }).id}`);
    expect(new Set(ids).size).toBe(ids.length);
    const whole = JSON.parse((await fetchOverpass(box(10_000))).text) as { elements: unknown[] };
    expect(merged.elements.length).toBe(whole.elements.length);
  });
});

describe("고도 (Open-Meteo)", () => {
  it("코스 위 최대 100점을 한 번에 묻고 오르막을 계산한다", async () => {
    const line: [number, number][] = Array.from({ length: 300 }, (_, i) => [37.5 + i * 1e-4, 127]);
    const p = await fetchElevation(line);
    expect(elevationCalls).toBe(1);
    expect(p.elev).toHaveLength(100);
    expect(p.min).toBeCloseTo(20, 0);
    expect(p.max).toBeCloseTo(50, 0);
    expect(p.ascent).toBeGreaterThan(25);
  });

  it("서버 오류·잘못된 응답이면 실패로 알린다 (화면은 '확인 못 함')", async () => {
    server.use(http.get(/open-meteo/, () => new HttpResponse(null, { status: 500 })));
    await expect(fetchElevation([[37.5, 127], [37.51, 127]])).rejects.toThrow(/elevation_500/);
    server.use(http.get(/open-meteo/, () => HttpResponse.json({ elevation: [1] })));
    await expect(fetchElevation([[37.5, 127], [37.51, 127]])).rejects.toThrow(/bad_data/);
  });
});
