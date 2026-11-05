"use client";
// 부스 체험: 지도에서 코스를 뽑고, 가상으로 완주한 뒤, 체험용 대결과 경주를 한다.
// 기록은 이 기기에만 두고 실제 달리기 기록·서버 검증과 섞지 않는다.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { simulateDerby } from "@/lib/battle/derby";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { groupLines, type ShapeDef, type ShapeGroup } from "@/lib/route/shapes";
import { DuelArena } from "@/components/battle/DuelArena";
import { DerbyGame } from "@/components/derby/DerbyGame";
import { drawing, extract, extractOutline, nodes, shapes, streets, type Course, type Shape } from "./course";
import { findBoothCourse, presetShape } from "./engine";
import "./booth.css";

type Card = { id: string; shape: string; center: number[]; path: number[]; distance: number; number: number; prompt?: string };
type Game = "duel" | "practice" | "race";
const HISTORY_KEY = "yorun.booth.v1";
const ACTIVE_KEY = "yorun.booth.active";
const CUSTOM = "내 그림";

function valid(c: Card) {
  return c && typeof c.id === "string" && typeof c.shape === "string" && c.shape.length <= 20 && Array.isArray(c.path) && c.path.length > 1 && c.path.every((n) => Number.isInteger(n) && nodes[n]) && Number.isFinite(c.distance) && Number.isInteger(c.number);
}
function history(): Card[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(valid).slice(-40) : [];
  } catch {
    return [];
  }
}
function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(ACTIVE_KEY, id);
    else sessionStorage.removeItem(ACTIVE_KEY);
  } catch { /* 저장을 못 해도 체험은 이어진다 */ }
}
const title = (c: Card) => `${c.number}번 러너의 ${c.shape}`;
const zone = (n: number) => Math.round(Math.max(-490, Math.min(490, n)));

function viewBox(path: number[]) {
  const xs = path.map((i) => nodes[i][0]), ys = path.map((i) => nodes[i][1]);
  const left = Math.min(...xs), top = Math.min(...ys);
  return `${left - 60} ${top - 60} ${Math.max(...xs) - left + 120} ${Math.max(...ys) - top + 120}`;
}

export default function Booth() {
  const [cards, saveCards] = useState<Card[]>([]);
  const [card, showCard] = useState<Card | null>(null);
  const [shape, choose] = useState<string>(shapes[0]);
  const [center, place] = useState([0, 0]);
  const [course, setCourse] = useState<Course | null>(null);
  const [phase, setPhase] = useState<"map" | "run" | "done">("map");
  const [fraction, move] = useState(0);
  const [warning, warn] = useState("");
  const [game, setGame] = useState<Game | null>(null);
  const [result, showResult] = useState("");
  const [runner, setRunner] = useState<number[] | null>(null);
  const [prompt, setPrompt] = useState("");
  const [outline, setOutline] = useState<{ line: [number, number][]; shape: ShapeDef } | null>(null);
  const [searching, setSearching] = useState(false);
  const [drawingBusy, setDrawingBusy] = useState(false);
  const routeEl = useRef<SVGPathElement>(null);
  const map = useRef<SVGSVGElement>(null);
  const pendingOutline = useRef<AbortController | null>(null);

  useEffect(() => {
    const saved = history();
    let active: string | null = null;
    try { active = sessionStorage.getItem(ACTIVE_KEY); } catch { /* 없으면 처음부터 */ }
    const restored = saved.find((c) => c.id === active);
    /* eslint-disable react-hooks/set-state-in-effect -- 기기 저장소는 브라우저에서만 읽는다. Google 로그인에서 돌아오면 보던 카드를 이어 준다 */
    saveCards(saved);
    if (restored) {
      showCard(restored);
      setPhase("done");
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    return () => pendingOutline.current?.abort();
  }, []);

  function reset() {
    setPhase("map");
    showCard(null);
    setCourse(null);
    setGame(null);
    showResult("");
    move(0);
    setRunner(null);
    warn("");
    remember(null);
    // 공용 기기에서 다음 참가자가 앞사람 이름으로 참가하지 않게 한다. 게스트 기록은 만료 시 서버에서 지워진다.
    void browserSupabase()?.auth.signOut({ scope: "local" }).catch(() => undefined);
  }
  function relocate(p: number[]) {
    place(p.map(zone));
    setCourse(null);
    warn("");
  }
  function extractCourse() {
    if (searching) return;
    if (shape === CUSTOM && !outline) return warn("먼저 윤곽을 만들어 주세요.");
    setSearching(true);
    warn("");
    // 계산으로 화면이 멈추기 전에 "찾는 중"을 먼저 그린다
    setTimeout(() => {
      try {
        const target = shape === CUSTOM ? outline!.shape : presetShape(shape as Shape);
        const found = target ? findBoothCourse(target, center) : null;
        setCourse(found ?? (shape === CUSTOM ? extractOutline(outline!.line, center) : extract(shape as Shape, center)));
      } catch {
        warn("다른 중심을 골라 주세요.");
      } finally {
        setSearching(false);
      }
    }, 30);
  }
  async function makeOutline() {
    pendingOutline.current?.abort();
    const controller = new AbortController();
    pendingOutline.current = controller;
    setDrawingBusy(true);
    setOutline(null);
    setCourse(null);
    warn("");
    try {
      const response = await fetch("/api/recognition/outline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }), signal: controller.signal });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? "윤곽을 만들지 못했어요. 준비된 모양을 골라 주세요.");
      const group = data.group as ShapeGroup;
      const line = groupLines(group)[0];
      if (!line) throw new Error("윤곽을 만들지 못했어요. 준비된 모양을 골라 주세요.");
      if (!controller.signal.aborted) setOutline({ line, shape: group.parts[0].shape });
    } catch (error) {
      if (!controller.signal.aborted) warn(error instanceof Error ? error.message : "윤곽을 만들지 못했어요.");
    } finally {
      if (!controller.signal.aborted) setDrawingBusy(false);
    }
  }

  function finish() {
    if (!course) return;
    const previous = history();
    const number = Math.max(0, ...cards.map((c) => c.number), ...previous.map((c) => c.number)) + 1;
    const record: Card = { id: crypto.randomUUID(), number, shape, center, path: course.path, distance: course.distance, ...(shape === CUSTOM ? { prompt: prompt.slice(0, 40) } : {}) };
    const next = [...(previous.length ? previous : cards), record].slice(-40);
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
    } catch {
      warn("기기 저장 공간이 부족해 이번 화면에서만 기록을 유지해요.");
    }
    remember(record.id);
    saveCards(next);
    showCard(record);
    setPhase("done");
    move(1);
  }
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  });
  useEffect(() => {
    if (phase !== "run") return;
    const start = performance.now();
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1000 : 5200;
    let frame = 0;
    function tick(now: number) {
      const progress = Math.min(1, (now - start) / duration);
      move(progress);
      const path = routeEl.current;
      if (path) {
        const point = path.getPointAtLength(progress * path.getTotalLength());
        setRunner([point.x, point.y]);
      }
      if (progress === 1) finishRef.current();
      else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [phase]);

  const route = phase === "done" ? card?.path : course?.path;
  const d = useMemo(() => (route ? drawing(route) : ""), [route]);
  const peers = cards.filter((c) => c.id !== card?.id).slice(-10).reverse();

  function play() {
    if (!card) return;
    const field = Array.from({ length: 8 }, (_, i) => {
      const c = i === 0 ? card : peers[i - 1];
      const identity = c?.id ?? `practice-${i}`;
      const variant = Array.from(identity).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
      return { id: identity, name: c ? title(c) : `연습 러너 ${i}`, stats: { avgPaceSecPerKm: 320 + (variant % 75), cornering: 0.69 + (variant % 24) / 100, corners: [], paceSplits: [] } };
    });
    const derby = simulateDerby(field, `${card.id}:${game}`);
    showResult(derby.entries.map((r) => `${r.rank}위  ${field.find((f) => f.id === r.id)!.name}${r.id === card.id ? "  · 나" : ""}`).join("\n"));
  }

  return (
    <main className="booth">
      <header><strong>요런</strong><span>드로잉런 체험 부스</span><Link href="/hub">앱으로</Link></header>
      <h1>{phase === "done" ? "내가 고른 길이 작품이 됐어요" : phase === "run" ? "지금, 이 길을 달리는 중" : "어떤 그림을 달려 볼까요?"}</h1>
      <p>{phase === "map" ? "모양을 고르고 지도에서 중심을 눌러 보세요. 주변 도로를 이어 코스를 찾아요." : phase === "run" ? "작은 점이 내가 선택한 도로를 따라 달려요." : card && `${title(card)} · ${(card.distance / 1000).toFixed(2)} km · 부스 체험 기록`}</p>

      {phase === "map" && (
        <div className="booth-choices">
          {[...shapes, CUSTOM].map((s) => (
            <button key={s} type="button" className="booth-choice" aria-pressed={shape === s} onClick={() => { choose(s); setCourse(null); warn(""); }}>{s === CUSTOM ? "설명으로 만들기" : s}</button>
          ))}
        </div>
      )}
      {phase === "map" && shape === CUSTOM && (
        <section className="booth-card">
          <label className="booth-field">어떤 모습으로 달릴까요?
            <input value={prompt} maxLength={300} placeholder="예: 귀 한쪽이 접힌 토끼의 옆모습" onChange={(e) => { pendingOutline.current?.abort(); setDrawingBusy(false); setPrompt(e.target.value); setOutline(null); setCourse(null); }} />
          </label>
          <p className="hint">설명은 윤곽을 만들고 안전 검사를 하기 위해 OpenAI로 전송돼요. 이름이나 연락처 같은 개인정보는 빼 주세요.</p>
          <button type="button" className="btn btn-secondary wide" disabled={!prompt.trim() || drawingBusy} aria-busy={drawingBusy} onClick={() => void makeOutline()}>{drawingBusy ? "윤곽 만드는 중" : outline ? "다시 만들기" : "윤곽 만들기"}</button>
          {outline && <p role="status">윤곽이 준비됐어요. 지도에서 중심을 고른 뒤 경로를 추출해 보세요.</p>}
        </section>
      )}

      <div className="booth-map">
        <svg ref={map} viewBox="-1100 -1100 2200 2200" role="img" aria-label="서울 강남 실제 도로망과 체험 경로" onClick={(e) => {
          if (phase !== "map" || !map.current) return;
          const matrix = map.current.getScreenCTM();
          if (!matrix) return;
          const point = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse());
          relocate([point.x, point.y]);
        }}>
          <path d={streets} className="booth-road" />
          {d && (
            <>
              <path d={d} className="booth-route-edge" />
              <path ref={routeEl} d={d} className={phase === "run" ? "booth-route booth-route-pending" : "booth-route"} />
              {phase === "run" && <path d={d} pathLength={1} strokeDasharray={`${fraction} 1`} className="booth-route-run" />}
            </>
          )}
          {phase === "map" && !course && <circle cx={center[0]} cy={center[1]} r="25" className="booth-pin" />}
          {phase === "run" && runner && <circle cx={runner[0]} cy={runner[1]} r="28" className="booth-runner" />}
        </svg>
        <small>서울 강남 · © OpenStreetMap contributors</small>
      </div>

      {phase === "map" && (
        <>
          <div className="booth-choices">
            {([["서쪽", -320], ["중앙", 0], ["동쪽", 320]] as const).map(([name, x]) => (
              <button key={name} type="button" className="booth-choice" onClick={() => relocate([x, 0])}>{name}</button>
            ))}
          </div>
          <div className="booth-actions">
            <button type="button" className="btn btn-primary wide" disabled={searching} aria-busy={searching} onClick={extractCourse}>{searching ? "도로에서 코스를 찾는 중" : "이곳에서 경로 추출"}</button>
            {course && <button type="button" className="btn btn-primary wide" onClick={() => setPhase("run")}>{(course.distance / 1000).toFixed(2)} km · 가상 달리기 시작</button>}
          </div>
        </>
      )}
      {phase === "run" && <p role="status">가상 완주 {Math.round(100 * fraction)}%</p>}

      {phase === "done" && card && (
        <>
          <div className="booth-choices">
            <button type="button" className="booth-choice" aria-pressed={game === "race"} onClick={() => { setGame("race"); showResult(""); }}>8인 경기</button>
            <button type="button" className="booth-choice" aria-pressed={game === "duel"} onClick={() => { setGame("duel"); showResult(""); }}>1대1 대결</button>
            <button type="button" className="booth-choice" aria-pressed={game === "practice"} onClick={() => { setGame("practice"); showResult(""); }}>혼자 연습 경주</button>
          </div>
          {game === "race" && <DerbyGame key={card.id} returnTo="/booth" />}
          {game === "duel" && <section className="booth-card"><DuelArena key={card.id} returnTo="/booth" /></section>}
          {game === "practice" && (
            <section className="booth-card">
              <h2>여덟 레인에서 경주하기</h2>
              <p>이 기기의 이전 기록으로 편성하고 빈 레인은 연습 러너로 채워요. 능력치는 체험용이에요.</p>
              <button type="button" className="btn btn-primary wide" onClick={play}>경주 결과 보기</button>
              {result && <pre role="status">{result}</pre>}
            </section>
          )}
          <div className="booth-actions"><button type="button" className="btn btn-secondary wide" onClick={reset}>다음 참가자 시작</button></div>
        </>
      )}

      {warning && <p role="alert">{warning}</p>}
      {phase !== "run" && cards.length > 0 && (
        <details className="booth-card">
          <summary>이 기기의 체험 작품방 · {cards.length}개</summary>
          <div className="booth-gallery">
            {cards.slice().reverse().map((c) => (
              <button key={c.id} type="button" className="booth-choice" onClick={() => { showCard(c); remember(c.id); setPhase("done"); setGame(null); showResult(""); warn(""); }}>
                <svg viewBox={viewBox(c.path)} aria-hidden="true"><path d={drawing(c.path)} /></svg>
                {title(c)}
              </button>
            ))}
          </div>
        </details>
      )}
      <footer>가상 완주 기록은 이 브라우저의 체험 작품방에 최근 40개까지 보관해요. 실제 GPS 기록과 공식 순위는 별도로 관리해요.</footer>
    </main>
  );
}
