// 구간별 Ramer–Douglas–Peucker 단순화 (7.3). 끝점 보존·구간 병합 없음.
// 반환값은 원 구간의 오름차순 인덱스 목록이며, 단일점은 [0].

export type XY = readonly [number, number];

function pointSegmentDistance(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

export function rdpIndices(points: readonly XY[], tolerance: number): number[] {
  const n = points.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  // 재귀 대신 스택: 20,000점 구간에서도 호출 깊이 문제 없음.
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = pointSegmentDistance(points[i], points[s], points[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx !== -1 && maxD > tolerance) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}
