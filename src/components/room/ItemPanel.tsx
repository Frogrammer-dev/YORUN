"use client";
// S-02 선택 편집 + S-03 작품 상세 패널.

import { useEffect, useState } from "react";
import { FRAMES, ROOM } from "@/lib/contracts/limits";
import type { ArtworkView, Pt, RoomItem } from "@/lib/contracts/types";
import { formatDistance } from "@/lib/gpx/metrics";
import { FRAME_LABELS } from "@/lib/render/scene";
import type { RoomApi } from "./useRoom";

const SWATCHES = ["#0A72D6", "#111318", "#E6155F", "#0F9D58", "#F79009", "#7A5AF8", "#FF4FD8", "#FFFFFF"];
const STEP = 0.02;

export function ItemPanel({ room, item, artwork, onClose }: { room: RoomApi; item: RoomItem; artwork: ArtworkView; onClose: () => void }) {
  const [title, setTitle] = useState(artwork.title);
  const [compare, setCompare] = useState(false);
  const [detail, setDetail] = useState<ArtworkView | null>(artwork.geometry ? artwork : null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setTitle(artwork.title), [artwork.title]);
  useEffect(() => {
    if (compare && !detail) void room.loadDetail(artwork.id).then(setDetail);
  }, [compare, detail, artwork.id, room]);

  const u = (patch: Partial<Omit<RoomItem, "id" | "artworkId">>) => room.updateItem(item.id, patch);
  const simplified = artwork.renderPointCount < artwork.stats.pointCount;

  return (
    <section className="panel" aria-label="선택한 작품 편집">
      <header className="panel-head">
        <h2>{artwork.title}</h2>
        <button type="button" className="btn btn-link" onClick={onClose}>
          닫기
        </button>
      </header>

      <fieldset>
        <legend>위치·크기·회전</legend>
        <div className="pad" role="group" aria-label="위치 이동">
          <span />
          <button type="button" className="btn" aria-label="위로 이동" onClick={() => u({ y: item.y - STEP })}>↑</button>
          <span />
          <button type="button" className="btn" aria-label="왼쪽으로 이동" onClick={() => u({ x: item.x - STEP })}>←</button>
          <span />
          <button type="button" className="btn" aria-label="오른쪽으로 이동" onClick={() => u({ x: item.x + STEP })}>→</button>
          <span />
          <button type="button" className="btn" aria-label="아래로 이동" onClick={() => u({ y: item.y + STEP })}>↓</button>
          <span />
        </div>
        <div className="row">
          <button type="button" className="btn" aria-label="작게" onClick={() => u({ size: item.size - STEP })} disabled={item.size <= ROOM.sizeMin}>
            － 작게
          </button>
          <span className="value">{Math.round(item.size * 100)}%</span>
          <button type="button" className="btn" aria-label="크게" onClick={() => u({ size: item.size + STEP })} disabled={item.size >= ROOM.sizeMax}>
            ＋ 크게
          </button>
        </div>
        <label className="field">
          <span>회전 {Math.round(item.rotationDeg)}°</span>
          <input type="range" min={-180} max={180} step={1} value={item.rotationDeg} onChange={(e) => u({ rotationDeg: Number(e.target.value) })} />
        </label>
        <div className="row btn-grid btn-grid-3">
          <button type="button" className="btn" onClick={() => u({ rotationDeg: item.rotationDeg - 15 })}>↺ 15°</button>
          <button type="button" className="btn" onClick={() => u({ rotationDeg: 0 })}>0°</button>
          <button type="button" className="btn" onClick={() => u({ rotationDeg: item.rotationDeg + 15 })}>↻ 15°</button>
        </div>
        <div className="row btn-grid btn-grid-4">
          <button type="button" className="btn" onClick={() => room.reorder(item.id, "back")}>맨 뒤로</button>
          <button type="button" className="btn" onClick={() => room.reorder(item.id, "backward")}>뒤로</button>
          <button type="button" className="btn" onClick={() => room.reorder(item.id, "forward")}>앞으로</button>
          <button type="button" className="btn" onClick={() => room.reorder(item.id, "front")}>맨 앞으로</button>
        </div>
      </fieldset>

      <fieldset>
        <legend>선 색·굵기·액자</legend>
        <div className="swatches" role="radiogroup" aria-label="선 색">
          {SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={item.style.strokeColor.toUpperCase() === c}
              aria-label={`색 ${c}`}
              className="swatch"
              style={{ background: c }}
              onClick={() => u({ style: { ...item.style, strokeColor: c } })}
            >
              {item.style.strokeColor.toUpperCase() === c ? "✓" : ""}
            </button>
          ))}
          <label className="swatch-custom">
            <span className="visually-hidden">직접 선택</span>
            <input type="color" value={item.style.strokeColor} onChange={(e) => u({ style: { ...item.style, strokeColor: e.target.value.toUpperCase() } })} />
          </label>
        </div>
        <label className="field">
          <span>선 굵기</span>
          <input
            type="range"
            min={ROOM.strokeWidthMin}
            max={ROOM.strokeWidthMax}
            step={0.001}
            value={item.style.strokeWidth}
            onChange={(e) => u({ style: { ...item.style, strokeWidth: Number(e.target.value) } })}
          />
        </label>
        <div className="row" role="radiogroup" aria-label="액자">
          {FRAMES.map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={item.style.frame === f}
              className={`btn ${item.style.frame === f ? "btn-selected" : ""}`}
              onClick={() => u({ style: { ...item.style, frame: f } })}
            >
              {item.style.frame === f ? "✓ " : ""}
              {FRAME_LABELS[f]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>작품 정보</legend>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            void room.renameArtwork(artwork.id, title);
          }}
        >
          <label className="field grow">
            <span>제목</span>
            <input value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <button type="submit" className="btn" disabled={!title.trim() || title.trim() === artwork.title}>
            제목 저장
          </button>
        </form>
        <dl className="facts">
          <dt>GPS 좌표 기반 추정 거리</dt>
          <dd>{formatDistance(artwork.stats.distanceEstimateMeters)}</dd>
          <dt>기록 날짜</dt>
          <dd>{artwork.stats.recordedDate ?? "선택하지 않음"}</dd>
          <dt>구간 수</dt>
          <dd>
            {artwork.stats.segmentCount}개{artwork.stats.segmentCount > 1 ? " (사이를 연결하지 않음)" : ""}
          </dd>
          <dt>전시용 선</dt>
          <dd>
            {simplified ? `단순화 적용 (2m 허용 오차, ${artwork.stats.pointCount}점 → ${artwork.renderPointCount}점)` : `단순화 없음 (${artwork.stats.pointCount}점)`}
          </dd>
          {artwork.sourceKind === "demo" && (
            <>
              <dt>종류</dt>
              <dd>예시 기록 (실제 활동 아님)</dd>
            </>
          )}
        </dl>
        <p className="hint">파일로 제공된 기록이며 실제 운동 여부는 확인하지 않아요. 지도와 원래 위치는 표시하지 않아요.</p>
        <button type="button" className="btn" aria-expanded={compare} onClick={() => setCompare((v) => !v)}>
          {compare ? "비교 닫기" : "기준선과 전시용 선 비교"}
        </button>
        {compare && (detail?.geometry ? <CompareView art={detail} color={item.style.strokeColor} /> : <p className="hint">불러오는 중…</p>)}
      </fieldset>

      <fieldset>
        <legend>전시·삭제</legend>
        <div className="row">
          <button type="button" className="btn" onClick={() => room.removeFromRoom(item.id)}>
            방에서 빼기 (보관 유지)
          </button>
          {!confirmDelete ? (
            <button type="button" className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
              기록 삭제…
            </button>
          ) : (
            <span className="confirm" role="alert">
              작품과 배치를 삭제하고 이 작품이 들어 있는 공유 링크도 종료해요. 되돌릴 수 없어요.
              <button type="button" className="btn btn-danger" onClick={() => void room.deleteArtwork(artwork.id).then((ok) => ok && onClose())}>
                삭제
              </button>
              <button type="button" className="btn btn-link" onClick={() => setConfirmDelete(false)}>
                취소
              </button>
            </span>
          )}
        </div>
      </fieldset>
    </section>
  );
}

/** FR-07: 정규화 기준선(회색)과 전시용 선(색)을 나란히 비교. 지도·원 위치는 없음. */
function CompareView({ art, color }: { art: ArtworkView; color: string }) {
  const g = art.geometry!;
  const pts = (seg: Pt[]) => seg.map(([u, v]) => `${(u * 200).toFixed(2)},${(v * 200).toFixed(2)}`).join(" ");
  const render = g.sourceSegments.map((seg, i) => g.renderIndices[i].map((k) => seg[k]));
  const Box = ({ lines, stroke, label }: { lines: Pt[][]; stroke: string; label: string }) => (
    <figure className="compare-fig">
      <svg viewBox="0 0 200 200" role="img" aria-label={label}>
        <rect width={200} height={200} fill="#fff" stroke="#ddd" />
        {lines.map((l, i) =>
          l.length === 1 ? <circle key={i} cx={l[0][0] * 200} cy={l[0][1] * 200} r={2} fill={stroke} /> : <polyline key={i} points={pts(l)} fill="none" stroke={stroke} strokeWidth={1.5} />,
        )}
      </svg>
      <figcaption>{label}</figcaption>
    </figure>
  );
  return (
    <div className="compare">
      <Box lines={g.sourceSegments} stroke="#555" label={`정규화 기준선 (${g.sourceSegments.flat().length}점)`} />
      <Box lines={render} stroke={color} label={`전시용 선 (${render.flat().length}점)`} />
    </div>
  );
}
