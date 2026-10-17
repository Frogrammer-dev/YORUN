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
  /** 예시 작품 전용: 경로 주변의 실제 도로망(같은 u·v 좌표). 경로 아래에 흐릿하게 깐다. */
  mapLines?: Pt[][];
  title?: string;
  distanceEstimateMeters?: number;
  recordedDate?: string | null;
}

export interface Scene {
  theme: Theme;
  items: SceneItem[];
}

// 거대한 캔버스: 방 전체가 젯소 바른 리넨 캔버스 한 장. 위에서 은은한 조명 하나가 내리쬔다.
export const THEME_COLORS: Record<
  Theme,
  {
    base: string; light: string; lightOp: number; thread: string; threadOp: number; grain: string; grainOp: number;
    gessoOp: number; vignetteOp: number; shadow: [number, number]; text: string;
  }
> = {
  light: {
    base: "#EEE8DD", light: "#FFFAF0", lightOp: 0.85, thread: "#6B5B44", threadOp: 0.24, grain: "#5A4A34", grainOp: 0.28,
    gessoOp: 0.6, vignetteOp: 0.2, shadow: [0.12, 0.08], text: "#2D2A26",
  },
  dark: {
    base: "#171A20", light: "#FFE2B0", lightOp: 0.3, thread: "#FFFFFF", threadOp: 0.1, grain: "#FFFFFF", grainOp: 0.14,
    gessoOp: 0.15, vignetteOp: 0.6, shadow: [0.45, 0.25], text: "#E8ECF4",
  },
};

/** label = 액자 안 제목 글자색 */
export const FRAME_STYLES: Record<Frame, { label: string }> = {
  plain: { label: "#6B645B" },
  paper: { label: "#7D776E" },
  neon: { label: "#E3D3B2" },
};

export const FRAME_LABELS: Record<Frame, string> = { plain: "갤러리", paper: "판화", neon: "나이트" };

/** 캔버스 배경 SVG 조각. 상수와 테마 색만 쓴다 (화면·PNG 공용). */
export function backdropMarkup(theme: Theme): string {
  const t = THEME_COLORS[theme] ?? THEME_COLORS.light;
  const id = (n: string) => `yr-${theme}-${n}`;
  const W = ROOM.width, H = ROOM.height;
  // 노이즈의 R 채널을 투명도로 써서 한 가지 색의 결만 남긴다
  const tint = (c: string, k: number, o: number) => {
    const [r, g, b] = [1, 3, 5].map((i) => (parseInt(c.slice(i, i + 2), 16) / 255).toFixed(3));
    return `<feColorMatrix type="matrix" values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} ${k} 0 0 0 ${o}"/>`;
  };
  const noise = (name: string, freq: string, oct: number, c: string, k: number, o: number) =>
    `<filter id="${id(name)}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="${oct}" seed="7" stitchTiles="stitch"/>${tint(c, k, o)}</filter>`;
  const layer = (name: string, op: number) => `<rect width="${W}" height="${H}" filter="url(#${id(name)})" opacity="${op}"/>`;
  return [
    `<defs>`,
    // 가로·세로 실: 한 방향으로 길게 늘어난 노이즈 두 겹이 리넨 짜임을 만든다
    noise("weft", "0.02 0.8", 2, t.thread, 2.2, -0.9),
    noise("warp", "0.8 0.02", 2, t.thread, 2.2, -0.9),
    noise("grain", "0.9", 3, t.grain, 1.6, -0.6),
    // 젯소를 손으로 바른 듯한 넓은 얼룩
    noise("gesso", "0.004 0.006", 2, t.grain, 0.9, -0.35),
    `<radialGradient id="${id("light")}" gradientUnits="userSpaceOnUse" cx="500" cy="-40" r="640"><stop offset="0" stop-color="${t.light}" stop-opacity="${t.lightOp}"/><stop offset="0.45" stop-color="${t.light}" stop-opacity="${t.lightOp * 0.45}"/><stop offset="1" stop-color="${t.light}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="${id("vig")}" gradientUnits="userSpaceOnUse" cx="500" cy="280" r="720"><stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="${t.vignetteOp}"/></radialGradient>`,
    `</defs>`,
    `<rect width="${W}" height="${H}" fill="${t.base}"/>`,
    layer("gesso", t.gessoOp),
    layer("weft", t.threadOp),
    layer("warp", t.threadOp),
    layer("grain", t.grainOp),
    `<rect width="${W}" height="${H}" fill="url(#${id("light")})"/>`,
    `<rect width="${W}" height="${H}" fill="url(#${id("vig")})"/>`,
  ].join("");
}

/** 액자(그림자 포함) SVG 조각. 슬롯 중심 기준 로컬 좌표, 숫자·상수 색만 쓴다 (화면·PNG 공용).
 * 그림은 안쪽 80%에 그려지므로 장식은 바깥 10% 띠에만 둔다. 가는 선은 크기와 무관하게 px로 고정한다. */
export function frameMarkup(side: number, frame: Frame, theme: Theme): string {
  const h = side / 2;
  const dark = theme === "dark";
  const sq = (inset: number, attrs: string, dy = 0, rx = 0) =>
    `<rect x="${f2(-h + inset)}" y="${f2(-h + inset + dy)}" width="${f2(side - inset * 2)}" height="${f2(side - inset * 2)}"${rx ? ` rx="${f2(rx)}"` : ""} ${attrs}/>`;
  // 위에서 오는 빛: 아래로 번지는 부드러운 그림자 (dy, 퍼짐, 밝은/어두운 테마 투명도)
  const shadow = (layers: [number, number, number, number][]) =>
    layers.map(([dy, g, lo, dk]) => sq(-g * side, `fill="#000" fill-opacity="${dark ? dk : lo}"`, dy * side, g * side)).join("");
  const strip = (inset: number, height: number, op: number) =>
    `<rect x="${f2(-h + inset)}" y="${f2(-h + inset)}" width="${f2(side - inset * 2)}" height="${f2(height)}" fill="#000" fill-opacity="${op}"/>`;
  const rim = sq(0.5, `fill="none" stroke="#FFFFFF" stroke-width="1" stroke-opacity="${dark ? 0.14 : 0.07}"`);
  const hang: [number, number, number, number][] = [[0.004, 0, 0.1, 0.32], [0.012, 0.004, 0.06, 0.2], [0.026, 0.01, 0.04, 0.13], [0.045, 0.02, 0.025, 0.08]];

  if (frame === "paper") {
    // 판화: 액자 없이 띄운 종이 + 눌린 판 자국
    const p = 0.088 * side;
    return (
      shadow([[0.006, 0, 0.08, 0.28], [0.02, 0.008, 0.06, 0.18], [0.045, 0.02, 0.04, 0.11], [0.075, 0.035, 0.025, 0.07]]) +
      sq(0, `fill="${dark ? "#EDEAE3" : "#FBFAF6"}"`, 0, 1) +
      sq(0.375, `fill="none" stroke="#000" stroke-width="0.75" stroke-opacity="${dark ? 0.2 : 0.08}"`) +
      sq(p, `fill="none" stroke="#000" stroke-width="0.75" stroke-opacity="0.09"`) +
      sq(p, `fill="none" stroke="#FFFFFF" stroke-width="0.75" stroke-opacity="0.9"`, 0.75)
    );
  }
  if (frame === "neon") {
    // 나이트: 남색 마운트 + 가로등 호박색 실선
    const w = 0.086 * side;
    return (
      shadow(hang) +
      sq(0, `fill="${dark ? "#283041" : "#1E2433"}"`) +
      rim +
      sq(w, `fill="${dark ? "#E9E6DF" : "#F3F1EC"}"`) +
      strip(w, 0.012 * side, 0.12) +
      strip(w, 0.005 * side, 0.1) +
      sq(w, `fill="none" stroke="#D4AC68" stroke-width="${f2(Math.max(1, 0.004 * side))}" stroke-opacity="0.9"`)
    );
  }
  // 갤러리: 가는 웜블랙 몰딩 + 깊은 매트 + 베벨
  const m = 0.03 * side, win = 0.09 * side;
  return (
    shadow(hang) +
    sq(0, `fill="#26231F"`) +
    rim +
    sq(m, `fill="${dark ? "#ECE9E3" : "#F8F6F1"}"`) +
    sq(m, `fill="none" stroke="#000" stroke-width="1" stroke-opacity="0.3"`) +
    strip(m, 0.014 * side, 0.06) +
    strip(m, 0.006 * side, 0.06) +
    sq(win, `fill="${dark ? "#F4F2EE" : "#FFFFFF"}"`) +
    sq(win, `fill="none" stroke="#E2DBCF" stroke-width="1"`)
  );
}

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
  frameKind: Frame;
  strokeColor: string;
  strokeWidthPx: number;
  dotRadius: number;
  lines: LaidOutLine[];
  /** 흐린 도로망 SVG 조각 (없으면 "") */
  mapMarkup: string;
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

const mapCache = new WeakMap<Pt[][], Map<number, string>>();

/** 도로망은 선이 많아 path 하나로 묶는다. 그림 창(안쪽 80%) 밖은 생성 단계에서 이미 잘라 둔다. */
function layoutMap(lines: Pt[][], side: number): string {
  let bySize = mapCache.get(lines);
  if (!bySize) mapCache.set(lines, (bySize = new Map()));
  const hit = bySize.get(side);
  if (hit !== undefined) return hit;
  const half = side / 2, inset = side * ROOM.frameInset, artSide = side - inset * 2;
  const d = lines.map((l) => l.map(([u, v], i) => `${i ? "L" : "M"}${f2(-half + inset + u * artSide)} ${f2(-half + inset + v * artSide)}`).join("")).join("");
  const out = `<path d="${d}" fill="none" stroke="#8A8378" stroke-opacity="0.2" stroke-width="${f2(Math.max(0.6, side * 0.004))}" stroke-linecap="round" stroke-linejoin="round"/>`;
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
    frameKind: item.style.frame in FRAME_STYLES ? item.style.frame : "plain",
    strokeColor: safeColor(item.style.strokeColor),
    strokeWidthPx,
    dotRadius: Math.max(1.5, strokeWidthPx * 0.9),
    lines,
    mapMarkup: item.mapLines?.length ? layoutMap(item.mapLines, side) : "",
    item,
  };
}

export function layoutScene(scene: Scene): LaidOutItem[] {
  return [...scene.items].sort((a, b) => a.zIndex - b.zIndex).map(layoutItem);
}

/** PNG용 SVG 문자열. 텍스트는 넣지 않고(한글 글꼴은 캔버스에서 그림), 숫자·검증된 색만 출력한다. */
export function sceneToSvgString(scene: Scene): string {
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ROOM.width}" height="${ROOM.height}" viewBox="0 0 ${ROOM.width} ${ROOM.height}">`,
    backdropMarkup(scene.theme),
  ];
  for (const it of layoutScene(scene)) {
    parts.push(`<g transform="${it.transform}">`, frameMarkup(it.side, it.frameKind, scene.theme), it.mapMarkup);
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
