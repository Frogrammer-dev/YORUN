// 코스 찾기 결과를 화면에 보여 주기 직전 단계 (DOM·지도와 무관한 순수 로직 → 단위 테스트 대상)

import { overlap } from "./discover";
import type { RouteCandidate } from "./fit";
import { doodleKo } from "@/lib/art/doodleNames";
import type { Recognized } from "@/lib/art/recognize";
import calibration from "@/lib/eval/calibration.json";

/** 낙서 인식이 이 정도 이상 확신해야 '○○처럼 보이는 코스'로 보여 준다 (사람 판정으로 보정: src/lib/eval/calibration.json) */
export const DOODLE_MIN = calibration.doodle.show / 100;
/** 도형과 닮은 코스를 목록에 보여 줄 최소 유사도 */
export const SIMILARITY_MIN = calibration.similarity.show;

export type Grade = "또렷함" | "그럭저럭" | "희미함";

/** 점수 → 등급. 낙서 인식 확신도는 사람이 알아보는 비율과 어긋나기 쉬워 숫자 대신 등급으로 보여 준다 */
export function courseGrade(c: RouteCandidate): Grade {
  const g = c.doodle ? calibration.doodle : calibration.similarity;
  return c.similarity >= g.clear ? "또렷함" : c.similarity >= g.fair ? "그럭저럭" : "희미함";
}
/** 낙서 인식 결과로 보여 줄 최대 코스 수 · 같은 이름 최대 수 */
export const DOODLE_MAX = 8;
export const DOODLE_PER_NAME = 2;

/** 인식 결과 → 보여 줄 코스: 확신 높은 순, 같은 자리는 하나·같은 이름은 2개까지, 최대 8개 */
export function pickDoodles(pool: RouteCandidate[], rec: Array<Recognized | null>): RouteCandidate[] {
  const ranked = pool
    .map((c, i) => ({ c, r: rec[i] }))
    .filter((x): x is { c: RouteCandidate; r: Recognized } => !!x.r && (x.r.model === "clip" ? x.r.accepted === true : x.r.prob >= DOODLE_MIN))
    .sort((a, b) => b.r.prob - a.r.prob);
  const out: RouteCandidate[] = [];
  const perName = new Map<string, number>();
  for (const { c, r } of ranked) {
    if (out.length >= DOODLE_MAX) break;
    if ((perName.get(r.name) ?? 0) >= DOODLE_PER_NAME || out.some((d) => overlap(c, d))) continue;
    perName.set(r.name, (perName.get(r.name) ?? 0) + 1);
    out.push({
      ...c,
      id: `dd-${c.id}`,
      shapeId: "doodle",
      shapeName: r.label ?? doodleKo(r.name),
      // 모델이 본 이름은 처음 맞춰 본 그림과 다를 수 있으므로 그 그림 외곽선은 보여 주지 않는다
      outline: [],
      outlines: [],
      similarity: Math.round(r.prob * 100),
      doodle: { name: r.name, prob: r.prob, ...(r.model ? { model: r.model, margin: r.margin } : {}) },
    });
  }
  return out;
}

/**
 * 동네 추천 결과 목록: 낙서 인식으로 이름 붙인 코스를 앞에, 도형과 닮은 코스(자리가 겹치지 않는 것)를 뒤에.
 * 인식이 실패하거나 timeoutMs를 넘기면 도형 결과만 돌려주고 doodleError를 알린다.
 */
export async function nameDiscoveries(
  templ: RouteCandidate[],
  pool: RouteCandidate[],
  recognize: (cs: RouteCandidate[]) => Promise<Array<Recognized | null>>,
  timeoutMs: number,
): Promise<{ candidates: RouteCandidate[]; doodleError: boolean }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rec = await Promise.race([
      recognize(pool),
      new Promise<never>((_, fail) => {
        timer = setTimeout(() => fail(new Error("doodle_timeout")), timeoutMs);
      }),
    ]);
    const named = pickDoodles(pool, rec);
    return { candidates: [...named, ...templ.filter((c) => !named.some((d) => overlap(c, d)))], doodleError: false };
  } catch {
    return { candidates: templ, doodleError: true };
  } finally {
    clearTimeout(timer);
  }
}

/** 코스 중 이동 구간들의 좌표 */
export function moveLines(c: { latlngs: [number, number][]; moves?: Array<[number, number]> }): [number, number][][] {
  return (c.moves ?? []).map(([a, b]) => c.latlngs.slice(a, b + 1));
}

/** 목록 제목: 낙서 인식 '○○처럼 보이는 코스', 동네 추천 '○○ 닮은 코스', 지정 그림은 이름 그대로 */
export function courseTitle(c: RouteCandidate, discover: boolean): string {
  if (c.shapeId === "run") return `러닝 코스 · 차 없는 길 ${Math.round(c.roadInfo.carFree * 100)}%`;
  if (c.semanticExplanation?.decision === "interpretation") return `${c.semanticExplanation.label.ko}처럼 보이는 코스`;
  if (c.doodle) return `${c.shapeName}처럼 보이는 코스`;
  return discover ? `${c.shapeName} 닮은 코스` : c.shapeName;
}

/** 목록 배지: 낙서 인식은 등급 (모델 확신도 숫자는 사람이 알아보는 비율과 달라 그대로 보이지 않는다), 도형은 유사도 */
export function courseBadge(c: RouteCandidate): string {
  if (c.shapeId === "run") return `쾌적 ${c.similarity}`;
  if (c.semanticExplanation?.decision === "interpretation") return "AI 해석 · 참고 그림";
  if (c.doodle?.model === "clip") return "AI 해석 · 실험";
  return c.doodle ? `인식 · ${courseGrade(c)}` : `유사도 ${c.similarity}`;
}

/**
 * 이미지로 만든 그림의 윤곽을 코스 위에 겹치기: 획 좌표(points) → 지도 외곽선(outline)은 이동·회전·균일 확대라
 * 두 점열로 그 변환을 구하고(최소제곱), 원본 화면 픽셀 좌표 → [위도, 경도] 함수를 돌려준다.
 */
export function pixelToLatLng(
  points: readonly (readonly [number, number])[],
  outline: readonly (readonly [number, number])[],
  frame: { cx: number; cy: number; size: number },
): ((u: number, v: number) => [number, number]) | null {
  const n = Math.min(points.length, outline.length);
  if (n < 2) return null;
  const [lat0, lon0] = outline[0];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const W = outline.slice(0, n).map(([lat, lon]) => [(lon - lon0) * kx, lat - lat0]);
  const Z = points.slice(0, n);
  const mean = (a: readonly (readonly number[])[], i: number) => a.reduce((s, p) => s + p[i], 0) / n;
  const zx = mean(Z, 0), zy = mean(Z, 1), wx = mean(W, 0), wy = mean(W, 1);
  // 복소수 w = a·z + b 의 최소제곱 해
  let re = 0, im = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = Z[i][0] - zx, dy = Z[i][1] - zy, ex = W[i][0] - wx, ey = W[i][1] - wy;
    re += ex * dx + ey * dy;
    im += ey * dx - ex * dy;
    den += dx * dx + dy * dy;
  }
  if (!(den > 0)) return null;
  const ar = re / den, ai = im / den;
  return (u, v) => {
    const x = (u - frame.cx) / frame.size - zx, y = (-v - frame.cy) / frame.size - zy;
    const px = wx + ar * x - ai * y, py = wy + ai * x + ar * y;
    return [lat0 + py, lon0 + px / kx];
  };
}
