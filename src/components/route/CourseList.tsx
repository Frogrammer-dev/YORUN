"use client";
// 찾은 코스 목록 (표시 전용)

import { useEffect, useRef } from "react";
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
  // 이름이 같은 코스가 여럿이어도 구분되게 썸네일에 순서 번호를 붙인다.
  // 제목에 붙이지 않는 이유: 다른 코스의 이름이 나중에 바뀌어도 고른 코스의 제목이 흔들리지 않게.
  const listRef = useRef<HTMLUListElement>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ candidates, selected, onChoose });
  useEffect(() => {
    latest.current = { candidates, selected, onChoose };
  });
  const horizontal = () => {
    const ul = listRef.current;
    return !!ul && getComputedStyle(ul).flexDirection === "row" && ul.scrollWidth > ul.clientWidth + 1;
  };

  // 모바일 가로 목록: 넘겨서 앞에 온 카드를 고른다. 안 그러면 화면에는 2번이 보이는데 지도와 '달리기'는 1번이었다.
  function onScroll() {
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      const ul = listRef.current;
      if (!ul || !horizontal()) return;
      const left = ul.getBoundingClientRect().left;
      const pad = parseFloat(getComputedStyle(ul).paddingLeft) || 0;
      const items = [...ul.children] as HTMLElement[];
      let best = 0, bestGap = Infinity;
      items.forEach((li, i) => {
        const gap = Math.abs(li.getBoundingClientRect().left - left - pad);
        if (gap < bestGap) [best, bestGap] = [i, gap];
      });
      const { candidates: list, selected: sel, onChoose: choose } = latest.current;
      const c = list[best];
      if (c && c.id !== sel) choose(c);
    }, 160);
  }

  // 옆 카드를 눌러 고르면 그 카드를 앞으로 가져온다
  useEffect(() => {
    if (!selected || !horizontal()) return;
    const i = candidates.findIndex((c) => c.id === selected);
    const li = listRef.current?.children[i] as HTMLElement | undefined;
    const ul = listRef.current;
    if (!li || !ul) return;
    const pad = parseFloat(getComputedStyle(ul).paddingLeft) || 0;
    const target = li.offsetLeft - ul.offsetLeft - pad;
    if (Math.abs(ul.scrollLeft - target) > 4) ul.scrollTo({ left: target, behavior: "smooth" });
  }, [selected, candidates]);

  return (
    <ul className="cands" ref={listRef} onScroll={onScroll}>
      {candidates.map((c, i) => (
        <li key={c.id}>
          <button type="button" className={`cand ${c.id === selected ? "cand-on" : ""}`} aria-pressed={c.id === selected} onClick={() => onChoose(c)} onMouseEnter={() => onHover(c.id)} onMouseLeave={() => onHover(null)}>
            <span className="cand-thumb">
              <PathThumb lines={[latlngToXY(c.latlngs)]} size={84} pad={6} width={3} stroke="#0EA5E9" />
              <span className="cand-no" aria-label={`${i + 1}번 코스`}>{i + 1}</span>
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
