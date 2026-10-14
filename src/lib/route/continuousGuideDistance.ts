type XY = readonly [number, number];

/** 실제 선분 일부의 point-to-finite-guide-segment 거리 적분. 반환 단위는 m²다. */
export function continuousGuideDistance(a: XY, b: XY, c: XY, d: XY, from = 0, to = 1): number {
  if (from > to || from < 0 || to > 1 || ![...a, ...b, ...c, ...d, from, to].every(Number.isFinite)) throw new Error('Invalid finite continuous guide integration input');
  const vx = b[0] - a[0], vy = b[1] - a[1], length = Math.hypot(vx, vy); if (!length || from === to) return 0;
  const wx = d[0] - c[0], wy = d[1] - c[1], w2 = wx * wx + wy * wy, cuts = [from, to];
  if (w2) { const u0 = ((a[0] - c[0]) * wx + (a[1] - c[1]) * wy) / w2, slope = (vx * wx + vy * wy) / w2; if (slope) for (const target of [0, 1]) { const t = (target - u0) / slope; if (t > from && t < to) cuts.push(t); } }
  cuts.sort((a, b) => a - b);
  const pointIntegral = (p: XY, lo: number, hi: number) => {
    const rx = a[0] - p[0], ry = a[1] - p[1], along = (rx * vx + ry * vy) / length, height = Math.abs(rx * vy - ry * vx) / length;
    const primitive = (z: number) => height < 1e-12 ? .5 * z * Math.abs(z) : .5 * (z * Math.hypot(z, height) + height * height * Math.asinh(z / height));
    return Math.max(0, primitive(along + hi * length) - primitive(along + lo * length));
  };
  let answer = 0;
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1], hi = cuts[i], mid = (lo + hi) / 2, px = a[0] + mid * vx, py = a[1] + mid * vy, u = w2 ? ((px - c[0]) * wx + (py - c[1]) * wy) / w2 : -1;
    if (u <= 0) answer += pointIntegral(c, lo, hi);
    else if (u >= 1) answer += pointIntegral(d, lo, hi);
    else {
      const base = ((a[0] - c[0]) * wy - (a[1] - c[1]) * wx) / Math.sqrt(w2), slope = (vx * wy - vy * wx) / Math.sqrt(w2), split = slope ? -base / slope : Infinity, pieces = split > lo && split < hi ? [lo, split, hi] : [lo, hi];
      for (let j = 1; j < pieces.length; j++) answer += length * (pieces[j] - pieces[j - 1]) * (Math.abs(base + pieces[j - 1] * slope) + Math.abs(base + pieces[j] * slope)) / 2;
    }
  }
  return answer;
}
