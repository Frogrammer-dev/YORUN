"use client";
// 찾고 싶은 그림 만들기: 손으로 그리기(여러 획 가능) · 글자 입력 · 이미지 올리기.
// 어느 방법이든 '닫힌 획 여러 개'로 바꾸고, 획 사이는 코스에서 이동 구간이 된다.

import { useRef, useState } from "react";
import { binarize, traceOutlines } from "@/lib/art/trace";
import { groupFromLoops, groupLines, type ShapeGroup } from "@/lib/route/shapes";

type Tab = "draw" | "text" | "image";
type Pt = [number, number];

const SIZE = 240;
const MAX_PARTS = 6;

export function CustomShapeInput({ value, onChange }: { value: ShapeGroup | null; onChange: (g: ShapeGroup | null) => void }) {
  const [tab, setTab] = useState<Tab>("draw");
  return (
    <div className="draw-pad">
      <div className="seg" role="tablist" aria-label="그림 만드는 방법">
        {(
          [
            ["draw", "그리기"],
            ["text", "글자"],
            ["image", "이미지"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`seg-btn ${tab === id ? "seg-on" : ""}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "draw" && <DrawTab onChange={onChange} />}
      {tab === "text" && <TextTab onChange={onChange} />}
      {tab === "image" && <ImageTab onChange={onChange} />}
      {value && tab !== "draw" && <GroupPreview group={value} />}
      {value && (
        <p className="hint">
          {value.parts.length > 1 ? `획 ${value.parts.length}개 — 획마다 고리 코스를 만들고, 획 사이는 이동 구간(점선)으로 이어요.` : "이 그림과 닮은 코스를 찾아요."}
        </p>
      )}
    </div>
  );
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

function DrawTab({ onChange }: { onChange: (g: ShapeGroup | null) => void }) {
  const [strokes, setStrokes] = useState<Pt[][]>([]);
  const [cur, setCur] = useState<Pt[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drawing = useRef(false);
  const svgRef = useRef<SVGSVGElement>(null);

  const at = (e: React.PointerEvent): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * SIZE, ((e.clientY - r.top) / r.height) * SIZE];
  };
  const update = (list: Pt[][]) => {
    setStrokes(list);
    const g = list.length ? groupFromLoops(list, { order: "given", minPartRatio: 0.08, maxParts: MAX_PARTS }) : null;
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
        aria-label="찾고 싶은 그림을 그리는 칸. 획마다 손을 떼면 시작점과 끝점이 이어져요. 여러 획을 그릴 수 있어요."
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
          if (strokes.length >= MAX_PARTS) {
            setError(`획은 ${MAX_PARTS}개까지 그릴 수 있어요.`);
            return;
          }
          const before = strokes.length ? (groupFromLoops(strokes, { order: "given", minPartRatio: 0.08, maxParts: MAX_PARTS })?.parts.length ?? 0) : 0;
          const g = update([...strokes, s]);
          if (!g || g.parts.length <= before) setError("방금 획은 너무 작거나 안쪽이 없어서 빠졌어요. 조금 더 크게, 닫힌 모양으로 그려 주세요.");
        }}
        onPointerCancel={() => {
          drawing.current = false;
          setCur(null);
        }}
      >
        {strokes.map((s, i) => (
          <path key={i} d={s.map((p, k) => `${k ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join("") + "Z"} fill="none" className="draw-ink" />
        ))}
        {cur && <polyline points={cur.map((p) => p.join(",")).join(" ")} fill="none" className="draw-ink" />}
        {!strokes.length && !cur && (
          <text x={SIZE / 2} y={SIZE / 2} textAnchor="middle" dominantBaseline="middle" className="draw-placeholder">
            여기에 그려 보세요
          </text>
        )}
      </svg>
      <div className="draw-foot">
        <p className="hint" role={error ? "alert" : undefined}>
          {error ?? "획마다 손을 떼면 시작점과 끝점이 이어져요. 떨어진 여러 획(예: 하트 두 개)도 그릴 수 있어요."}
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

function TextTab({ onChange }: { onChange: (g: ShapeGroup | null) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  function make(t: string) {
    setText(t);
    const s = t.trim();
    if (!s) {
      setError(null);
      onChange(null);
      return;
    }
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.font = `900 120px ${getComputedStyle(document.body).fontFamily}`;
    const w = ctx.measureText(s).width;
    const size = Math.min(120, Math.floor((120 * 440) / Math.max(1, w)));
    ctx.font = `900 ${size}px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#000";
    ctx.fillText(s, c.width / 2, c.height / 2);
    const g = groupFromLoops(outlinesFromCanvas(c, "alpha"), { order: "leftToRight", name: `"${s}"`, minPartRatio: 0.1, maxParts: MAX_PARTS, maxVertices: 28 });
    setError(g ? null : "이 글자로는 달릴 수 있는 획을 만들지 못했어요.");
    onChange(g);
  }

  return (
    <div className="field" style={{ marginTop: 12 }}>
      <label htmlFor="shape-text">글자 (최대 4자)</label>
      <input id="shape-text" type="text" maxLength={4} value={text} placeholder="예: 520, LOVE, 별" onChange={(e) => make(e.target.value)} />
      <p className="hint" role={error ? "alert" : undefined}>
        {error ?? "굵은 글꼴의 바깥 윤곽을 따라 달려요. 글자 하나가 획 하나가 되고, 작은 점(예: i의 점)은 빠져요."}
      </p>
    </div>
  );
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
      const g = groupFromLoops(outlinesFromCanvas(c, "luma"), { order: "leftToRight", name: "내 그림", minPartRatio: 0.15, maxParts: MAX_PARTS, maxVertices: 28 });
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
