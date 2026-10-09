"use client";
// S-01 가져오기 흐름: 파일 선택 → 검증 → (여러 트랙이면) 선택 → 날짜·제목 → 작품 생성.
// 파일 파싱·거리 계산·정규화는 모두 이 브라우저 안에서 일어난다.

import { useEffect, useRef, useState } from "react";
import { buildArtwork } from "@/lib/art/artwork";
import { DEFAULT_TITLE } from "@/lib/contracts/limits";
import type { ArtworkView } from "@/lib/contracts/types";
import { ImportError, describeImportError } from "@/lib/gpx/errors";
import { dateCandidates, formatDistance, trackDistanceMeters } from "@/lib/gpx/metrics";
import { hasDrawableSegment, parseGpxFile, type ParseStage, type ParsedGpx } from "@/lib/gpx/parser";
import { durationBucket, track } from "@/lib/client/analytics";
import { Icon } from "./Icon";

type Step =
  | { kind: "idle" }
  | { kind: "working"; stage: ParseStage; fraction: number }
  | { kind: "chooseTrack"; parsed: ParsedGpx }
  | { kind: "details"; parsed: ParsedGpx; trackIndex: number }
  | { kind: "error"; title: string; action: string };

const STAGE_LABEL: Record<ParseStage, string> = { read: "파일 읽는 중", parse: "XML 확인 중", extract: "좌표 추출 중" };

interface Props {
  onCreated: (view: ArtworkView) => void;
  /** 시작 화면에서는 큰 버튼, 작품방에서는 작은 버튼 */
  compact?: boolean;
  disabledReason?: string | null;
}

export function ImportPanel({ onCreated, compact, disabledReason }: Props) {
  const [step, setStep] = useState<Step>({ kind: "idle" });
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [date, setDate] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const fail = (e: unknown) => {
    const d = describeImportError(e);
    track({ name: "import_failed", errorCode: e instanceof ImportError ? e.code : "unknown" });
    setStep({ kind: "error", ...d });
  };

  async function onFile(file: File | undefined) {
    if (!file) return;
    track({ name: "import_started" });
    startedAt.current = performance.now();
    const ac = new AbortController();
    abortRef.current = ac;
    setStep({ kind: "working", stage: "read", fraction: 0 });
    try {
      const parsed = await parseGpxFile(file, {
        signal: ac.signal,
        onProgress: (stage, fraction) => setStep({ kind: "working", stage, fraction }),
      });
      const drawable = parsed.tracks.filter(hasDrawableSegment);
      if (drawable.length === 0) throw new ImportError("no_valid_segment", "그릴 수 있는 구간 없음");
      setTitle(DEFAULT_TITLE);
      setDate("");
      if (parsed.tracks.length > 1) setStep({ kind: "chooseTrack", parsed });
      else setStep({ kind: "details", parsed, trackIndex: 0 });
    } catch (e) {
      fail(e);
    } finally {
      abortRef.current = null;
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  function create(parsed: ParsedGpx, trackIndex: number) {
    try {
      const t = parsed.tracks[trackIndex];
      const { view } = buildArtwork(t, { title, recordedDate: date || null });
      track({ name: "preview_ready", durationBucket: durationBucket(performance.now() - startedAt.current) });
      setStep({ kind: "idle" });
      onCreated(view);
    } catch (e) {
      fail(e);
    }
  }

  const busy = step.kind === "working";

  return (
    <div className={compact ? "import import-compact" : "import"}>
      <label className={`btn btn-secondary ${compact ? "" : "btn-lg"} ${disabledReason ? "btn-disabled" : ""}`} aria-disabled={!!disabledReason || busy}>
        <Icon name="upload" size={18} />
        {compact ? "작품 추가 (GPX)" : "내 GPX로 시작"}
        <input
          ref={fileInput}
          type="file"
          accept=".gpx,application/gpx+xml,application/xml,text/xml"
          className="visually-hidden"
          disabled={!!disabledReason || busy}
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </label>
      {disabledReason && <p className="hint">{disabledReason}</p>}

      {step.kind === "working" && (
        <div className="card" role="status" aria-live="polite">
          <p>
            {STAGE_LABEL[step.stage]}… {Math.round(step.fraction * 100)}%
          </p>
          <progress max={1} value={step.fraction} />
          <button type="button" className="btn" onClick={() => abortRef.current?.abort()}>
            취소
          </button>
        </div>
      )}

      {step.kind === "error" && (
        <div className="card card-error" role="alert">
          <p>
            <strong>{step.title}</strong>
          </p>
          <p>{step.action}</p>
          <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
            다른 파일 선택
          </button>
        </div>
      )}

      {step.kind === "chooseTrack" && (
        <div className="card">
          <p>
            <strong>전시할 기록 하나를 선택해 주세요.</strong>
          </p>
          <ul className="track-list">
            {step.parsed.tracks.map((t) => {
              const ok = hasDrawableSegment(t);
              return (
                <li key={t.index}>
                  <button
                    type="button"
                    className="btn"
                    disabled={!ok}
                    onClick={() => setStep({ kind: "details", parsed: step.parsed, trackIndex: t.index })}
                  >
                    {t.name ? t.name : `트랙 ${t.index + 1}`} · {t.segments.length}개 구간 · {formatDistance(trackDistanceMeters(t))}
                    {!ok && " (그릴 수 없음)"}
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn btn-link" onClick={() => setStep({ kind: "idle" })}>
            취소
          </button>
        </div>
      )}

      {step.kind === "details" && (
        <DetailsForm
          parsed={step.parsed}
          trackIndex={step.trackIndex}
          title={title}
          setTitle={setTitle}
          date={date}
          setDate={setDate}
          onCancel={() => setStep({ kind: "idle" })}
          onCreate={() => create(step.parsed, step.trackIndex)}
        />
      )}
    </div>
  );
}

function DetailsForm(p: {
  parsed: ParsedGpx;
  trackIndex: number;
  title: string;
  setTitle: (s: string) => void;
  date: string;
  setDate: (s: string) => void;
  onCancel: () => void;
  onCreate: () => void;
}) {
  const t = p.parsed.tracks[p.trackIndex];
  const dates = dateCandidates(t);
  const segs = t.segments.length;
  const ref = useRef<HTMLFormElement>(null);
  // 카드가 열리면 화면 안으로 가져오고 제목 입력에 포커스 (키보드·스크린리더 사용자)
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    ref.current?.querySelector("input")?.focus({ preventScroll: true });
  }, []);
  return (
    <form
      ref={ref}
      className="card import-card"
      aria-labelledby="import-card-title"
      onSubmit={(e) => {
        e.preventDefault();
        p.onCreate();
      }}
    >
      <h3 id="import-card-title">작품으로 만들기</h3>
      <p className="import-summary">
        <Icon name="frame" size={18} />
        <span className="num">{(trackDistanceMeters(t) / 1000).toFixed(2)}</span> km · {segs}개 구간
      </p>
      {segs > 1 && <p className="note">기록에 {segs}개 구간이 있어요. 사이를 연결하지 않고 전시합니다.</p>}
      <label className="field">
        <span>작품 제목</span>
        <input value={p.title} maxLength={60} onChange={(e) => p.setTitle(e.target.value)} required />
      </label>
      {dates.length > 0 && (
        <label className="field">
          <span>기록 날짜 (선택)</span>
          <select value={p.date} onChange={(e) => p.setDate(e.target.value)}>
            <option value="">저장하지 않음</option>
            {dates.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="hint">
        GPS 좌표 기반 추정 거리 {formatDistance(trackDistanceMeters(t))} · 파일명·기기 정보·원래 위치는 저장하지 않아요.
      </p>
      <div className="row import-actions">
        <button type="submit" className="btn btn-primary">
          작품 만들기
        </button>
        <button type="button" className="btn btn-link" onClick={p.onCancel}>
          취소
        </button>
      </div>
    </form>
  );
}
