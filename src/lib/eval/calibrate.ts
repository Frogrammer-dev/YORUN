// 사람 판정으로 점수 기준선 정하기 (확신도 보정).
// 모델 확신도·유사도 숫자는 '사람이 실제로 알아볼 확률'과 어긋나기 쉽다 (Guo et al. 2017, Hendrycks & Gimpel 2017).
// 그래서 사람이 "알아볼 수 있다/없다"로 표시한 코스로, 점수가 몇 이상이면 실제로 몇 %가 알아볼 만했는지 재고
// 그 비율이 목표 이상이 되는 가장 낮은 점수를 기준선으로 고른다. 표본이 적을 때 들뜨지 않게 윌슨 하한을 쓴다.

export interface Judged {
  /** 화면에 보이는 점수 (유사도 0~100, 또는 인식 확신 0~100) */
  score: number;
  /** 사람이 이 이름(그림)으로 알아볼 수 있다고 했는가 */
  recognized: boolean;
}

export interface Row {
  threshold: number;
  /** 이 점수 이상인 코스 수 */
  n: number;
  /** 그중 사람이 알아본 비율 */
  precision: number;
  /** 95% 윌슨 하한 */
  lower: number;
}

/** 95% 윌슨 점수 구간의 하한 */
export function wilsonLower(k: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = k / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
}

/** 점수 기준선마다 '이 점수 이상이면 사람이 알아본 비율' 표 */
export function reliabilityTable(items: Judged[], thresholds: number[]): Row[] {
  return thresholds.map((t) => {
    const above = items.filter((i) => i.score >= t);
    const k = above.filter((i) => i.recognized).length;
    return { threshold: t, n: above.length, precision: above.length ? k / above.length : 0, lower: wilsonLower(k, above.length) };
  });
}

/** 윌슨 하한이 target 이상이고 표본이 minN 이상인 가장 낮은 기준선. 없으면 null */
export function pickThreshold(table: Row[], target: number, minN = 10): number | null {
  const ok = table.filter((r) => r.n >= minN && r.lower >= target).sort((a, b) => a.threshold - b.threshold);
  return ok[0]?.threshold ?? null;
}

export interface Grades {
  /** 목록에 보여 줄 최소 점수 */
  show: number;
  /** '그럭저럭' 이상 */
  fair: number;
  /** '또렷함' 이상 */
  clear: number;
}

/** 목표: 보여 주는 코스의 40%, '그럭저럭'은 60%, '또렷함'은 80% 이상을 사람이 알아볼 것 (95% 하한 기준) */
export const TARGETS = { show: 0.4, fair: 0.6, clear: 0.8 } as const;

/** 판정 자료 → 등급 기준선. 기준을 못 찾는 등급은 기존 값을 유지한다 */
export function calibrate(items: Judged[], current: Grades, thresholds = Array.from({ length: 81 }, (_, i) => 20 + i)): { grades: Grades; table: Row[] } {
  const table = reliabilityTable(items, thresholds);
  const show = pickThreshold(table, TARGETS.show) ?? current.show;
  const fair = Math.max(show, pickThreshold(table, TARGETS.fair) ?? current.fair);
  const clear = Math.max(fair, pickThreshold(table, TARGETS.clear) ?? current.clear);
  return { grades: { show, fair, clear }, table };
}
