"use client";
// 찾은 코스 목록 (표시 전용)

import type { RouteCandidate } from "@/lib/route/fit";
import { courseBadge, courseTitle } from "@/lib/route/present";
import { PathThumb, latlngToXY } from "@/components/Icon";
import type { ElevationState } from "@/components/route/SelectedCourse";

export function CourseList({
  candidates,
  elev = {},
  selected,
  discover,
  onChoose,
  onHover,
}: {
  candidates: RouteCandidate[];
  elev?: Record<string, ElevationState>;
  selected: string | null;
  discover: boolean;
  onChoose: (c: RouteCandidate) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <ul className="cands">
      {candidates.map((c) => (
        <li key={c.id}>
          <button type="button" className={`cand ${c.id === selected ? "cand-on" : ""}`} aria-pressed={c.id === selected} onClick={() => onChoose(c)} onMouseEnter={() => onHover(c.id)} onMouseLeave={() => onHover(null)}>
            <span className="cand-thumb">
              <PathThumb lines={[latlngToXY(c.latlngs)]} size={56} pad={5} width={3} stroke="#0EA5E9" />
            </span>
            <span className="cand-body">
              <span className="cand-top">
                <span className="cand-title">{courseTitle(c, discover)}</span>
                <span className={`cand-sim ${c.doodle || c.semanticExplanation ? "cand-ai" : ""}`}>{courseBadge(c)}</span>
              </span>
              <span className="cand-meta">
                <span className="num">{(c.lengthMeters / 1000).toFixed(2)}</span>
                <span className="unit">km</span>
                <span>· 약 {Math.round((c.lengthMeters / 1000) * 6.5)}분</span>
                {c.repeatRatio > 0.02 ? <span>· 같은 길 반복 {Math.round(c.repeatRatio * 100)}%</span> : null}
                {c.moves?.length ? <span>· 이동 {(c.moveMeters / 1000).toFixed(1)}km</span> : null}
                {typeof elev[c.id] === "object" ? <span>· 오르막 {(elev[c.id] as { ascent: number }).ascent}m</span> : null}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
