// 코스 → 낙서 인식 이름. 화면(메인 스레드)에서 WebGL로 한꺼번에 판정한다.
// 같은 코스를 조금씩 돌려 세 번 보여 주고 확률을 평균 내, 한 각도에서만 우연히 높게 나온 답을 거른다.

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
}

/** 코스마다 가장 그럴듯한 이름 (무늬·단순 도형 갈래는 뺀다). 판정할 수 없으면 null */
export async function recognizeCourses(courses: Array<{ latlngs: [number, number][] }>): Promise<Array<Recognized | null>> {
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
      if (!DOODLE_SKIP.has(clf.classes[j]) && p > bp) (bp = p), (best = j);
    });
    return best < 0 ? null : { name: clf.classes[best], prob: bp };
  });
}
