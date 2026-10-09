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
    .filter((x): x is { c: RouteCandidate; r: Recognized } => !!x.r && x.r.prob >= DOODLE_MIN)
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
      shapeName: doodleKo(r.name),
      // 모델이 본 이름은 처음 맞춰 본 그림과 다를 수 있으므로 그 그림 외곽선은 보여 주지 않는다
      outline: [],
      outlines: [],
      similarity: Math.round(r.prob * 100),
      doodle: { name: r.name, prob: r.prob },
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
  if (c.doodle) return `${c.shapeName}처럼 보이는 코스`;
  return discover ? `${c.shapeName} 닮은 코스` : c.shapeName;
}

/** 목록 배지: 낙서 인식은 등급 (모델 확신도 숫자는 사람이 알아보는 비율과 달라 그대로 보이지 않는다), 도형은 유사도 */
export function courseBadge(c: RouteCandidate): string {
  return c.doodle ? `인식 · ${courseGrade(c)}` : `유사도 ${c.similarity}`;
}
