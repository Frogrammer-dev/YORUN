// 흑백 픽셀(1 = 그림) → 바깥 윤곽선들. 글자·이미지를 달릴 그림으로 바꿀 때 쓴다.
// 마칭 스퀘어로 픽셀 경계를 따라 닫힌 선을 만들고, 다른 윤곽 안에 든 구멍(예: 0·8의 안쪽)은 뺀다.

export type Pt = [number, number];

function area(p: Pt[]): number {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1];
  return a / 2;
}

function inside(px: number, py: number, poly: Pt[]): boolean {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (poly[i][1] > py !== poly[j][1] > py && px < ((poly[j][0] - poly[i][0]) * (py - poly[i][1])) / (poly[j][1] - poly[i][1]) + poly[i][0]) r = !r;
  }
  return r;
}

/**
 * 바깥 윤곽선 목록 (화면 좌표, y 아래로). 넓이가 큰 순.
 * minArea보다 작은 조각(잡티)은 버린다.
 */
export function traceOutlines(mask: Uint8Array, w: number, h: number, minArea = 4): Pt[][] {
  const at = (x: number, y: number) => (x >= 0 && y >= 0 && x < w && y < h ? mask[y * w + x] : 0);
  // 칸(x,y)의 네 모서리 픽셀: (x,y) (x+1,y) (x+1,y+1) (x,y+1). 칸 범위는 -1..w-1
  // 변 번호: 0 위, 1 오른쪽, 2 아래, 3 왼쪽 → 변 가운데 점
  const mid = (x: number, y: number, e: number): Pt =>
    e === 0 ? [x + 1, y + 0.5] : e === 1 ? [x + 1.5, y + 1] : e === 2 ? [x + 1, y + 1.5] : [x + 0.5, y + 1];
  // 경우별 잇는 변 쌍 (모서리 비트: 8 왼위, 4 오위, 2 오아래, 1 왼아래)
  const SEG: number[][][] = [
    [], [[3, 2]], [[2, 1]], [[3, 1]], [[0, 1]], [[3, 0], [2, 1]], [[0, 2]], [[3, 0]],
    [[0, 3]], [[0, 2]], [[0, 1], [2, 3]], [[0, 1]], [[1, 3]], [[1, 2]], [[2, 3]], [],
  ];
  const key = (p: Pt) => `${p[0]},${p[1]}`;
  const adj = new Map<string, { p: Pt; n: string[] }>();
  const link = (a: Pt, b: Pt) => {
    const ka = key(a), kb = key(b);
    if (!adj.has(ka)) adj.set(ka, { p: a, n: [] });
    if (!adj.has(kb)) adj.set(kb, { p: b, n: [] });
    adj.get(ka)!.n.push(kb);
    adj.get(kb)!.n.push(ka);
  };
  for (let y = -1; y < h; y++)
    for (let x = -1; x < w; x++) {
      const c = (at(x, y) << 3) | (at(x + 1, y) << 2) | (at(x + 1, y + 1) << 1) | at(x, y + 1);
      for (const [e1, e2] of SEG[c]) link(mid(x, y, e1), mid(x, y, e2));
    }
  const seen = new Set<string>();
  const loops: Pt[][] = [];
  for (const [k0, v0] of adj) {
    if (seen.has(k0)) continue;
    const loop: Pt[] = [v0.p];
    seen.add(k0);
    let prev = k0, cur = v0.n[0];
    while (cur && cur !== k0) {
      seen.add(cur);
      const node = adj.get(cur)!;
      loop.push(node.p);
      const next = node.n[0] === prev ? node.n[1] : node.n[0];
      prev = cur;
      cur = next;
      if (loop.length > 200_000) break;
    }
    if (loop.length >= 4 && Math.abs(area(loop)) >= minArea) loops.push(loop);
  }
  // 다른 윤곽 안에 몇 겹 들어 있는지로 구멍을 가린다 (짝수 겹 = 바깥 윤곽)
  const outer = loops.filter((l, i) => {
    let depth = 0;
    const [px, py] = l[0];
    for (let j = 0; j < loops.length; j++) if (j !== i && Math.abs(area(loops[j])) > Math.abs(area(l)) && inside(px, py, loops[j])) depth++;
    return depth % 2 === 0;
  });
  return outer.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
}

/** 회색조 값(0~255, 어두울수록 그림) → 흑백. 오츠 방법으로 경계값을 정한다. */
export function binarize(gray: Uint8Array, alpha?: Uint8Array): Uint8Array {
  const hist = new Array(256).fill(0);
  let n = 0;
  for (let i = 0; i < gray.length; i++) {
    if (alpha && alpha[i] < 128) continue;
    hist[gray[i]]++;
    n++;
  }
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) (best = between), (thr = t);
  }
  const out = new Uint8Array(gray.length);
  let ink = 0;
  for (let i = 0; i < gray.length; i++) {
    out[i] = (!alpha || alpha[i] >= 128) && gray[i] <= thr ? 1 : 0;
    ink += out[i];
  }
  // 그림이 배경보다 많으면 밝은 쪽이 그림 (어두운 배경 위 밝은 그림)
  if (ink > gray.length / 2 && !alpha) for (let i = 0; i < out.length; i++) out[i] ^= 1;
  return out;
}
