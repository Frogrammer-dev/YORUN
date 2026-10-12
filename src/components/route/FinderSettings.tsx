"use client";
// 코스 찾기 조건 (그림·영역·거리·길 조건)과 찾기 버튼·진행 표시 (표시 전용: 상태는 부모가 가진다)

import { forwardRef } from "react";
import { SHAPES, groupLines, type ShapeId } from "@/lib/route/shapes";
import { CustomShapeInput } from "@/components/route/CustomShapeInput";
import { Icon, PathThumb } from "@/components/Icon";
import { AREAS, ASCENTS, DETAILS, MAX_SIDE, RANGES, type FinderSettingsValue, type SearchProgress } from "./finderOptions";

export interface FinderSettingsProps {
  value: FinderSettingsValue;
  onChange: (patch: Partial<FinderSettingsValue>) => void;
  /** 영역을 고르면 지도도 맞춰야 해서 부모가 따로 처리한다 */
  onChooseArea: (id: FinderSettingsValue["area"]) => void;
  progress: SearchProgress | null;
  /** 지도가 준비됐는가 */
  ready: boolean;
  /** '지금 화면'이 너무 넓은가 */
  tooBig: boolean;
  /** 이미 결과가 있는가 (버튼 색만 바뀐다) */
  hasResults: boolean;
  onSearch: () => void;
  /** 러닝 코스 출발점 [위도, 경도]. null이면 찾을 때의 지도 가운데 */
  start?: [number, number] | null;
  /** 지도를 눌러 출발점을 고르는 중인가 */
  pickingStart?: boolean;
  onPickStart?: () => void;
  onClearStart?: () => void;
}

export function progressText(p: SearchProgress, running = false): string {
  return p.kind === "fetching"
    ? `지도 길 데이터를 받는 중…${p.total > 1 ? ` (${Math.min(p.done + 1, p.total)}/${p.total})` : ""}`
    : `${running ? "러닝 코스 찾는 중" : "그림 맞춰 보는 중"}${p.label ? ` · ${p.label}` : ""}`;
}

export const FinderSettings = forwardRef<HTMLElement, FinderSettingsProps>(function FinderSettings(
  { value: v, onChange, onChooseArea, progress, ready, tooBig, hasResults, onSearch, start = null, pickingStart = false, onPickStart, onClearStart },
  ref,
) {
  const area = AREAS.find((a) => a.id === v.area)!;
  const running = v.mode === "running";
  const toggle = (key: "excludeSteps" | "avoidUnpaved" | "avoidMajor" | "preferLit" | "preferCarFree" | "avoidTunnels" | "branches" | "nearby", label: string) => (
    <label className="toggle-row">
      {label}
      <input type="checkbox" role="switch" className="switch" checked={v[key]} onChange={(e) => onChange({ [key]: e.target.checked })} />
    </label>
  );
  return (
    <section className="sheet-section" ref={ref} aria-labelledby="settings-title">
      <div className="seg" role="radiogroup" aria-label="찾을 코스 종류" style={{ marginBottom: 16 }}>
        {(
          [
            ["drawing", "드로잉 런"],
            ["running", "러닝 코스"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="radio" aria-checked={v.mode === id} className={`seg-btn ${v.mode === id ? "seg-on" : ""}`} onClick={() => onChange({ mode: id })}>
            {label}
          </button>
        ))}
      </div>
      {running ? (
        <>
          <h2 id="settings-title">어디서 달릴까요?</h2>
          <fieldset className="seg-field">
            <legend>출발·도착점</legend>
            <p className="hint" style={{ marginTop: 0 }}>
              {pickingStart ? "지도에서 출발할 곳을 눌러 주세요." : start ? `고른 지점 (${start[0].toFixed(5)}, ${start[1].toFixed(5)})` : "지도 가운데 (찾을 때 기준)"}
            </p>
            <div className="seg">
              <button type="button" className={`seg-btn ${pickingStart ? "seg-on" : ""}`} aria-pressed={pickingStart} onClick={onPickStart}>
                지도에서 고르기
              </button>
              <button type="button" className="seg-btn" onClick={onClearStart} disabled={!start && !pickingStart}>
                지도 가운데로
              </button>
            </div>
            <p className="hint">출발점에서 시작해 동네를 한 바퀴 돌고 다시 출발점으로 돌아오는 코스를 쾌적한 길 순으로 찾아요. 장소 검색으로 고른 곳도 출발점이 돼요.</p>
          </fieldset>
        </>
      ) : (
        <>
      <h2 id="settings-title">어떤 그림을 달릴까요?</h2>
      <div className="shape-rail" role="radiogroup" aria-label="그림 모양">
        <button type="button" role="radio" aria-checked={v.shape === "auto"} aria-label="동네 길로 만들 수 있는 코스 추천" className="shape-tile shape-tile-wide" onClick={() => onChange({ shape: "auto" })}>
          <span className="tick"><Icon name="check" size={12} strokeWidth={3} /></span>
          <Icon name="sparkle" size={30} strokeWidth={1.8} />
          동네 추천
        </button>
        <button type="button" role="radio" aria-checked={v.shape === "custom"} aria-label="찾고 싶은 그림 직접 그리기" className="shape-tile shape-tile-wide" onClick={() => onChange({ shape: "custom" })}>
          <span className="tick"><Icon name="check" size={12} strokeWidth={3} /></span>
          {v.custom ? <PathThumb lines={groupLines(v.custom)} size={36} pad={3} width={2.5} /> : <Icon name="pencil" size={30} strokeWidth={1.8} />}
          내 그림
        </button>
        {SHAPES.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={v.shape === s.id} aria-label={s.name} className="shape-tile" onClick={() => onChange({ shape: s.id as ShapeId })}>
            <span className="tick"><Icon name="check" size={12} strokeWidth={3} /></span>
            <PathThumb lines={[s.points]} size={36} pad={3} width={2.5} />
            {s.name}
          </button>
        ))}
      </div>
      {v.shape === "auto" && <p className="hint">동네 길로 자연스럽게 이어지는 고리 코스를 먼저 찾고, 도형·동물·사물 {SHAPES.length}가지 중 어떤 그림과 닮았는지 알려 줘요. 같은 길을 되밟지 않아요.</p>}
      {v.shape === "custom" && <CustomShapeInput value={v.custom} onChange={(custom) => onChange({ custom })} />}

      <fieldset className="seg-field">
        <legend>찾을 영역</legend>
        <div className="seg" role="radiogroup" aria-label="찾을 영역">
          {AREAS.map((a) => (
            <button key={a.id} type="button" role="radio" aria-checked={v.area === a.id} aria-label={a.km ? `지도 가운데 ${a.label} 사방` : a.label} className={`seg-btn ${v.area === a.id ? "seg-on" : ""}`} onClick={() => onChooseArea(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        <p className="hint">
          {area.km === 0
            ? `지금 보이는 지도에서 찾아요 (최대 ${MAX_SIDE / 1000}km × ${MAX_SIDE / 1000}km).`
            : `지도 가운데를 중심으로 ${area.label} × ${area.label} 사각형에서 찾아요. 넓을수록 길 데이터를 여러 번 나눠 받고 탐색도 오래 걸려요.`}
        </p>
      </fieldset>

      {toggle("nearby", "주변 동네도 비교")}
      <p className="hint">선택한 영역의 코스를 유지하며 가까운 주변도 찾아요. 시간이 더 걸릴 수 있어요.</p>
      {v.nearby && v.shape === "custom" && v.custom && v.custom.parts.length > 1 && <p className="hint">여러 획으로 된 그림은 선택한 영역에서 찾아요.</p>}
        </>
      )}

      <fieldset className="seg-field">
        <legend>코스 거리 (km)</legend>
        <div className="seg" role="radiogroup" aria-label="코스 거리">
          {RANGES.map((r, i) => (
            <button key={r.label} type="button" role="radio" aria-checked={v.range === i} aria-label={r.label} className={`seg-btn ${v.range === i ? "seg-on" : ""}`} onClick={() => onChange({ range: i })}>
              {r.label.replace("~", "–").replace("km", "")}
            </button>
          ))}
        </div>
      </fieldset>

      {!running && (
      <fieldset className="seg-field">
        <legend>길 단순화</legend>
        <div className="seg" role="radiogroup" aria-label="길 단순화">
          {DETAILS.map((d) => (
            <button key={d.id} type="button" role="radio" aria-checked={v.detail === d.id} className={`seg-btn ${v.detail === d.id ? "seg-on" : ""}`} onClick={() => onChange({ detail: d.id })}>
              {d.label}
            </button>
          ))}
        </div>
        <p className="hint">{DETAILS.find((d) => d.id === v.detail)!.hint}</p>
      </fieldset>
      )}

      {!running && (
        <>
      <label className="field">
        <span>
          최소 유사도 <span className="num">{v.minSimilarity}</span>
        </span>
        <input type="range" min={0} max={100} step={5} value={v.minSimilarity} aria-label="최소 유사도" onChange={(e) => onChange({ minSimilarity: Number(e.target.value) })} />
      </label>
      <p className="hint">이 점수보다 낮게 닮은 코스는 목록·지도에서 숨겨요. 찾은 뒤에 바꿔도 바로 적용돼요. (그림 인식 코스는 따로 판정해요)</p>
        </>
      )}

      {toggle("excludeSteps", "계단 제외")}
      {toggle("avoidUnpaved", "비포장 길 빼기 (흙·자갈)")}
      {toggle("avoidMajor", "큰 차도 피하기")}
      {running && toggle("preferCarFree", "차 없는 길 우선 (보행로·산책로)")}
      {running && toggle("avoidTunnels", "터널·지하도 피하기")}
      {toggle("preferLit", "가로등 있는 길 우선")}
      <p className="hint">길 조건은 OpenStreetMap에 기록된 정보만 써요. 가로등은 기록된 길이 아주 적어(대부분 지역 2% 이하) 효과가 작아요.</p>

      {running && (
      <fieldset className="seg-field">
        <legend>오르막 합계</legend>
        <div className="seg" role="radiogroup" aria-label="오르막 합계">
          {ASCENTS.map((a) => (
            <button key={a.label} type="button" role="radio" aria-checked={v.maxAscent === a.value} className={`seg-btn ${v.maxAscent === a.value ? "seg-on" : ""}`} onClick={() => onChange({ maxAscent: a.value })}>
              {a.label}
            </button>
          ))}
        </div>
        {v.maxAscent !== null && <p className="hint">찾은 코스마다 고도를 받아 오르막이 많은 코스를 숨겨요. 이때 후보 코스 좌표가 Open-Meteo 고도 서버로 전송돼요.</p>}
      </fieldset>
      )}
      {!running && v.shape === "auto" && toggle("branches", "실험: 꼬리·다리 붙인 코스도 찾기")}
      {!running && v.shape === "auto" && v.branches && <p className="hint">고리에 갔다가 같은 길로 돌아오는 가지를 붙여 봐요. 인식 결과가 엉뚱할 수 있어요.</p>}

      <div className="sheet-cta">
        {progress ? (
          <div className="progress-cta" role="status">
            <span>{progressText(progress, running)}</span>
            {progress.kind === "searching" && <span className="num">{Math.round(progress.fraction * 100)}%</span>}
            <i
              className={`progress-bar ${progress.kind === "fetching" ? "progress-indeterminate" : ""}`}
              style={progress.kind === "searching" ? { width: `${Math.round(progress.fraction * 100)}%` } : undefined}
            />
          </div>
        ) : (
          <button type="button" className={`btn btn-lg ${hasResults ? "btn-ink" : "btn-primary"}`} onClick={onSearch} disabled={!ready || pickingStart || (!running && (tooBig || (v.shape === "custom" && !v.custom)))}>
            {running ? "출발점에서 러닝 코스 찾기" : "지금 보이는 지도에서 코스 찾기"}
          </button>
        )}
        {!running && tooBig && !progress && (
          <p className="hint center">
            지도를 조금 더 확대해 주세요 (최대 {MAX_SIDE / 1000}km × {MAX_SIDE / 1000}km)
          </p>
        )}
      </div>
      <p className="hint sheet-foot">지도 영역(좌표 범위)이 길 데이터를 받기 위해 OpenStreetMap 데이터 서버로 전송돼요. 내 정확한 위치는 보내지 않아요. 지도 위 장소 검색을 쓰면 검색어가 카카오로 전송돼요.</p>
    </section>
  );
});
