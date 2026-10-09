// 탐색 예산: 코스 탐색이 '얼마나 더 찾아볼지'를 정한다.
// - 앱: 시간 예산 (느린 기기에서도 기다림이 끝나도록)
// - 테스트·품질 평가: 단계 예산 (같은 입력이면 기기 속도와 상관없이 항상 같은 결과)
// 탐색 코드는 무거운 일 한 번(배치 하나 잇기, 고리 하나 키우기 등)마다 spend()를 부르고,
// ok(비율)로 '전체 예산의 이 비율까지 썼는가'를 묻는다.

export interface Budget {
  /** 전체 예산의 fraction(0~1)만큼을 아직 넘지 않았는가 */
  ok(fraction?: number): boolean;
  /** 무거운 일 n번을 했다 */
  spend(units?: number): void;
  /** 남은 예산 비율 (0~1) — 하위 탐색에 넘길 때 참고용 */
  remaining(): number;
}

export class TimeBudget implements Budget {
  private readonly start: number;
  constructor(
    private readonly ms: number,
    private readonly now: () => number = Date.now,
  ) {
    this.start = now();
  }
  ok(fraction = 1) {
    return this.now() - this.start <= this.ms * fraction;
  }
  spend() {}
  remaining() {
    return Math.max(0, 1 - (this.now() - this.start) / this.ms);
  }
}

export class StepBudget implements Budget {
  private used = 0;
  constructor(private readonly steps: number) {}
  ok(fraction = 1) {
    return this.used <= this.steps * fraction;
  }
  spend(units = 1) {
    this.used += units;
  }
  remaining() {
    return Math.max(0, 1 - this.used / this.steps);
  }
  /** 쓴 단계 수 (테스트 진단용) */
  get spent() {
    return this.used;
  }
}

/** 옵션으로 받은 예산, 없으면 기본 시간 예산 */
export function budgetOf(o: { budget?: Budget; timeBudgetMs?: number }, defaultMs: number): Budget {
  return o.budget ?? new TimeBudget(o.timeBudgetMs ?? defaultMs);
}
