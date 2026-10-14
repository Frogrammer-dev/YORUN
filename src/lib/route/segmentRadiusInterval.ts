type Point = readonly [number, number];

/** Search correspondence only: no route node or road edge is created. */
export function segmentRadiusInterval(a: Point, b: Point, checkpoint: Point, radius: number): [number, number] | null {
  if (![...a, ...b, ...checkpoint, radius].every(Number.isFinite) || radius < 0) throw new Error('Invalid segment correspondence input');
  const dx = b[0] - a[0], dy = b[1] - a[1], wx = checkpoint[0] - a[0], wy = checkpoint[1] - a[1];
  const lengthSquared = dx * dx + dy * dy, radiusSquared = radius * radius;
  if (lengthSquared === 0) return wx * wx + wy * wy <= radiusSquared ? [0, 1] : null;
  const cross = dx * wy - dy * wx, perpendicularSquared = cross * cross / lengthSquared;
  if (perpendicularSquared > radiusSquared) return null;
  const center = (wx * dx + wy * dy) / lengthSquared;
  const half = Math.sqrt((radiusSquared - perpendicularSquared) / lengthSquared);
  const lo = Math.max(0, center - half), hi = Math.min(1, center + half);
  return lo <= hi ? [lo, hi] : null;
}
