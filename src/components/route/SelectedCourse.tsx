"use client";
// 고른 코스 설명·길 정보·고도·달리기 버튼 (표시 전용)

import type { ElevationProfile } from "@/lib/route/elevation";
import type { RouteCandidate } from "@/lib/route/fit";
import { Icon } from "@/components/Icon";
import { courseGrade } from "@/lib/route/present";
import { ShapeExplanation } from "./ShapeExplanation";

export type ElevationState = ElevationProfile | "loading" | "error" | undefined;

export function SelectedCourse({ c, elev, onRun, onExport }: { c: RouteCandidate; elev: ElevationState; onRun: () => void; onExport: () => void }) {
  return (
    <>
      <p className="sel-desc">
        <strong>
          {c.shapeName} 코스 · {(c.lengthMeters / 1000).toFixed(2)}km
        </strong>{" "}
        —{" "}
        {c.moves?.length
          ? `획 ${c.moves.length + 1}개를 차례로 그려요. 획 사이 점선 ${(c.moveMeters / 1000).toFixed(1)}km는 이동 구간이라 기록을 멈추고 이동하면 돼요.`
          : "초록 점에서 출발해 같은 곳으로 돌아오는 한붓 코스예요."}{" "}
        {c.shapeId === "run"
          ? `쾌적도 ${c.similarity}점 — 큰 차도·차 없는 길·비포장·계단·터널·잦은 꺾임으로 매긴 잠정 점수예요.${c.repeatRatio > 0.02 ? ` 출발점에서 고리까지 ${Math.round(c.repeatRatio * 100)}%는 같은 길로 오가요.` : ""}`
          : c.semanticExplanation?.decision === "interpretation"
          ? `AI가 실제 길의 외곽선에서 '${c.shapeName}'을 떠올리고 참고 그림을 만든 실험 추천이에요. 참고 그림과 꾸밈선은 달리는 길이 아니에요.`
          : c.doodle?.model === "clip"
          ? `AI가 외곽선을 '${c.shapeName}'(으)로 해석한 실험 추천이에요. 사람 눈에는 다르게 보일 수 있어요.`
          : c.doodle
          ? `낙서 인식 모델(Quick, Draw! 345가지)이 이 코스 모양을 '${c.shapeName}'(으)로 봤어요 (${courseGrade(c)} · 모델 점수 ${c.similarity}). 사람 눈에는 다르게 보일 수 있어요.`
          : `원래 그림에서 평균 ${c.meanDeviationMeters}m, 최대 ${c.maxDeviationMeters}m 벗어나요.`}
      </p>
      <ShapeExplanation key={c.id} c={c} />
      <RoadInfo c={c} elev={elev} />
      <div className="sel-legend" aria-hidden="true">
        <span>
          <i />달릴 길
        </span>
        {c.outlines?.length !== 0 && (
          <span>
            <i className="lg-guide" />원래 그림
          </span>
        )}
        <span>
          <i className="lg-start" />출발·도착
        </span>
        {c.moves?.length ? (
          <span>
            <i className="lg-move" />이동 구간
          </span>
        ) : null}
      </div>
      <div className="sheet-cta sheet-cta-split">
        <button type="button" className="btn btn-primary btn-lg" onClick={onRun}>
          <Icon name="play" size={18} />
          이 코스로 달리기
        </button>
        <button type="button" className="btn btn-secondary btn-lg btn-square" onClick={onExport} aria-label="GPX 내보내기 (시계용)" title="GPX 내보내기 (시계용)">
          <Icon name="download" size={24} />
        </button>
      </div>
    </>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** 고른 코스의 길 성격과 고도 */
export function RoadInfo({ c, elev }: { c: RouteCandidate; elev: ElevationState }) {
  const r = c.roadInfo;
  return (
    <div className="road-info">
      <ul className="road-facts" aria-label="코스 길 정보">
        <li>
          <span>큰 차도</span>
          <b className="num">{pct(r.major)}</b>
        </li>
        <li>
          <span>차 없는 길</span>
          <b className="num">{pct(r.carFree)}</b>
        </li>
        <li>
          <span>터널·지하도</span>
          <b className="num">{r.tunnels ? `${r.tunnels}곳` : "없음"}</b>
        </li>
        <li>
          <span>비포장</span>
          <b className="num">{pct(r.unpaved)}</b>
        </li>
        <li>
          <span>가로등</span>
          <b className="num">{r.lit === null ? "정보 없음" : pct(r.lit)}</b>
        </li>
        <li>
          <span>계단</span>
          <b className="num">{r.steps ? `${r.steps}곳` : "없음"}</b>
        </li>
        <li>
          <span>오르막</span>
          <b className="num">{elev === "loading" || elev === undefined ? "…" : elev === "error" ? "확인 못 함" : `${elev.ascent}m`}</b>
        </li>
      </ul>
      {elev && elev !== "loading" && elev !== "error" && <ElevationChart p={elev} />}
      <p className="hint">
        길 정보는 OpenStreetMap 기록 기준이에요{r.lit !== null ? ` (가로등은 정보가 있는 ${pct(r.litKnown)} 구간 기준)` : ""}. 고도는 코스 좌표를 Open-Meteo 고도
        서버로 보내 약 90m 간격 지형 자료로 계산한 값이라 다리·고가·터널은 반영되지 않아요.
      </p>
    </div>
  );
}

export function ElevationChart({ p }: { p: ElevationProfile }) {
  const W = 300, H = 56;
  const span = Math.max(10, p.max - p.min);
  const total = p.dist[p.dist.length - 1] || 1;
  const pts = p.elev.map((e, i) => `${((p.dist[i] / total) * W).toFixed(1)},${(H - 4 - ((e - p.min) / span) * (H - 12)).toFixed(1)}`);
  return (
    <figure className="elev-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`고도 ${Math.round(p.min)}m부터 ${Math.round(p.max)}m, 오르막 합계 ${p.ascent}m`}>
        <polygon points={`0,${H} ${pts.join(" ")} ${W},${H}`} className="elev-fill" />
        <polyline points={pts.join(" ")} className="elev-line" />
      </svg>
      <figcaption>
        <span className="num">{Math.round(p.min)}m</span> ~ <span className="num">{Math.round(p.max)}m</span>
      </figcaption>
    </figure>
  );
}
