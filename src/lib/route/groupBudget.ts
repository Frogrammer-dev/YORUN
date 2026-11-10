// 여러 획 그림 탐색 시간 (ms). 탐색과 화면 안내가 같은 식을 쓴다.
// 6획까지는 예전과 같고, 그보다 많으면 획 수에 비례해 늘린다(획마다 배치를 같은 만큼 시험하도록). 최대 150초.
export const GROUP_BASE_PARTS = 6;
export const GROUP_MAX_MS = 150_000;

export function groupBudgetMs(partCount: number, tiles = 1): number {
  const base = Math.min(75_000, 35_000 * tiles);
  return Math.min(Math.max(base, GROUP_MAX_MS), base * Math.max(1, partCount / GROUP_BASE_PARTS));
}
