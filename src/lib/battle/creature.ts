// 달린 그림을 생명체로 본다: 머리·손·발 위치를 찾고, 부위를 움직이면 몸이 함께 휘어진다 (순수 함수).

type Pt = [number, number];

export type PartName = "head" | "handL" | "handR" | "footL" | "footR";
export interface Part {
  at: Pt;
  /** 그림에 튀어나온 곳이 없어 막대 팔다리를 붙인 경우 */
  stub: boolean;
}
export interface Creature {
  /** 고르게 다시 찍은 그림 선 (화면 y는 아래로 증가하는 0~1 좌표) */
  lines: Pt[][];
  center: Pt;
  parts: Record<PartName, Part>;
}

const STEP = 0.01;

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

// 화면 좌표 각도(도, y 아래) 구간: 머리는 위, 손은 옆, 발은 아래
const SECTORS: Record<PartName, { from: number; to: number; dir: number }> = {
  head: { from: -135, to: -45, dir: -90 },
  handR: { from: -45, to: 30, dir: -10 },
  footR: { from: 30, to: 90, dir: 65 },
  footL: { from: 90, to: 150, dir: 115 },
  handL: { from: 150, to: 225, dir: 190 },
};

export function makeCreature(renderLines: Pt[][]): Creature {
  const lines = renderLines.filter((l) => l.length > 0).map(resample);
  const pts = lines.flat();
  const center: Pt = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  const dists = pts.map((p) => Math.hypot(p[0] - center[0], p[1] - center[1]));
  const radius = [...dists].sort((a, b) => a - b)[Math.floor(dists.length / 2)] || 0.2;

  const parts = {} as Record<PartName, Part>;
  for (const [name, s] of Object.entries(SECTORS) as [PartName, (typeof SECTORS)[PartName]][]) {
    // 발: 옆으로 긴 몸(강아지)은 다리 끝이 중심에서 그리 멀지 않다 → 좌우 절반에서 가장 아래 점을 발로 본다
    if (name === "footL" || name === "footR") {
      const side = pts.filter((p) => (name === "footL" ? p[0] < center[0] : p[0] >= center[0]));
      // 아래쪽이면서 바깥쪽 (평평한 밑면이면 두 발이 가운데로 몰리지 않게 모서리를 고른다)
      const score = (p: Pt) => p[1] + 0.3 * Math.abs(p[0] - center[0]);
      const low = side.reduce<Pt | null>((b, p) => (!b || score(p) > score(b) ? p : b), null);
      if (low && low[1] - center[1] > radius * 0.6) {
        parts[name] = { at: low, stub: false };
        continue;
      }
    }
    let best = -1,
      bestD = 0;
    pts.forEach((p, i) => {
      let a = (Math.atan2(p[1] - center[1], p[0] - center[0]) * 180) / Math.PI;
      if (a < s.from) a += 360;
      if (a >= s.from && a < s.to && dists[i] > bestD) {
        best = i;
        bestD = dists[i];
      }
    });
    // 중심 근처밖에 없으면 튀어나온 곳이 아니다 → 몸 바깥에 막대 팔다리를 붙인다 (오히려 더 우스꽝스럽다)
    if (best >= 0 && bestD > radius * 1.3) parts[name] = { at: pts[best], stub: false };
    else {
      const r = (s.dir * Math.PI) / 180,
        len = Math.max(bestD, radius) + 0.12;
      parts[name] = { at: [center[0] + Math.cos(r) * len, center[1] + Math.sin(r) * len], stub: true };
    }
  }
  return { lines, center, parts };
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
