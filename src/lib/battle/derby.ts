// 모드 B: 8인 드로잉 더비 (저장된 기록으로 계산해 재생하는 비동기 레이스)
// 구간별 페이스와 코너링이 속도를 정한다. 거리는 쓰지 않는다.

import { seededRandom } from "./seed";
import type { RunStats } from "./analysis";

export const DERBY_MAX_RUNNERS = 8;
export const DERBY_SECTIONS = 12;
export const DERBY_SECTION_M = 100;

export const DERBY_RULES = {
  /** 기준 속도 (6:00/km) */
  refSpeed: 1000 / 360,
  /** 1보다 작을수록 페이스 차이를 줄인다. 빠른 사람이 항상 이기지 않게 하는 값이다 */
  paceExponent: 0.15,
  /** 코너 구간 속도 배율: 코너 점수 0일 때와 1일 때 */
  cornerSlow: 0.78, cornerFast: 1.06,
  /** 코너 뒤 직선 스퍼트: 발동 확률은 그 코너 점수에 비례한다 */
  skillChanceRate: 0.5, skillBoost: 1.12,
  /** 경기 전체의 컨디션 흔들림과 구간마다의 흔들림 */
  formVariance: 0.03, variance: 0.03,
} as const;

export type DerbyStats = Pick<RunStats, "paceSplits" | "avgPaceSecPerKm" | "corners" | "cornering">;
export interface DerbyRunner {
  id: string;
  stats: DerbyStats;
  /** 지금 함께 달리는 사람이 아니라 지난 기록임을 화면에 밝히기 위한 표시 */
  ghost?: boolean;
}
export type SectionKind = "straight" | "corner";
export interface DerbyEvent { section: number; runner: string; kind: "corner-spurt" }
export interface DerbyEntry {
  id: string;
  ghost: boolean;
  rank: number;
  finishSeconds: number;
  /** 구간이 끝난 시각. 화면은 이 값을 보간해 재생한다 */
  splits: number[];
}
export interface DerbyResult { sections: SectionKind[]; entries: DerbyEntry[]; events: DerbyEvent[] }

/** 코너 수는 시드와 무관하게 일정하고 위치만 달라진다 (직선 연속 최대 2칸) */
export function derbyTrack(seed: string): SectionKind[] {
  const random = seededRandom(`track:${seed}`);
  const out: SectionKind[] = [];
  for (let i = 0; i < DERBY_SECTIONS; i += 2) {
    const cornerFirst = random() < 0.5;
    out.push(cornerFirst ? "corner" : "straight", cornerFirst ? "straight" : "corner");
  }
  return out;
}

function validate(runners: readonly DerbyRunner[]) {
  if (runners.length < 2 || runners.length > DERBY_MAX_RUNNERS) throw new Error(`더비 참가자는 2~${DERBY_MAX_RUNNERS}명입니다`);
  if (new Set(runners.map((r) => r.id)).size !== runners.length) throw new Error("참가자 id가 겹칩니다");
  for (const r of runners) if (!(r.stats.avgPaceSecPerKm > 0)) throw new Error(`기록이 없는 참가자입니다: ${r.id}`);
}

export function simulateDerby(runners: readonly DerbyRunner[], seed: string): DerbyResult {
  validate(runners);
  const rules = DERBY_RULES;
  const sections = derbyTrack(seed);
  const events: DerbyEvent[] = [];

  const raced = runners.map((runner) => {
    // 참가자마다 난수를 나눠 참가자 구성이 바뀌어도 서로의 흔들림이 섞이지 않게 한다
    const random = seededRandom(`derby:${seed}:${runner.id}`);
    const { paceSplits, avgPaceSecPerKm, corners, cornering } = runner.stats;
    const form = 1 + (random() * 2 - 1) * rules.formVariance;
    let elapsed = 0, cornerNo = 0, spurt = false;
    const splits: number[] = [];
    sections.forEach((kind, i) => {
      const pace = paceSplits.length ? paceSplits[Math.floor((i / sections.length) * paceSplits.length)] : avgPaceSecPerKm;
      let speed = form * rules.refSpeed * Math.pow(1000 / pace / rules.refSpeed, rules.paceExponent);
      // 스퍼트 난수도 코너가 아닌 구간까지 항상 뽑아 구간별 흐름을 고정한다
      const roll = random();
      if (kind === "corner") {
        const score = corners.length ? corners[cornerNo % corners.length] : cornering;
        cornerNo++;
        speed *= rules.cornerSlow + (rules.cornerFast - rules.cornerSlow) * score;
        if (roll < score * rules.skillChanceRate) {
          spurt = true;
          events.push({ section: i, runner: runner.id, kind: "corner-spurt" });
        }
      } else if (spurt) {
        speed *= rules.skillBoost;
        spurt = false;
      }
      speed *= 1 + (random() * 2 - 1) * rules.variance;
      elapsed += DERBY_SECTION_M / speed;
      splits.push(elapsed);
    });
    return { id: runner.id, ghost: runner.ghost ?? false, finishSeconds: elapsed, splits };
  });

  const entries = [...raced]
    .sort((a, b) => a.finishSeconds - b.finishSeconds || (a.id < b.id ? -1 : 1))
    .map((e, i) => ({ ...e, rank: i + 1 }));
  events.sort((a, b) => a.section - b.section || (a.runner < b.runner ? -1 : 1));
  return { sections, entries, events };
}
