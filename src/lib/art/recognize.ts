// 코스 → CLIP 이름. 위치를 제거하고 정규화한 외곽선만 앱 서버로 보낸다.
// 실험용 점수·차점 간격 거절 기준이며 사람 인식 확률을 뜻하지 않는다.

import { DoodleClassifier, rasterizeLoop, type XY } from "./doodle";
import { DOODLE_SKIP } from "./doodleNames";

let loading: Promise<DoodleClassifier> | null = null;

/** 모델은 처음 쓸 때 한 번만 받는다 (약 2MB) */
export function loadDoodle(): Promise<DoodleClassifier> {
  loading ??= DoodleClassifier.load().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

const ROTATIONS = [-12, 0, 12];

function toXY(latlngs: [number, number][]): XY[] {
  const k = Math.cos(((latlngs[0]?.[0] ?? 0) * Math.PI) / 180);
  return latlngs.map(([lat, lon]) => [lon * k, lat]);
}

function rotate(p: XY[], deg: number): XY[] {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return p.map(([x, y]) => [x * c - y * s, x * s + y * c]);
}

export interface Recognized {
  name: string;
  prob: number;
  model?: "clip";
  label?: string;
  margin?: number;
  accepted?: boolean;
}

/** 거절 기준을 통과한 CLIP 이름. 애매하거나 단순 도형이 우세하면 null. */
export async function recognizeCourses(courses: Array<{ latlngs: [number, number][] }>): Promise<Array<Recognized | null>> {
  if (!courses.length) return [];
  const lines = courses.slice(0, 128).map((course) => {
    const xy = toXY(course.latlngs);
    const xs = xy.map(p => p[0]), ys = xy.map(p => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
    const sampled = xy.length <= 1023 ? xy : Array.from({ length: 1023 }, (_, i) => xy[Math.round(i * (xy.length - 1) / 1022)]);
    const line = sampled.map(([x,y]) => [Number(((x-cx)/span).toFixed(6)), Number(((y-cy)/span).toFixed(6))]);
    if (line.length && (line[0][0] !== line.at(-1)![0] || line[0][1] !== line.at(-1)![1])) line.push(line[0]);
    return line;
  });
  const response = await fetch("/api/recognition", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines }), signal: AbortSignal.timeout(85_000) });
  if (!response.ok) throw new Error("clip_unavailable");
  const data: { results: Recognized[] } = await response.json();
  if (!Array.isArray(data.results) || data.results.length !== lines.length) throw new Error("clip_invalid_result");
  return courses.map((_, i) => data.results[i]?.accepted ? data.results[i] : null);
}

/** Legacy evaluator retained for controlled DoodleNet experiments. */
export async function recognizeDoodleCourses(courses: Array<{ latlngs: [number, number][] }>): Promise<Array<Recognized | null>> {
  if (!courses.length) return [];
  const clf = await loadDoodle();
  const images: Float32Array[] = [];
  for (const c of courses) {
    const xy = toXY(c.latlngs);
    for (const d of ROTATIONS) images.push(rasterizeLoop(rotate(xy, d)));
  }
  const guesses = await clf.classify(images, clf.classes.length);
  const C = clf.classes.length;
  return courses.map((_, i) => {
    const avg = new Float64Array(C);
    for (let k = 0; k < ROTATIONS.length; k++) for (const g of guesses[i * ROTATIONS.length + k]) avg[g.index] += g.prob / ROTATIONS.length;
    let best = -1, bp = 0;
    avg.forEach((p, j) => {
      if (!DOODLE_SKIP.has(clf.classes[j]) && p > bp) {
        bp = p;
        best = j;
      }
    });
    return best < 0 ? null : { name: clf.classes[best], prob: bp };
  });
}
