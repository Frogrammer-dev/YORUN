// React용 SceneRenderer 출력. 배치 계산은 lib/render/scene.ts를 PNG와 공유한다.
import { memo, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref } from "react";
import { ROOM } from "@/lib/contracts/limits";
import { formatDistance } from "@/lib/gpx/metrics";
import { FLOOR_Y, THEME_COLORS, layoutScene, type LaidOutItem, type LaidOutLine, type Scene } from "@/lib/render/scene";

interface Props {
  scene: Scene;
  selectedKey?: string | null;
  onItemPointerDown?: (key: string, e: ReactPointerEvent<SVGGElement>) => void;
  onItemKeyDown?: (key: string, e: ReactKeyboardEvent<SVGGElement>) => void;
  onItemFocus?: (key: string) => void;
  onBackgroundPointerDown?: () => void;
  svgRef?: Ref<SVGSVGElement>;
  showLabels?: boolean;
  ariaLabel: string;
}

export function SceneSvg({
  scene,
  selectedKey,
  onItemPointerDown,
  onItemKeyDown,
  onItemFocus,
  onBackgroundPointerDown,
  svgRef,
  showLabels,
  ariaLabel,
}: Props) {
  const t = THEME_COLORS[scene.theme] ?? THEME_COLORS.light;
  const interactive = !!onItemPointerDown;
  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${ROOM.width} ${ROOM.height}`}
      role={interactive ? "group" : "img"}
      aria-label={ariaLabel}
      className="scene"
      style={{ touchAction: interactive ? "none" : undefined }}
    >
      <rect x={0} y={0} width={ROOM.width} height={ROOM.height} fill={t.wall} onPointerDown={onBackgroundPointerDown} />
      <rect x={0} y={FLOOR_Y} width={ROOM.width} height={ROOM.height - FLOOR_Y} fill={t.floor} onPointerDown={onBackgroundPointerDown} />
      <line x1={0} y1={FLOOR_Y} x2={ROOM.width} y2={FLOOR_Y} stroke={t.floorLine} strokeWidth={3} pointerEvents="none" />
      {layoutScene(scene).map((it) => (
        <ItemG
          key={it.key}
          itemKey={it.key}
          transform={it.transform}
          side={it.side}
          half={it.half}
          frame={it.frame}
          strokeColor={it.strokeColor}
          strokeWidthPx={it.strokeWidthPx}
          dotRadius={it.dotRadius}
          lines={it.lines}
          label={showLabels ? labelOf(it) : ""}
          ariaName={it.item.title ?? "작품"}
          selected={it.key === selectedKey}
          onPointerDown={onItemPointerDown}
          onKeyDown={onItemKeyDown}
          onFocus={onItemFocus}
        />
      ))}
    </svg>
  );
}

function labelOf(it: LaidOutItem) {
  return [it.item.title, it.item.distanceEstimateMeters != null ? formatDistance(it.item.distanceEstimateMeters) : null]
    .filter(Boolean)
    .join(" · ");
}

interface ItemProps {
  itemKey: string;
  transform: string;
  side: number;
  half: number;
  frame: LaidOutItem["frame"];
  strokeColor: string;
  strokeWidthPx: number;
  dotRadius: number;
  lines: LaidOutLine[];
  label: string;
  ariaName: string;
  selected: boolean;
  onPointerDown?: Props["onItemPointerDown"];
  onKeyDown?: Props["onItemKeyDown"];
  onFocus?: Props["onItemFocus"];
}

const ItemG = memo(function ItemG(p: ItemProps) {
  const interactive = !!p.onPointerDown;
  const fr = p.frame;
  return (
    <g
      transform={p.transform}
      onPointerDown={interactive ? (e) => p.onPointerDown!(p.itemKey, e) : undefined}
      onKeyDown={p.onKeyDown ? (e) => p.onKeyDown!(p.itemKey, e) : undefined}
      onFocus={p.onFocus ? () => p.onFocus!(p.itemKey) : undefined}
      tabIndex={interactive ? 0 : undefined}
      role={interactive ? "button" : undefined}
      aria-label={interactive ? `${p.ariaName}${p.selected ? " (선택됨)" : ""}` : undefined}
      aria-pressed={interactive ? p.selected : undefined}
      className={interactive ? "scene-item" : undefined}
    >
      {fr.glow && <rect x={-p.half} y={-p.half} width={p.side} height={p.side} fill="none" stroke={fr.glow} strokeOpacity={0.3} strokeWidth={9} />}
      <rect x={-p.half} y={-p.half} width={p.side} height={p.side} fill={fr.fill} stroke={fr.stroke} strokeWidth={fr.strokeWidth} />
      {p.lines.map((l, i) =>
        l.kind === "dot" ? (
          <circle key={i} cx={l.cx} cy={l.cy} r={p.dotRadius} fill={p.strokeColor} />
        ) : (
          <polyline
            key={i}
            points={l.points}
            fill="none"
            stroke={p.strokeColor}
            strokeWidth={p.strokeWidthPx}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
      {p.label && (
        <text x={0} y={p.half - p.side * 0.035} textAnchor="middle" fontSize={Math.max(10, p.side * 0.055)} fill={fr.glow ? "#F5D0F0" : "#4A4540"}>
          {p.label}
        </text>
      )}
      {p.selected && (
        // 선택 표시는 색만이 아니라 점선 테두리 + 모서리 손잡이로 구분한다 (NFR-06).
        <g pointerEvents="none">
          <rect x={-p.half - 8} y={-p.half - 8} width={p.side + 16} height={p.side + 16} fill="none" stroke="#1A73E8" strokeWidth={3} strokeDasharray="10 6" />
          {[
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ].map(([sx, sy]) => (
            <rect key={`${sx}${sy}`} x={sx * (p.half + 8) - 6} y={sy * (p.half + 8) - 6} width={12} height={12} fill="#FFFFFF" stroke="#1A73E8" strokeWidth={2} />
          ))}
        </g>
      )}
    </g>
  );
});
