"use client";
// 찾고 싶은 그림 만들기: 손으로 그리기(여러 획 가능) · 글자와 설명 입력 · 이미지 올리기.
// 어느 방법이든 '닫힌 획 여러 개'로 바꾸고(획 수 제한 없음, 많을수록 탐색이 오래 걸린다), 획 사이는 코스에서 이동 구간이 된다.

import { useEffect, useRef, useState } from "react";
import { binarize, traceOutlines } from "@/lib/art/trace";
import { MAX_DRAWN_LETTERS, parsePromptInput } from "@/lib/route/promptInput";
import { groupFromLoops, groupLines, type ShapeGroup } from "@/lib/route/shapes";
import { GROUP_BASE_PARTS, groupBudgetMs } from "@/lib/route/groupBudget";

type Tab = "draw" | "prompt" | "image";
type Pt = [number, number];

const SIZE = 240;

export function CustomShapeInput({ value, onChange }: { value: ShapeGroup | null; onChange: (g: ShapeGroup | null) => void }) {
  const [tab, setTab] = useState<Tab>("draw");
  return (
    <div className="draw-pad">
      <div className="seg" role="tablist" aria-label="그림 만드는 방법">
        {(
          [
            ["draw", "그리기"],
            ["prompt", "글자·설명"],
            ["image", "이미지"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`seg-btn ${tab === id ? "seg-on" : ""}`} onClick={() => { if (tab !== id) { setTab(id); onChange(null); } }}>
            {label}
          </button>
        ))}
      </div>
      {tab === "draw" && <DrawTab onChange={onChange} />}
      {tab === "prompt" && <PromptTab onChange={onChange} />}
      {tab === "image" && <ImageTab onChange={onChange} />}
      {value && tab !== "draw" && <GroupPreview group={value} />}
      {value && (
        <p className="hint">
          {value.parts.length > 1 ? `획 ${value.parts.length}개 — 획마다 고리 코스를 만들고, 획 사이는 이동 구간(점선)으로 이어요.` : "이 그림과 닮은 코스를 찾아요."}
          {value.parts.length > 1 && (
            <>
              {" "}획이 많을수록 코스를 찾는 데 오래 걸려요
              {value.parts.length > GROUP_BASE_PARTS ? ` (이 그림은 최대 약 ${Math.round(groupBudgetMs(value.parts.length) / 1000)}초, 넓은 영역은 더 걸릴 수 있어요)` : ""}.
              {" "}획마다 길이를 나눠 가지므로, 획이 많으면 코스 거리를 길게 고르면 그림이 덜 뭉개져요.
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** @로 시작하면 바로 글자를 그리고, 아니면 설명을 서버에 보내 윤곽을 받는다 */
function PromptTab({ onChange }: { onChange: (g: ShapeGroup | null) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  // 윤곽 생성은 10초 안팎 걸린다: 지난 시간을 보여 주고 취소할 수 있게 한다
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 새 요청마다 0초부터 센다
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  function cancel() {
    pending.current?.abort();
    setBusy(false);
    setMessage("윤곽 만들기를 취소했어요.");
  }
  const input = parsePromptInput(prompt);

  function change(value: string) {
    pending.current?.abort();
    setBusy(false);
    setMessage("");
    setPrompt(value);
    const next = parsePromptInput(value);
    if (next.kind !== "text" || !next.text || next.tooLong) {
      onChange(null);
      return;
    }
    const group = groupFromText(next.text);
    if (!group) setMessage("이 글자로는 달릴 수 있는 획을 만들지 못했어요.");
    onChange(group);
  }

  async function generate() {
    if (input.kind !== "description") return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage("");
    onChange(null);
    try {
      const response = await fetch("/api/recognition/outline", { method: "POST",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: input.text }), signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "윤곽을 만들지 못했어요.");
      if (!controller.signal.aborted) onChange(result.group);
    } catch (error) {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "다시 시도해 주세요.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const tooLong = input.kind === "text" && input.tooLong;
  return <>
    <label className="field">
      <span>어떤 모습으로 달릴까요?</span>
      <input value={prompt} maxLength={300} placeholder="예: 귀 접힌 토끼, 글자는 @LOVE" aria-invalid={tooLong || undefined}
        onChange={(e) => change(e.target.value)}
        onFocus={(e) => e.target.scrollIntoView({ block: "center", behavior: "smooth" })}
        onKeyDown={(e) => { if (e.key === "Enter" && input.kind === "description" && !busy) { e.preventDefault(); void generate(); } }} />
    </label>
    {input.kind === "text" ? (
      <p className="hint">{tooLong ? `글자는 ${MAX_DRAWN_LETTERS}자까지 그릴 수 있어요.` : "굵은 글꼴의 바깥 윤곽을 따라 달려요. 글자 하나가 획 하나가 되고, 작은 점(예: i의 점)은 빠져요."}</p>
    ) : (
      <>
        <button type="button" className="seg-btn" disabled={input.kind === "empty" || busy} onClick={() => void generate()}>
          {busy ? `윤곽 만드는 중… ${elapsed}초` : "윤곽 만들기"}
        </button>
        {busy && (
          <p className="hint" role="status">
            안전 검사 → 실루엣 그리기 → 윤곽 정리 순서로 만들어요. 보통 10초 안팎 걸려요.{" "}
            <button type="button" className="btn btn-ghost btn-sm" onClick={cancel}>취소</button>
          </p>
        )}
        <p className="hint">앞에 @를 붙이면 그 글자를 그려요. 설명과 생성된 윤곽은 윤곽 생성과 안전 검사를 위해 OpenAI로 전송돼요. 이름이나 연락처 같은 개인정보는 빼 주세요.</p>
      </>
    )}
    {message && <p role="alert">{message}</p>}
  </>;
}

/** 그림 전체 미리보기 (정리된 획) */
function GroupPreview({ group }: { group: ShapeGroup }) {
  const lines = groupLines(group);
  const pad = 20, inner = SIZE - pad * 2;
  return (
    <svg className="draw-canvas draw-preview" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`정리된 그림 미리보기, 획 ${group.parts.length}개`}>
      {lines.map((l, i) => (
        <path key={i} d={l.map(([x, y], k) => `${k ? "L" : "M"}${(SIZE / 2 + x * inner).toFixed(1)} ${(SIZE / 2 - y * inner).toFixed(1)}`).join("") + "Z"} fill="none" className="draw-ink" />
      ))}
    </svg>
  );
}

/** 시작점과 끝점이 획 크기의 25%보다 멀면 닫지 않은 선(직선·호)으로 본다 */
export function isOpenStroke(s: readonly Pt[]): boolean {
  const xs = s.map((p) => p[0]), ys = s.map((p) => p[1]);
  const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return ext > 0 && Math.hypot(s[0][0] - s[s.length - 1][0], s[0][1] - s[s.length - 1][1]) > 0.25 * ext;
}

type Stroke = { pts: Pt[]; open: boolean };
/** 경로 찾기에는 닫힌 획만 쓴다 (열린 선의 왕복 경로는 아직 지원하지 않는다) */
const closedGroup = (list: Stroke[]) => {
  const loops = list.filter((s) => !s.open).map((s) => s.pts);
  return loops.length ? groupFromLoops(loops, { order: "given", minPartRatio: 0.08 }) : null;
};

function DrawTab({ onChange }: { onChange: (g: ShapeGroup | null) => void }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [cur, setCur] = useState<Pt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  // 획을 그린 뒤 나오는 안내가 아래 고정 찾기 버튼에 가리지 않게 보이는 곳까지만 스크롤한다
  useEffect(() => {
    if (error) footRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  const at = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  const update = (list: Stroke[]) => {
    setStrokes(list);
    const g = closedGroup(list);
    onChange(g);
    return g;
  };

  return (
    <>
      <svg
        ref={svgRef}
        className="draw-canvas"
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="찾고 싶은 그림을 그리는 칸. 시작점 가까이에서 손을 떼면 이어진 획, 멀리서 떼면 이어지지 않은 선이 돼요. 여러 획을 그릴 수 있어요."
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          setError(null);
          setCur([at(e)]);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = at(e);
          setCur((s) => (!s ? [p] : Math.hypot(p[0] - s[s.length - 1][0], p[1] - s[s.length - 1][1]) < 2 ? s : [...s, p]));
        }}
        onPointerUp={() => {
          if (!drawing.current) return;
          drawing.current = false;
          const s = cur;
          setCur(null);
          if (!s || s.length < 8) return;
          const open = isOpenStroke(s);
          const before = closedGroup(strokes)?.parts.length ?? 0;
          const g = update([...strokes, { pts: s, open }]);
          if (open) setError(g ? "이어지지 않은 선은 그림에 점선으로 남아요. 코스 찾기에는 아직 닫힌 획만 쓰여요." : "이어지지 않은 선은 그림에 점선으로 남아요. 코스 찾기에는 닫힌 획이 하나 이상 필요해요.");
          else if (!g || g.parts.length <= before) setError("방금 획은 너무 작거나 안쪽이 없어서 빠졌어요. 조금 더 크게, 닫힌 모양으로 그려 주세요.");
        }}
        onPointerCancel={() => {
          drawing.current = false;
          setCur(null);
        }}
      >
        {strokes.map((s, i) => (
          <path key={i} d={s.pts.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + (s.open ? "" : "Z")} fill="none" className={s.open ? "draw-ink draw-ink-open" : "draw-ink"} />
        ))}
        {cur && <polyline points={cur.map((p) => p.join(",")).join(" ")} fill="none" className="draw-ink" />}
        {!strokes.length && !cur && (
          <text x={SIZE / 2} y={SIZE / 2} textAnchor="middle" dominantBaseline="middle" className="draw-placeholder">
            여기에 그려 보세요
          </text>
        )}
      </svg>
      <div className="draw-foot" ref={footRef}>
        <p className="hint" role={error ? "alert" : undefined}>
          {error ?? "시작점 가까이에서 손을 떼면 이어진 획이 되고, 멀리서 떼면 이어지지 않은 선(직선)으로 남아요. 떨어진 여러 획(예: 하트 두 개)도 그릴 수 있어요."}
        </p>
        {strokes.length > 0 && (
          <>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update(strokes.slice(0, -1))}>
              한 획 지우기
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => update([])}>
              모두 지우기
            </button>
          </>
        )}
      </div>
    </>
  );
}

/** 캔버스 픽셀 → 바깥 윤곽선들 (캔버스 좌표) */
function outlinesFromCanvas(c: HTMLCanvasElement, mode: "alpha" | "luma"): Pt[][] {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const { data } = ctx.getImageData(0, 0, c.width, c.height);
  const n = c.width * c.height;
  let mask: Uint8Array;
  if (mode === "alpha") {
    mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) mask[i] = data[i * 4 + 3] >= 128 ? 1 : 0;
  } else {
    const gray = new Uint8Array(n), alpha = new Uint8Array(n);
    let transparent = false;
    for (let i = 0; i < n; i++) {
      gray[i] = Math.round(0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]);
      alpha[i] = data[i * 4 + 3];
      if (alpha[i] < 128) transparent = true;
    }
    mask = binarize(gray, transparent ? alpha : undefined);
  }
  return traceOutlines(mask, c.width, c.height, (c.width * c.height) / 2000);
}

/** 굵은 글꼴로 글자를 그려 윤곽을 뽑는다. 서버로 보내지 않는다 */
function groupFromText(text: string): ShapeGroup | null {
  const c = document.createElement("canvas");
  c.width = 480;
  c.height = 160;
  const ctx = c.getContext("2d")!;
  ctx.font = `900 120px ${getComputedStyle(document.body).fontFamily}`;
  const w = ctx.measureText(text).width;
  const size = Math.min(120, Math.floor((120 * 440) / Math.max(1, w)));
  ctx.font = `900 ${size}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(text, c.width / 2, c.height / 2);
  return groupFromLoops(outlinesFromCanvas(c, "alpha"), { order: "leftToRight", name: `"${text}"`, minPartRatio: 0.1, maxVertices: 28 });
}

function ImageTab({ onChange }: { onChange: (g: ShapeGroup | null) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);

  async function load(file: File | undefined) {
    if (!file) return;
    setName(file.name);
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
      setError("5MB 이하 PNG·JPG·WebP·GIF·SVG 이미지를 올려 주세요.");
      onChange(null);
      return;
    }
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((ok, fail) => {
        img.onload = () => ok();
        img.onerror = () => fail(new Error("load"));
        img.src = url;
      });
      const k = 240 / Math.max(img.naturalWidth || 240, img.naturalHeight || 240);
      const c = document.createElement("canvas");
      c.width = Math.max(8, Math.round((img.naturalWidth || 240) * k));
      c.height = Math.max(8, Math.round((img.naturalHeight || 240) * k));
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      const g = groupFromLoops(outlinesFromCanvas(c, "luma"), { order: "leftToRight", name: "내 그림", minPartRatio: 0.15, maxVertices: 28 });
      setError(g ? null : "윤곽을 찾지 못했어요. 배경과 그림이 또렷하게 구분되는 단순한 그림을 써 주세요.");
      // ponytail: 올릴 때마다 object URL 하나가 탭이 닫힐 때까지 남는다 (이미지 몇 장 수준이라 해제하지 않음)
      if (!g) URL.revokeObjectURL(url);
      onChange(g && { ...g, image: { url, width: c.width, height: c.height } });
    } catch {
      setError("이미지를 열지 못했어요.");
      onChange(null);
    }
  }

  return (
    <div className="field" style={{ marginTop: 12 }}>
      <label htmlFor="shape-image">이미지</label>
      <input id="shape-image" type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml" onChange={(e) => void load(e.target.files?.[0])} />
      <p className="hint" role={error ? "alert" : undefined}>
        {error ?? (name ? `${name}의 윤곽을 따라요.` : "흰 배경에 검은 실루엣처럼 단순한 그림일수록 잘 돼요. 이미지는 기기 안에서만 처리하고 어디에도 보내지 않아요.")}
      </p>
    </div>
  );
}
