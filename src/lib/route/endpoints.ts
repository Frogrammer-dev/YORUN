/** 탐색·저장된 실제 좌표 기준. 여러 닫힌 획을 이어도 전체 코스는 열려 있을 수 있다. */
export function isClosedRoute(points: readonly (readonly [number, number])[]): boolean {
  if (points.length < 3) return false;
  const first = points[0], last = points[points.length - 1];
  return first[0] === last[0] && first[1] === last[1];
}
