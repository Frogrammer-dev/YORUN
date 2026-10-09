// SceneRenderer (7.4, 8.3): 앱 화면·공유 화면·PNG가 같은 장면 배치 계산을 사용한다.
// 입력은 검증된 숫자·enum·#RRGGBB 색뿐이며, 사용자 HTML·SVG·CSS·외부 URL은 받지 않는다.

import { ROOM, type Frame, type Theme } from "@/lib/contracts/limits";
import type { ItemStyle, Pt } from "@/lib/contracts/types";

export interface SceneItem {
  key: string;
  x: number;
  y: number;
  size: number;
  rotationDeg: number;
  zIndex: number;
  style: ItemStyle;
  lines: Pt[][];
  title?: string;
  distanceEstimateMeters?: number;
  recordedDate?: string | null;
}

export interface Scene {
  theme: Theme;
  items: SceneItem[];
}

export const THEME_COLORS: Record<Theme, { wall: string; floor: string; floorLine: string; text: string }> = {
  light: { wall: "#F4EFE7", floor: "#E6DCCB", floorLine: "#D8CCB7", text: "#2D2A26" },
  dark: { wall: "#1E2433", floor: "#151A26", floorLine: "#2A3245", text: "#E8ECF4" },
};

export const FRAME_STYLES: Record<Frame, { fill: string; stroke: string; strokeWidth: number; glow?: string }> = {
  plain: { fill: "#FFFFFF", stroke: "#CFC8BC", strokeWidth: 2 },
  paper: { fill: "#F7F0E1", stroke: "#CDB89A", strokeWidth: 4 },
  neon: { fill: "#14142B", stroke: "#FF4FD8", strokeWidth: 2.5, glow: "#FF4FD8" },
};

export const FRAME_LABELS: Record<Frame, string> = { plain: "기본", paper: "종이", neon: "네온" };

const HEX = /^#[0-9A-Fa-f]{6}$/;
export const safeColor = (c: string) => (HEX.test(c) ? c : "#2B6CB0");

export interface LaidOutLine {
  kind: "polyline" | "dot";
  /** 로컬 좌표(슬롯 중심 기준) "x,y x,y ..." */
  points: string;
  cx?: number;
  cy?: number;
}

export interface LaidOutItem {
  key: string;
  transform: string;
  side: number;
  half: number;
  frame: (typeof FRAME_STYLES)[Frame];
  strokeColor: string;
  strokeWidthPx: number;
  dotRadius: number;
  lines: LaidOutLine[];
  item: SceneItem;
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString();

// NFR-04: 드래그(x·y·회전 변경) 중에는 선 좌표 문자열을 다시 만들지 않도록 (선 배열, 크기)로 캐시한다.
const lineCache = new WeakMap<Pt[][], Map<number, LaidOutLine[]>>();

function layoutLines(lines: Pt[][], side: number): LaidOutLine[] {
  let bySize = lineCache.get(lines);
  if (!bySize) lineCache.set(lines, (bySize = new Map()));
  const hit = bySize.get(side);
  if (hit) return hit;
  const half = side / 2;
  const inset = side * ROOM.frameInset;
  const artSide = side - inset * 2;
  const toLocal = ([u, v]: Pt): [number, number] => [-half + inset + u * artSide, -half + inset + v * artSide];
  const out: LaidOutLine[] = lines.map((line) => {
    // 7.4: 한 구간마다 별도 선. 단일점(또는 모든 점이 같은 구간)은 작은 원으로 표현.
    const distinct = line.some((p) => p[0] !== line[0][0] || p[1] !== line[0][1]);
    if (!distinct) {
      const [cx, cy] = toLocal(line[0]);
      return { kind: "dot", points: "", cx, cy };
    }
    return { kind: "polyline", points: line.map((p) => toLocal(p).map(f2).join(",")).join(" ") };
  });
  if (bySize.size > 8) bySize.clear();
  bySize.set(side, out);
  return out;
}

export function layoutItem(item: SceneItem): LaidOutItem {
  const side = item.size * ROOM.width;
  const half = side / 2;
  const artSide = side * (1 - 2 * ROOM.frameInset);
  const strokeWidthPx = Math.max(0.5, item.style.strokeWidth * artSide);
  const lines = layoutLines(item.lines, side);
  return {
    key: item.key,
    transform: `translate(${f2(item.x * ROOM.width)} ${f2(item.y * ROOM.height)}) rotate(${f2(item.rotationDeg)})`,
    side,
    half,
    frame: FRAME_STYLES[item.style.frame] ?? FRAME_STYLES.plain,
    strokeColor: safeColor(item.style.strokeColor),
    strokeWidthPx,
    dotRadius: Math.max(1.5, strokeWidthPx * 0.9),
    lines,
    item,
  };
}

export function layoutScene(scene: Scene): LaidOutItem[] {
  return [...scene.items].sort((a, b) => a.zIndex - b.zIndex).map(layoutItem);
}

/** PNG용 SVG 문자열. 텍스트는 넣지 않고(한글 글꼴은 캔버스에서 그림), 숫자·검증된 색만 출력한다. */
export function sceneToSvgString(scene: Scene): string {
  const t = THEME_COLORS[scene.theme] ?? THEME_COLORS.light;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ROOM.width}" height="${ROOM.height}" viewBox="0 0 ${ROOM.width} ${ROOM.height}">`,
    `<rect x="0" y="0" width="${ROOM.width}" height="${ROOM.height}" fill="${t.wall}"/>`,
    `<rect x="0" y="${FLOOR_Y}" width="${ROOM.width}" height="${ROOM.height - FLOOR_Y}" fill="${t.floor}"/>`,
    `<line x1="0" y1="${FLOOR_Y}" x2="${ROOM.width}" y2="${FLOOR_Y}" stroke="${t.floorLine}" stroke-width="3"/>`,
  ];
  for (const it of layoutScene(scene)) {
    const fr = it.frame;
    parts.push(`<g transform="${it.transform}">`);
    if (fr.glow) {
      parts.push(
        `<rect x="${f2(-it.half)}" y="${f2(-it.half)}" width="${f2(it.side)}" height="${f2(it.side)}" fill="none" stroke="${fr.glow}" stroke-opacity="0.3" stroke-width="9"/>`,
      );
    }
    parts.push(
      `<rect x="${f2(-it.half)}" y="${f2(-it.half)}" width="${f2(it.side)}" height="${f2(it.side)}" fill="${fr.fill}" stroke="${fr.stroke}" stroke-width="${fr.strokeWidth}"/>`,
    );
    for (const l of it.lines) {
      if (l.kind === "dot") {
        parts.push(`<circle cx="${f2(l.cx!)}" cy="${f2(l.cy!)}" r="${f2(it.dotRadius)}" fill="${it.strokeColor}"/>`);
      } else {
        parts.push(
          `<polyline points="${l.points}" fill="none" stroke="${it.strokeColor}" stroke-width="${f2(it.strokeWidthPx)}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      }
    }
    parts.push(`</g>`);
  }
  parts.push(`</svg>`);
  return parts.join("");
}

export const FLOOR_Y = 675;
