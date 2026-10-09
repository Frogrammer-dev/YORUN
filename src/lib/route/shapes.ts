// 한붓으로 달릴 수 있는 그림 모양 (명세 15.1: 분리된 눈·수염은 한붓 버전에서 생략).
// 단위 좌표, y는 북쪽(위)이 양수, 닫힌 도형은 처음 점 = 마지막 점.

export type ShapeId =
  | "heart" | "star" | "circle" | "square" | "triangle" | "diamond" | "cat" | "fish" | "bolt"
  | "dog" | "rabbit" | "bird" | "whale" | "turtle" | "elephant" | "giraffe" | "butterfly" | "duck" | "house" | "tree" | "car" | "rocket" | "apple" | "crown" | "airplane" | "mug";

/** 그림 갈래: 기본 도형 · 동물 · 사물 */
export type ShapeKind = "basic" | "animal" | "object";
/** 기본 그림 또는 사용자가 직접 그린 그림 */
export type ShapeKey = ShapeId | "custom" | "doodle";

export interface ShapeDef {
  id: ShapeKey;
  name: string;
  emoji: string;
  /** 정규화된 외곽선(가로·세로 중 큰 쪽 = 1, 중심 0) */
  points: [number, number][];
  /** 꼭짓점이 뚜렷한 다각형이면 꼭짓점을 반드시 기준점으로 쓴다. */
  corners: boolean;
  /** 회전 대칭이 강해 회전 탐색이 의미 없는 도형 */
  rotationFree?: boolean;
  /** 그림 갈래 (없으면 기본 도형) */
  kind?: ShapeKind;
  perimeter: number;
  /** 45° 이상 꺾이는 꼭짓점(귀 끝·별 끝 등). 이 점이 코스에 담기지 않으면 그림이 무너진다. */
  features: [number, number][];
}

/** 닫힌 외곽선에서 minDeg 이상 꺾이는 꼭짓점 */
export function sharpVertices(points: readonly (readonly [number, number])[], minDeg = 45): [number, number][] {
  const pts = points.slice(0, -1);
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    let d = ((Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180) / Math.PI;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    if (Math.abs(d) >= minDeg) out.push([b[0], b[1]]);
  }
  return out;
}

function normalize(pts: [number, number][]): [number, number][] {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.max(maxX - minX, maxY - minY);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const out = pts.map(([x, y]) => [(x - cx) / s, (y - cy) / s] as [number, number]);
  const f = out[0], l = out[out.length - 1];
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]]);
  return out;
}

export function polylineLength(pts: readonly (readonly [number, number])[]): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

import { rdpIndices } from "@/lib/art/rdp";

const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** 화면 좌표(y 아래로) → 모양 좌표(y 위로) */
const fromScreen = (pts: [number, number][]): [number, number][] => pts.map(([x, y]) => [x, 100 - y]);

const RAW: Array<Omit<ShapeDef, "perimeter" | "points" | "features"> & { raw: [number, number][] }> = [
  {
    id: "heart",
    name: "하트",
    emoji: "❤️",
    corners: false,
    raw: range(72).map((i) => {
      const t = (i / 72) * Math.PI * 2;
      return [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)];
    }),
  },
  {
    id: "star",
    name: "별",
    emoji: "⭐",
    corners: true,
    raw: range(10).map((i) => {
      const r = i % 2 ? 0.42 : 1;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      return [Math.cos(a) * r, Math.sin(a) * r];
    }),
  },
  {
    id: "circle",
    name: "동그라미",
    emoji: "⭕",
    corners: false,
    rotationFree: true,
    raw: range(48).map((i) => [Math.cos((i / 48) * Math.PI * 2), Math.sin((i / 48) * Math.PI * 2)]),
  },
  { id: "square", name: "네모", emoji: "🟦", corners: true, raw: [[-1, -1], [1, -1], [1, 1], [-1, 1]] },
  { id: "triangle", name: "세모", emoji: "🔺", corners: true, raw: [[-1, -0.87], [1, -0.87], [0, 0.87]] },
  { id: "diamond", name: "다이아몬드", emoji: "🔷", corners: true, raw: [[0, -1], [0.7, 0], [0, 1], [-0.7, 0]] },
  {
    id: "cat",
    kind: "animal",
    name: "고양이",
    emoji: "🐱",
    corners: true,
    raw: [
      [0, -0.85], [0.5, -0.72], [0.8, -0.32], [0.86, 0.15], [0.74, 0.52], [0.86, 1.0], [0.42, 0.72], [0, 0.78],
      [-0.42, 0.72], [-0.86, 1.0], [-0.74, 0.52], [-0.86, 0.15], [-0.8, -0.32], [-0.5, -0.72],
    ],
  },
  {
    id: "fish",
    kind: "animal",
    name: "물고기",
    emoji: "🐟",
    corners: true,
    raw: [
      [1, 0], [0.65, 0.38], [0.15, 0.5], [-0.35, 0.32], [-0.65, 0], [-1, 0.42], [-1, -0.42], [-0.65, 0], [-0.35, -0.32], [0.15, -0.5], [0.65, -0.38],
    ],
  },
  {
    id: "bolt",
    name: "번개",
    emoji: "⚡",
    corners: true,
    raw: [[0.05, 1], [-0.5, -0.05], [-0.05, -0.05], [-0.3, -1], [0.5, 0.18], [0.05, 0.18], [0.4, 1]],
  },
  // ── 동물·사물 실루엣: 100×100 화면 좌표로 그린 뒤 y를 뒤집는다. 길 위에서 알아볼 수 있게 큰 윤곽 위주로 단순화했다.
  { id: "dog", name: "강아지", emoji: "", corners: true, kind: "animal", raw: fromScreen([[14,36],[62,36],[66,24],[72,16],[82,14],[90,20],[96,28],[90,34],[80,34],[78,44],[78,74],[70,74],[68,58],[30,58],[28,74],[20,74],[18,54],[14,46],[4,26],[8,24]]) },
  { id: "rabbit", name: "토끼", emoji: "", corners: true, kind: "animal", raw: fromScreen([[30,90],[20,82],[12,78],[12,70],[18,66],[20,56],[28,48],[40,44],[50,42],[52,28],[50,10],[54,6],[59,12],[61,28],[64,10],[68,6],[72,12],[67,32],[74,40],[78,48],[72,54],[62,56],[66,70],[70,84],[64,90]]) },
  { id: "bird", name: "새", emoji: "", corners: true, kind: "animal", raw: fromScreen([[20,60],[30,45],[45,38],[60,36],[66,28],[74,26],[80,30],[92,33],[80,37],[76,42],[70,55],[55,66],[40,68],[30,68],[8,80],[14,68]]) },
  { id: "whale", name: "고래", emoji: "", corners: true, kind: "animal", raw: fromScreen([[20,50],[35,32],[60,28],[82,36],[95,52],[88,64],[65,70],[40,68],[25,62],[12,72],[2,84],[6,64],[2,44],[12,54]]) },
  { id: "turtle", name: "거북이", emoji: "", corners: true, kind: "animal", raw: fromScreen([[44,22],[44,12],[50,5],[56,12],[56,22],[66,24],[74,18],[81,24],[75,32],[79,45],[79,58],[75,66],[81,74],[74,80],[66,74],[56,80],[50,88],[44,80],[34,74],[26,80],[19,74],[25,66],[21,58],[21,45],[25,32],[19,24],[26,18],[34,24]]) },
  { id: "elephant", name: "코끼리", emoji: "", corners: true, kind: "animal", raw: fromScreen([[10,40],[20,25],[40,20],[60,22],[70,15],[82,18],[90,30],[92,45],[94,62],[98,74],[91,75],[86,60],[84,48],[78,50],[76,80],[66,80],[64,62],[36,62],[34,80],[24,80],[22,60],[12,56],[4,62],[6,50]]) },
  { id: "giraffe", name: "기린", emoji: "", corners: true, kind: "animal", raw: fromScreen([[20,55],[30,48],[55,48],[60,30],[62,12],[66,6],[74,4],[82,8],[78,13],[70,14],[68,30],[66,50],[70,58],[70,92],[64,92],[62,66],[36,66],[34,92],[28,92],[26,62],[18,62],[8,72],[12,60]]) },
  { id: "butterfly", name: "나비", emoji: "", corners: true, kind: "animal", raw: fromScreen([[50,30],[40,12],[24,6],[10,12],[8,30],[20,44],[36,50],[18,58],[12,74],[22,88],[38,84],[48,66],[50,70],[52,66],[62,84],[78,88],[88,74],[82,58],[64,50],[80,44],[92,30],[90,12],[76,6],[60,12]]) },
  { id: "duck", name: "오리", emoji: "", corners: true, kind: "animal", raw: fromScreen([[15,55],[20,45],[35,42],[50,44],[56,30],[62,20],[72,18],[80,24],[92,28],[82,33],[76,36],[70,40],[72,50],[78,58],[72,70],[55,78],[30,78],[16,70],[4,48]]) },
  { id: "house", name: "집", emoji: "", corners: true, kind: "object", raw: fromScreen([[50,8],[90,42],[80,42],[80,90],[20,90],[20,42],[10,42]]) },
  { id: "tree", name: "나무", emoji: "", corners: true, kind: "object", raw: fromScreen([[50,5],[72,18],[80,36],[74,52],[56,58],[56,92],[44,92],[44,58],[26,52],[20,36],[28,18]]) },
  { id: "car", name: "자동차", emoji: "", corners: true, kind: "object", raw: fromScreen([[8,62],[10,48],[28,44],[38,30],[66,30],[78,44],[92,48],[94,62],[84,62],[80,70],[70,70],[66,62],[34,62],[30,70],[20,70],[16,62]]) },
  { id: "rocket", name: "로켓", emoji: "", corners: true, kind: "object", raw: fromScreen([[50,4],[60,16],[64,40],[64,62],[76,76],[76,92],[62,82],[56,90],[44,90],[38,82],[24,92],[24,76],[36,62],[36,40],[40,16]]) },
  { id: "apple", name: "사과", emoji: "", corners: true, kind: "object", raw: fromScreen([[50,22],[56,14],[62,5],[66,8],[60,18],[70,16],[84,26],[88,46],[80,72],[66,88],[56,86],[50,84],[44,86],[34,88],[20,72],[12,46],[16,26],[30,16]]) },
  { id: "crown", name: "왕관", emoji: "", corners: true, kind: "object", raw: fromScreen([[10,80],[10,30],[30,55],[50,20],[70,55],[90,30],[90,80]]) },
  { id: "airplane", name: "비행기", emoji: "", corners: true, kind: "object", raw: fromScreen([[50,4],[56,12],[56,36],[92,56],[92,64],[56,54],[56,78],[68,88],[68,94],[50,90],[32,94],[32,88],[44,78],[44,54],[8,64],[8,56],[44,36],[44,12]]) },
  { id: "mug", name: "컵", emoji: "", corners: true, kind: "object", raw: fromScreen([[20,20],[70,20],[70,32],[82,32],[90,42],[88,62],[78,70],[70,70],[70,88],[20,88]]) },
];

export const SHAPES: ShapeDef[] = RAW.map(({ raw, ...rest }) => {
  const points = normalize(raw);
  return { ...rest, points, perimeter: polylineLength(points), features: sharpVertices(points) };
});

export const SHAPE_BY_ID = Object.fromEntries(SHAPES.map((s) => [s.id, s])) as Record<ShapeId, ShapeDef>;

/** 호 길이 기준 균등 재표본 (닫힌 도형이면 마지막 점 = 첫 점) */
export function resample(pts: readonly (readonly [number, number])[], count: number): [number, number][] {
  const total = polylineLength(pts);
  const out: [number, number][] = [[pts[0][0], pts[0][1]]];
  const step = total / count;
  let acc = 0, i = 1, target = step;
  let [px, py] = pts[0];
  while (i < pts.length && out.length < count) {
    const [qx, qy] = pts[i];
    const seg = Math.hypot(qx - px, qy - py);
    if (acc + seg >= target) {
      const t = (target - acc) / seg;
      px = px + (qx - px) * t;
      py = py + (qy - py) * t;
      acc = target;
      out.push([px, py]);
      target += step;
    } else {
      acc += seg;
      px = qx;
      py = qy;
      i++;
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}

/** 경로 탐색 기준점: 꼭짓점은 보존하고 각 변을 최대 maxStep(단위 길이) 이하로 나눈다. */
export function anchorsOf(shape: ShapeDef, count: number): [number, number][] {
  if (!shape.corners) return resample(shape.points, count);
  const maxStep = shape.perimeter / count;
  const out: [number, number][] = [];
  for (let i = 0; i < shape.points.length - 1; i++) {
    const [ax, ay] = shape.points[i], [bx, by] = shape.points[i + 1];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / maxStep));
    for (let j = 0; j < k; j++) out.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]);
  }
  out.push([...shape.points[shape.points.length - 1]] as [number, number]);
  return out;
}

/**
 * 사용자가 손으로 그린 선(화면 좌표, y가 아래로 증가) → 한붓 그림 모양.
 * 손떨림을 줄이려고 꼭짓점을 단순화하고(최대 maxVertices개), 시작·끝을 이어 닫는다. 그림이 너무 작거나 납작하면 null.
 */
export function customShapeFromStroke(stroke: readonly (readonly [number, number])[], maxVertices = 24): ShapeDef | null {
  if (stroke.length < 8) return null;
  const pts = stroke.map(([x, y]) => [x, -y] as [number, number]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(size > 0)) return null;
  const closed = [...pts, pts[0]];
  let tol = size * 0.02;
  let keep = rdpIndices(closed, tol);
  while (keep.length - 1 > maxVertices) {
    tol *= 1.3;
    keep = rdpIndices(closed, tol);
  }
  const raw = keep.slice(0, -1).map((i) => closed[i]);
  if (raw.length < 3) return null;
  const points = normalize(raw);
  // 납작해서 면적이 거의 없는 그림(선 하나 등)은 달릴 고리가 되지 않는다
  let area = 0;
  for (let i = 1; i < points.length; i++) area += points[i - 1][0] * points[i][1] - points[i][0] * points[i - 1][1];
  if (Math.abs(area / 2) < 0.03) return null;
  return { id: "custom", name: "내 그림", emoji: "✏️", corners: true, points, perimeter: polylineLength(points), features: sharpVertices(points) };
}

// ───────────────────────── 여러 획 그림 ─────────────────────────

/** 여러 획 그림의 한 획: 그림 전체 좌표 = (ox, oy) + s × 획 좌표 */
export interface ShapePart {
  shape: ShapeDef;
  ox: number;
  oy: number;
  s: number;
}

/** 떨어진 여러 닫힌 획으로 된 그림 (예: 글자 "520"). 획 순서대로 달리고, 획 사이는 이동 구간으로 잇는다. */
export interface ShapeGroup {
  id: ShapeKey;
  name: string;
  parts: ShapePart[];
}

/** 한 획짜리 그림 */
export const singleGroup = (shape: ShapeDef): ShapeGroup => ({ id: shape.id, name: shape.name, parts: [{ shape, ox: 0, oy: 0, s: 1 }] });

/**
 * 닫힌 선 여러 개(화면 좌표, y가 아래로 증가) → 여러 획 그림.
 * 그림 전체 크기의 minPartRatio보다 작은 획(점·잡티)은 버리고, 획마다 꼭짓점을 단순화한다.
 * order: "given"은 받은 순서(손그림 순서), "leftToRight"는 왼쪽부터(글자·이미지).
 */
export function groupFromLoops(
  loops: readonly (readonly (readonly [number, number])[])[],
  opts: { name?: string; order?: "given" | "leftToRight"; minPartRatio?: number; maxParts?: number; maxVertices?: number } = {},
): ShapeGroup | null {
  const flipped = loops.filter((l) => l.length >= 3).map((l) => l.map(([x, y]) => [x, -y] as [number, number]));
  if (!flipped.length) return null;
  const all = flipped.flat();
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const gx = (Math.min(...xs) + Math.max(...xs)) / 2, gy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(size > 0)) return null;
  const parts: ShapePart[] = [];
  for (const l of flipped) {
    const lx = l.map((p) => p[0]), ly = l.map((p) => p[1]);
    const ext = Math.max(Math.max(...lx) - Math.min(...lx), Math.max(...ly) - Math.min(...ly));
    if (ext < (opts.minPartRatio ?? 0.12) * size) continue;
    const closed = [...l, l[0]];
    let tol = ext * 0.02;
    let keep = rdpIndices(closed, tol);
    while (keep.length - 1 > (opts.maxVertices ?? 24)) {
      tol *= 1.3;
      keep = rdpIndices(closed, tol);
    }
    const raw = keep.slice(0, -1).map((i) => closed[i]);
    if (raw.length < 3) continue;
    const points = normalize(raw);
    let a = 0;
    for (let i = 1; i < points.length; i++) a += points[i - 1][0] * points[i][1] - points[i][0] * points[i - 1][1];
    if (Math.abs(a / 2) < 0.03) continue; // 선 하나처럼 안쪽이 없는 획
    const cx = (Math.min(...lx) + Math.max(...lx)) / 2, cy = (Math.min(...ly) + Math.max(...ly)) / 2;
    parts.push({
      shape: { id: "custom", name: opts.name ?? "내 그림", emoji: "✏️", corners: true, points, perimeter: polylineLength(points), features: sharpVertices(points) },
      ox: (cx - gx) / size,
      oy: (cy - gy) / size,
      s: ext / size,
    });
  }
  if (!parts.length) return null;
  if (opts.order === "leftToRight") parts.sort((p, q) => p.ox - q.ox);
  return { id: "custom", name: opts.name ?? "내 그림", parts: parts.slice(0, opts.maxParts ?? 6) };
}

/** 여러 획 그림의 획들을 그림 전체 좌표(y 위로)의 선 목록으로 (미리보기·썸네일용) */
export function groupLines(group: ShapeGroup): [number, number][][] {
  return group.parts.map((p) => p.shape.points.map(([x, y]) => [p.ox + p.s * x, p.oy + p.s * y] as [number, number]));
}
