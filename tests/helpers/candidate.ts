// 화면·표시 로직 테스트용 코스 후보 만들기
import type { RouteCandidate } from "@/lib/route/fit";

let seq = 0;

/** (lat, lon)을 중심으로 한 변 sideDeg 정사각형 코스 */
export function makeCandidate(over: Partial<RouteCandidate> = {}, at: [number, number] = [37.5, 127], sideDeg = 0.01): RouteCandidate {
  const [la, lo] = at;
  const h = sideDeg / 2;
  const latlngs: [number, number][] = [
    [la - h, lo - h],
    [la - h, lo + h],
    [la + h, lo + h],
    [la + h, lo - h],
    [la - h, lo - h],
  ];
  return {
    id: `c${++seq}`,
    shapeId: "square",
    shapeName: "네모",
    placement: { cx: 0, cy: 0, scale: 1000, rotDeg: 0 },
    latlngs,
    outline: latlngs,
    outlines: [latlngs],
    moves: [],
    lengthMeters: 4200,
    moveMeters: 0,
    roadInfo: { major: 0.25, unpaved: 0, lit: null, litKnown: 0, steps: 0, carFree: 0, tunnels: 0 },
    similarity: 80,
    meanDeviationMeters: 12,
    maxDeviationMeters: 40,
    zigzagPerKm: 1,
    spikes: 0,
    featureCoverage: 1,
    repeatRatio: 0,
    cost: 0.1,
    ...over,
  };
}
