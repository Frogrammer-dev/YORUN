// 달린 그림을 생명체로 본다: 머리·손·발 위치를 찾고, 부위를 움직이면 몸이 함께 휘어진다 (순수 함수).

type Pt = [number, number];

export type PartName = "head" | "handL" | "handR" | "footL" | "footR";
export interface Part {
  at: Pt;
  /** 그림에 튀어나온 곳이 없어 윤곽선에서 짧은 팔다리를 뻗은 경우 */
  stub: boolean;
  /** 짧은 팔다리가 시작하는 윤곽선 위의 점 */
  root?: Pt;
}
export interface Creature {
  /** 고르게 다시 찍은 그림 선 (화면 y는 아래로 증가하는 0~1 좌표). 머리가 오른쪽을 보도록 맞춰 둔다 */
  lines: Pt[][];
  center: Pt;
  parts: Record<PartName, Part>;
  /** 두 눈의 가운데. 항상 몸 안쪽이다 */
  eye: Pt;
  eyeRadius: number;
}

const STEP = 0.01;
/** 튀어나온 곳으로 인정하는 높이: 몸 평균 반지름 대비. 도로 코스의 작은 요철을 걸러 낸다 */
const MIN_PROMINENCE = 0.14;
/** 눈이 윤곽선에서 떨어져 있어야 하는 거리 */
const EYE_MARGIN = 0.055;
const STUB_LENGTH = 0.11;

/** 선을 STEP 간격으로 다시 찍는다 (점이 고르게 있어야 무게중심과 몸 비틀기가 자연스럽다) */
function resample(line: Pt[]): Pt[] {
  const out: Pt[] = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1],
      [bx, by] = line[i];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / STEP));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

function pointInside([x, y]: Pt, polygon: Pt[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const distanceTo = (p: Pt, points: Pt[]) => Math.sqrt(points.reduce((best, q) => Math.min(best, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2), Infinity));

/** 넓이 중심. 선이 겹쳐 넓이가 거의 없으면 점들의 평균을 쓴다 */
function centroid(polygon: Pt[]): Pt {
  let area = 0, cx = 0, cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const cross = polygon[j][0] * polygon[i][1] - polygon[i][0] * polygon[j][1];
    area += cross;
    cx += (polygon[j][0] + polygon[i][0]) * cross;
    cy += (polygon[j][1] + polygon[i][1]) * cross;
  }
  if (Math.abs(area) > 1e-4) return [cx / (3 * area), cy / (3 * area)];
  return [polygon.reduce((s, p) => s + p[0], 0) / polygon.length, polygon.reduce((s, p) => s + p[1], 0) / polygon.length];
}

/** 윤곽을 한 바퀴 돌며 중심에서 멀어지는 봉우리를 찾는다. 양옆 골짜기보다 충분히 높은 곳만 남긴다 */
function findProtrusions(outline: Pt[], center: Pt): Pt[] {
  const n = outline.length;
  const raw = outline.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
  const span = Math.max(2, Math.round(n * 0.012));
  const radial = raw.map((_, i) => {
    let sum = 0;
    for (let k = -span; k <= span; k++) sum += raw[(i + k + n) % n];
    return sum / (2 * span + 1);
  });
  const mean = radial.reduce((s, r) => s + r, 0) / n;
  const peaks: { index: number; prominence: number }[] = [];
  for (let i = 0; i < n; i++) {
    let isPeak = true;
    for (let k = 1; k <= span && isPeak; k++) if (radial[(i + k) % n] > radial[i] || radial[(i - k + n) % n] > radial[i]) isPeak = false;
    if (!isPeak) continue;
    const walk = (dir: 1 | -1) => {
      let low = radial[i];
      for (let k = 1; k < n; k++) {
        const r = radial[(i + dir * k + n * 2) % n];
        if (r > radial[i]) break;
        low = Math.min(low, r);
      }
      return low;
    };
    const prominence = radial[i] - Math.max(walk(1), walk(-1));
    if (prominence >= mean * MIN_PROMINENCE) peaks.push({ index: i, prominence });
  }
  // 평평한 꼭대기는 같은 봉우리가 여러 번 잡히므로 가까운 것을 합친다
  const kept: { index: number; prominence: number }[] = [];
  for (const peak of [...peaks].sort((p, q) => q.prominence - p.prominence)) {
    if (kept.every((other) => Math.hypot(outline[other.index][0] - outline[peak.index][0], outline[other.index][1] - outline[peak.index][1]) > 0.06)) kept.push(peak);
  }
  return kept.map((peak) => {
    // 부드럽게 한 봉우리 근처에서 실제로 가장 먼 점을 고른다
    let best = peak.index;
    for (let k = -span; k <= span; k++) if (raw[(peak.index + k + n) % n] > raw[best]) best = (peak.index + k + n) % n;
    return outline[best];
  });
}

/** 점 둘레 원 안에서 몸 안쪽인 비율. 머리처럼 두툼하면 크고 꼬리처럼 얇으면 작다 */
function thickness(p: Pt, polygon: Pt[]) {
  let inside = 0, total = 0;
  for (let ring = 1; ring <= 2; ring++) {
    for (let k = 0; k < 12; k++) {
      const angle = (k / 12) * Math.PI * 2;
      total++;
      if (pointInside([p[0] + Math.cos(angle) * 0.07 * ring, p[1] + Math.sin(angle) * 0.07 * ring], polygon)) inside++;
    }
  }
  return inside / total;
}

function build(lines: Pt[][], allowMirror: boolean): Creature {
  const outline = [...lines].sort((p, q) => q.length - p.length)[0];
  const pts = lines.flat();
  const center = centroid(outline);
  const dists = pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
  const radius = [...dists].sort((p, q) => p - q)[Math.floor(dists.length / 2)] || 0.2;
  const peaks = findProtrusions(outline, center);
  const top = Math.min(...pts.map((p) => p[1])), bottom = Math.max(...pts.map((p) => p[1]));
  const height = bottom - top || 1;
  const parts = {} as Record<PartName, Part>;
  const used: Pt[] = [];

  // 발: 좌우 절반에서 가장 아래이면서 바깥쪽인 점. 평평한 밑면이면 두 발이 가운데로 몰리지 않게 모서리를 고른다
  for (const name of ["footL", "footR"] as const) {
    const side = pts.filter((p) => (name === "footL" ? p[0] < center[0] : p[0] >= center[0]));
    const score = (p: Pt) => p[1] + 0.3 * Math.abs(p[0] - center[0]);
    const low = side.reduce<Pt | null>((best, p) => (!best || score(p) > score(best) ? p : best), null);
    if (low && low[1] - center[1] > radius * 0.5) {
      parts[name] = { at: low, stub: false };
      used.push(low);
    } else {
      // 아래로 내려온 곳이 없다: 몸 맨 아래 윤곽선에서 짧은 다리를 뻗는다
      const root = side.length ? side.reduce((best, p) => (p[1] > best[1] ? p : best), side[0]) : outline[0];
      parts[name] = { at: [root[0] + (name === "footL" ? -0.03 : 0.03), root[1] + STUB_LENGTH], stub: true, root };
    }
  }
  const free = peaks.filter((p) => used.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.08));

  // 머리: 위쪽 봉우리 중 두툼한 곳. 없으면 윤곽의 맨 위. 머리에는 막대를 세우지 않는다
  const upper = free.filter((p) => p[1] < center[1] + height * 0.12);
  // 좌우 대칭이면 점수가 같으니 앞쪽(+x)을 고른다
  const headScore = (p: Pt) => (center[1] - p[1]) + thickness(p, outline) * 0.6 + (p[0] - center[0]) * 0.02;
  const head = upper.length
    ? upper.reduce((best, p) => (headScore(p) > headScore(best) ? p : best), upper[0])
    : outline.reduce((best, p) => (p[1] < best[1] ? p : best), outline[0]);
  parts.head = { at: head, stub: false };
  used.push(head);

  // 머리가 왼쪽이면 뒤집어서 늘 앞(상대 쪽)을 보게 한다
  if (allowMirror && head[0] < center[0] - 0.02) return build(lines.map((line) => line.map((p): Pt => [1 - p[0], p[1]])), false);

  // 손: 남은 봉우리 중 옆쪽. 없으면 몸 옆 윤곽선에서 짧은 팔을 뻗는다
  for (const name of ["handL", "handR"] as const) {
    const direction = name === "handL" ? -1 : 1;
    const candidates = peaks.filter((p) => Math.sign(p[0] - center[0]) === direction && Math.abs(p[1] - center[1]) < height * 0.42 && used.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.08));
    if (candidates.length) {
      const at = candidates.reduce((best, p) => (Math.abs(p[0] - center[0]) > Math.abs(best[0] - center[0]) ? p : best), candidates[0]);
      parts[name] = { at, stub: false };
      used.push(at);
    } else {
      const band = outline.filter((p) => Math.abs(p[1] - center[1]) < height * 0.12 && Math.sign(p[0] - center[0]) === direction);
      const pool = band.length ? band : outline;
      const root = pool.reduce((best, p) => (direction * p[0] > direction * best[0] ? p : best), pool[0]);
      parts[name] = { at: [root[0] + direction * STUB_LENGTH, root[1] - 0.02], stub: true, root };
    }
  }

  // 눈: 머리에서 몸 중심으로 들어오며 윤곽선과 여유가 생기는 첫 자리. 좁으면 가장 넓은 자리에 작게 둔다
  let eye: Pt = center, margin = pointInside(center, outline) ? distanceTo(center, outline) : 0;
  let found = false;
  for (let t = 0.08; t <= 1 && !found; t += 0.04) {
    const p: Pt = [head[0] + (center[0] - head[0]) * t, head[1] + (center[1] - head[1]) * t];
    if (!pointInside(p, outline)) continue;
    const d = distanceTo(p, outline);
    if (d >= EYE_MARGIN) {
      eye = p;
      margin = d;
      found = true;
    } else if (d > margin) {
      eye = p;
      margin = d;
    }
  }
  return { lines, center, parts, eye, eyeRadius: Math.max(0.014, Math.min(0.035, margin * 0.5)) };
}

export function makeCreature(renderLines: Pt[][]): Creature {
  return build(renderLines.filter((l) => l.length > 0).map(resample), true);
}

/**
 * 몸 비틀기: 각 점을 가까운 신체 부위의 움직임만큼 끌고 간다 (가우스 가중치).
 * moves[부위] = 그 부위를 옮길 양. 부위에서 멀어질수록 덜 따라간다.
 */
export function deform(c: Creature, moves: Partial<Record<PartName, Pt>>, sigma = 0.16): Pt[][] {
  const ms = (Object.entries(moves) as [PartName, Pt][]).map(([k, d]) => ({ a: c.parts[k].at, d }));
  const k = 1 / (2 * sigma * sigma);
  const move = ([x, y]: Pt): Pt => {
    let dx = 0,
      dy = 0;
    for (const { a, d } of ms) {
      const w = Math.exp(-((x - a[0]) ** 2 + (y - a[1]) ** 2) * k);
      dx += w * d[0];
      dy += w * d[1];
    }
    return [x + dx, y + dy];
  };
  return c.lines.map((l) => l.map(move));
}

/** 받침에 맞춰 조사를 붙인다. 끝 글자가 한글이 아니면 "이(가)"처럼 둘 다 적는다 */
export function josa(word: string, withFinal: string, without: string) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (c >= 0 && c < 11172 ? (c % 28 ? withFinal : without) : `${withFinal}(${without})`);
}

/**
 * 코스·도형 선(y 위로)을 생명체용 좌표로 바꾼다: y를 아래로, 0.9 상자에 맞추고 발이 0.95에 오게 한다.
 * 닫히지 않은 선은 닫아 준다.
 */
export function toRenderLine(line: readonly (readonly number[])[]): Pt[] {
  const xs = line.map((p) => p[0]), ys = line.map((p) => -p[1]);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const k = 0.9 / (Math.max(right - left, bottom - top) || 1);
  const out = line.map((p): Pt => [0.5 + (p[0] - (left + right) / 2) * k, 0.95 - (bottom - -p[1]) * k]);
  const first = out[0], last = out[out.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? out : [...out, first];
}
