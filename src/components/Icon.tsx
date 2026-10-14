// 인라인 SVG 아이콘 (24 격자, stroke 2, currentColor). 이모지 대신 쓴다.
import type { SVGProps } from "react";

const PATHS = {
  play: <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor" stroke="none" />,
  locate: (
    <>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3 2.5 8 12 13l9.5-5z" />
      <path d="m2.5 12.5 9.5 5 9.5-5" />
      <path d="m2.5 16.5 9.5 5 9.5-5" opacity=".5" />
    </>
  ),
  map: (
    <>
      <path d="m3 6 6-2.5 6 2.5 6-2.5v14.5L15 20l-6-2.5L3 20z" />
      <path d="M9 3.5v14M15 6v14" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  sparkle: <path d="M12 3c.6 4.2 2.8 6.4 7 7-4.2.6-6.4 2.8-7 7-.6-4.2-2.8-6.4-7-7 4.2-.6 6.4-2.8 7-7zM19 15c.3 1.7 1.1 2.6 2.5 3-1.4.3-2.2 1.2-2.5 3-.3-1.8-1.1-2.7-2.5-3 1.4-.4 2.2-1.3 2.5-3z" />,
  frame: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="m6.5 16 4-4.5 3 3 2-2 2.5 3.5" />
      <circle cx="15.5" cy="8.5" r="1.4" />
    </>
  ),
  download: <path d="M12 4v11m-5-5 5 5 5-5M4.5 19.5h15" />,
  turnRight: <path d="M7 20v-7a4 4 0 0 1 4-4h8m-4-4 4 4-4 4" />,
  turnLeft: <path d="M17 20v-7a4 4 0 0 0-4-4H5m4-4L5 9l4 4" />,
  uturn: <path d="M8 20V9a4.5 4.5 0 0 1 9 0v6m-4-3.5 4 4 4-4" />,
  straight: <path d="M12 20V5m-5 5 5-5 5 5" />,
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h11l-2 4 2 4H5" fill="currentColor" fillOpacity=".25" />
    </>
  ),
  warn: (
    <>
      <path d="M12 3.5 2.5 20h19z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17.2" r=".6" fill="currentColor" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r=".6" fill="currentColor" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z" />,
  run: (
    <>
      <circle cx="14.5" cy="4.5" r="2" />
      <path d="m7 21 3.5-6 3 2.5V22M6 11l3.5-3.5h4l2.5 4 3 1M10.5 7.5 9 14" />
    </>
  ),
  upload: <path d="M12 16V5m-5 5 5-5 5 5M4.5 19.5h15" />,
  pencil: <path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5zM13.5 7l3.5 3.5" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}

/** 브랜드 마크: 둥근 사각 위 붓선 하트 */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M16 24.5 8.6 17.3c-2.3-2.3-1.6-6.6 2-7.1 2.4-.3 4.1 1.3 5.4 3.1 1.3-1.8 3-3.4 5.4-3.1 3.6.5 4.3 4.8 2 7.1z" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx="16" cy="24.5" r="1.9" fill="#fff" />
    </svg>
  );
}

/** 정규화 외곽선/경로를 작은 썸네일 SVG로 */
export function PathThumb({ lines, size = 40, stroke = "currentColor", width = 2.5, pad = 4 }: { lines: [number, number][][]; size?: number; stroke?: string; width?: number; pad?: number }) {
  const all = lines.flat();
  if (!all.length) return <svg width={size} height={size} aria-hidden="true" />;
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const inner = size - pad * 2;
  const ox = pad + (inner - ((maxX - minX) / s) * inner) / 2, oy = pad + (inner - ((maxY - minY) / s) * inner) / 2;
  // y는 위가 양수(북쪽)라 뒤집는다
  const d = lines
    .map((l) => l.map(([x, y], i) => `${i ? "L" : "M"}${(ox + ((x - minX) / s) * inner).toFixed(1)} ${(oy + ((maxY - y) / s) * inner).toFixed(1)}`).join(""))
    .join("");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** [lat, lon] 목록 → 썸네일용 [x, y] (경도 보정) */
export function latlngToXY(latlngs: [number, number][]): [number, number][] {
  if (!latlngs.length) return [];
  const k = Math.cos((latlngs[0][0] * Math.PI) / 180);
  return latlngs.map(([lat, lon]) => [lon * k, lat]);
}
