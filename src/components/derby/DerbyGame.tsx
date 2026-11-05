"use client";
// 8인 경기 전체 흐름: 캐릭터 선택 → 10초 매칭 → 봇 입장 → 3D 중계 → 결과.

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { AuthForm } from "@/components/AuthForm";
import { watchBattleDraft, type BattleDraft } from "@/lib/battle/battleDraft";
import { boothRaceResult, boothStats, countdownSeconds, nextDeadline, raceProgress, type BoothRaceReplay, type BoothStyle } from "@/lib/battle/boothRace";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { CharacterFace, Gauge } from "./CharacterParts";
import { bodyLabel, loadCharacters, type DerbyCharacter } from "./characters";
import type { CameraMode } from "./StadiumMap";
import "./derby.css";

const StadiumMap = dynamic(() => import("./StadiumMap").then((module) => module.StadiumMap), { ssr: false, loading: () => <div className="derby-canvas derby-canvas-empty" role="status">경기장을 여는 중이에요.</div> });

type Player = { lane: number; name: string; mine: boolean };
type RoomState = { race: string; closed: boolean; secondsLeft: number; msLeft: number; players: Player[]; result: BoothRaceReplay | null };
type Phase = "select" | "matching" | "arrival" | "loading" | "starting" | "race" | "result";

const PLAY_SPEED = 16;
const BOT_ARRIVAL_MS = 450;
const LOADING_MS = 1800;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "경기 서버에 연결하지 못했어요.");
  return data as T;
}

/** 서버 없이도 끝까지 해 볼 수 있는 연습 경기. 기록에 남지 않는다 */
function practiceRoom(character: DerbyCharacter): RoomState {
  const race = `practice-${Date.now()}`;
  const style: BoothStyle = "style" in character.entry ? character.entry.style : "balance";
  const seat = { lane: 1, name: "나", stats: boothStats(style, Math.random), mine: true, body: character.body };
  return { race, closed: true, secondsLeft: 0, msLeft: 0, players: [{ lane: 1, name: "나", mine: true }], result: boothRaceResult(race, [seat]) };
}

export function DerbyGame({ returnTo = "/derby" }: { returnTo?: string }) {
  const supabase = browserSupabase();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(supabase ? undefined : false);
  const [guest, setGuest] = useState(false);
  const [draft, setDraft] = useState<BattleDraft | null>(null);
  const [characters, setCharacters] = useState<DerbyCharacter[]>([]);
  const [selected, select] = useState("");
  const [consent, agree] = useState(false);
  const [phase, setPhase] = useState<Phase>("select");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [arrived, setArrived] = useState(0);
  const [count, setCount] = useState(3);
  const [clock, setClock] = useState(0);
  const [camera, setCamera] = useState<CameraMode>("director");
  const [left, setLeft] = useState(10);
  const deadline = useRef<number | null>(null);

  useEffect(() => watchBattleDraft(setDraft), []);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => {
      setSignedIn(!!data.user);
      setGuest(!!data.user?.is_anonymous);
    });
  }, [supabase, signedIn]);
  useEffect(() => {
    const list = loadCharacters(draft, guest);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 기록은 이 기기 저장소에서만 읽는다
    setCharacters(list);
    select((current) => (list.some((c) => c.id === current) ? current : list.find((c) => !c.blocked)?.id ?? ""));
  }, [draft, guest]);

  const character = characters.find((c) => c.id === selected);
  const needsConsent = character?.kind === "verified";
  const result = room?.result ?? null;
  const roster = useMemo<Player[]>(() => {
    if (!result) return room?.players ?? [];
    return [...result.placings].map((p) => ({ lane: p.lane, name: p.name, mine: p.mine })).sort((a, b) => a.lane - b.lane);
  }, [result, room]);
  const humans = room?.players.length ?? 0;
  const raceEnd = result ? Math.max(...result.placings.map((p) => p.seconds)) : 0;

  async function enter() {
    if (!character || busy || character.blocked) return;
    if (!signedIn) {
      setNeedLogin(true);
      return;
    }
    if (needsConsent && !consent) return setMessage("기록을 쓰려면 동의가 필요해요.");
    setBusy(true);
    setMessage("");
    try {
      const { race } = await request<{ race: string }>("/api/booth/race", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...character.entry, body: character.body }) });
      const entered = await request<RoomState>(`/api/booth/race?race=${race}`);
      deadline.current = nextDeadline(null, Date.now(), entered.msLeft);
      setLeft(countdownSeconds(deadline.current, Date.now()));
      setRoom(entered);
      setPhase("matching");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "매칭을 시작하지 못했어요.");
    }
    setBusy(false);
  }
  function startPractice() {
    if (!character) return;
    setMessage("");
    setRoom(practiceRoom(character));
    setPhase("matching");
  }
  function leave() {
    setRoom(null);
    setClock(0);
    setArrived(0);
    setCount(3);
    deadline.current = null;
    setCamera("director");
    setMessage("");
    setPhase("select");
  }

  // 매칭 대기: 2초마다 서버에 묻고, 마감되면 봇 입장으로 넘어간다
  const raceId = room?.race;
  const closed = room?.closed;
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (phase !== "matching" || !raceId) return;
    if (closed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 서버가 마감을 알리면 다음 단계로 넘어간다
      setPhase("arrival");
      return;
    }
    // 숫자는 마감 시각으로 자주 계산하고, 서버 확인은 2초마다, 시간이 다 되면 마감될 때까지 자주 한다
    let lastPoll = Date.now(), waiting = false;
    const tick = setInterval(() => {
      const now = Date.now();
      const seconds = countdownSeconds(deadline.current ?? now, now);
      setLeft(seconds);
      if (waiting || now - lastPoll < (seconds > 0 ? 2000 : 500)) return;
      lastPoll = now;
      waiting = true;
      void request<RoomState>(`/api/booth/race?race=${raceId}`)
        .then((next) => {
          deadline.current = nextDeadline(deadline.current, Date.now(), next.msLeft);
          setRoom(next);
        })
        .catch((error: Error) => setMessage(error.message))
        .finally(() => { waiting = false; });
    }, 200);
    return () => clearInterval(tick);
  }, [phase, raceId, closed]);

  // 봇이 차례대로 입장한다
  useEffect(() => {
    if (phase !== "arrival") return;
    const bots = roster.length - humans;
    if (arrived >= bots) {
      const done = setTimeout(() => setPhase("loading"), 500);
      return () => clearTimeout(done);
    }
    const next = setTimeout(() => setArrived((n) => n + 1), BOT_ARRIVAL_MS);
    return () => clearTimeout(next);
  }, [phase, arrived, roster.length, humans]);

  // 로딩 바가 다 차면 경기장으로 들어간다
  useEffect(() => {
    if (phase !== "loading") return;
    const done = setTimeout(() => {
      setCount(3);
      setPhase("starting");
    }, LOADING_MS);
    return () => clearTimeout(done);
  }, [phase]);
  // 출발선에 선 채로 3, 2, 1, 출발
  useEffect(() => {
    if (phase !== "starting") return;
    countdownTimer.current = setInterval(() => setCount((n) => n - 1), 1000);
    return () => { if (countdownTimer.current) clearInterval(countdownTimer.current); };
  }, [phase]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 카운트가 끝나면 출발한다
    if (phase === "starting" && count <= 0) setPhase("race");
  }, [phase, count]);

  useEffect(() => {
    if (phase !== "race" || !raceEnd) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    const base = clock;
    let frame = 0;
    const step = (now: number) => {
      const next = Math.min(raceEnd, base + ((now - started) / 1000) * (reduced ? PLAY_SPEED * 3 : PLAY_SPEED));
      setClock(next);
      if (next >= raceEnd) setPhase("result");
      else frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
    // clock은 출발 시점의 값만 쓴다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, raceEnd]);

  const standing = useMemo(() => {
    if (!result) return [];
    return result.placings
      .map((p) => ({ ...p, progress: raceProgress(p.splits, clock) }))
      // 출발 전에는 레인 순서로 둔다. 결과 순서로 두면 최종 순위가 미리 드러난다
      .sort((a, b) => b.progress - a.progress || (clock > 0 ? a.rank - b.rank : a.lane - b.lane));
  }, [result, clock]);
  const mine = standing.find((p) => p.mine);
  const myRank = mine ? standing.indexOf(mine) + 1 : null;
  const myLine = character?.line ?? null;
  const runners = useMemo(() => standing.map((p) => ({ lane: p.lane, progress: p.progress, mine: p.mine, body: p.body, line: p.mine ? myLine : null })), [standing, myLine]);

  const leadSection = standing[0] ? Math.min(11, Math.floor(standing[0].progress)) : 0;
  const callout = (() => {
    if (!result || !standing[0]) return "";
    if (phase === "starting") return "출발선에 모두 섰어요";
    if (standing[0].progress >= 11) return "마지막 100m!";
    const spurt = result.spurts.find((s) => s.section === leadSection);
    if (spurt) return `${result.placings.find((p) => p.lane === spurt.lane)?.name}의 코너 스퍼트!`;
    return `${standing[0].name} 선두, ${result.sections[leadSection] === "corner" ? "코너 구간" : "직선 구간"}`;
  })();

  if (signedIn === undefined) return <p role="status" className="derby-note">참가 상태를 확인하고 있어요.</p>;

  if (phase === "select") {
    return (
      <div className="derby-screen">
        <h2 className="derby-title">출전할 캐릭터를 고르세요</h2>
        <div className="derby-roster" role="radiogroup" aria-label="출전 캐릭터">
          {characters.map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={c.id === selected} className="derby-card" disabled={!!c.blocked} onClick={() => { select(c.id); setMessage(""); }}>
              <CharacterFace character={c} size={72} />
              <strong>{c.name}</strong>
              <small>{c.blocked ?? c.note}</small>
              {!c.blocked && <em className="derby-body">{bodyLabel(c.body)}</em>}
              <Gauge label="직선" value={c.straight} />
              <Gauge label="코너" value={c.corner} />
            </button>
          ))}
        </div>
        {needsConsent && (
          <label className="consent derby-consent">
            <input type="checkbox" checked={consent} onChange={(e) => agree(e.target.checked)} />
            <span>위치를 뺀 코스와 달린 선을 검증에 쓰고, 경기 능력치를 저장하는 데 동의해요.</span>
          </label>
        )}
        {message && <p className="derby-error" role="alert">{message}</p>}
        {needLogin && supabase ? (
          <section className="derby-login">
            <p>경기에 표시할 이름이 필요해요.</p>
            <AuthForm supabase={supabase} prepareNext={async () => returnTo} onNavigate={() => { setSignedIn(true); setNeedLogin(false); }} />
          </section>
        ) : (
          <button type="button" className="derby-start" disabled={!character || !!character.blocked || busy || (needsConsent && !consent)} aria-busy={busy} onClick={() => void (supabase ? enter() : startPractice())}>
            {busy ? "매칭 준비 중" : supabase ? "매칭 시작" : "봇과 연습 경기"}
          </button>
        )}
        {supabase && <button type="button" className="derby-quiet" disabled={!character} onClick={startPractice}>기록 없이 봇과 연습하기</button>}
      </div>
    );
  }

  if (phase === "matching" || phase === "arrival" || phase === "loading") {
    const shownBots = phase === "loading" ? roster.length : humans + arrived;
    const humansFirst = [...roster].sort((a, b) => {
      const isHuman = (p: Player) => (room?.players.some((h) => h.lane === p.lane) ? 0 : 1);
      return isHuman(a) - isHuman(b) || a.lane - b.lane;
    });
    const seats = Array.from({ length: 8 }, (_, i) => (i < shownBots ? humansFirst[i] : undefined));
    return (
      <div className="derby-screen">
        <div className="derby-versus">
          {phase === "loading" ? (
            <div className="derby-loading">
              <p className="derby-status" role="status">경기장으로 들어가는 중이에요</p>
              <div className="derby-loading-bar" role="progressbar" aria-label="경기장 입장"><i /></div>
            </div>
          ) : phase === "arrival" ? (
            <p className="derby-status" role="status">봇이 빈 자리에 들어오고 있어요</p>
          ) : (
            <>
              <p className="derby-count" role="timer" aria-label={`${left}초 남음`}>{left}</p>
              <p className="derby-status" role="status">다른 러너를 찾고 있어요</p>
            </>
          )}
        </div>
        <ol className="derby-seats">
          {seats.map((seat, i) => (
            <li key={seat?.lane ?? `empty-${i}`} className={seat ? "derby-seat derby-seat-in" : "derby-seat"} data-mine={seat?.mine || undefined}>
              {seat ? <><b>{seat.lane}</b><span>{seat.name}</span></> : <span className="derby-seat-wait">빈 자리</span>}
            </li>
          ))}
        </ol>
        {message && <p className="derby-error" role="alert">{message}</p>}
      </div>
    );
  }

  if ((phase === "race" || phase === "starting") && result) {
    return (
      <div className="derby-screen derby-live">
        <div className="derby-hud">
          <div className="derby-hud-rank"><span>내 순위</span><strong>{clock > 0 ? myRank : "-"}</strong></div>
          <p className="derby-callout" aria-live="off">{callout}</p>
          <div className="derby-hud-dist"><span>남은 거리</span><strong>{Math.max(0, Math.round((12 - (mine?.progress ?? 0)) * 100))}m</strong></div>
        </div>
        <div className="derby-stage">
          <StadiumMap runners={runners} camera={camera} />
          {phase === "starting" && <p className="derby-go" key={count} role="status">{count}</p>}
          {phase === "race" && clock < 8 && <p className="derby-go derby-go-out" aria-hidden="true">출발!</p>}
        </div>
        <ol className="derby-board" aria-label="현재 순위">
          {standing.map((p, i) => (
            <li key={p.lane} data-mine={p.mine || undefined}>
              <b>{i + 1}</b><span>{p.name}</span>
              <div className="derby-gauge-bar"><i style={{ transform: `scaleX(${Math.max(0.02, p.progress / 12)})` }} /></div>
            </li>
          ))}
        </ol>
        <div className="derby-controls">
          <button type="button" className="derby-quiet" aria-pressed={camera === "mine"} onClick={() => setCamera(camera === "mine" ? "director" : "mine")}>{camera === "mine" ? "자동 중계로" : "내 선수 따라가기"}</button>
          <button type="button" className="derby-quiet" onClick={() => { setClock(raceEnd); setPhase("result"); }}>결과 바로 보기</button>
        </div>
      </div>
    );
  }

  if (phase === "result" && result) {
    const placings = result.placings;
    const myPlacing = placings.find((p) => p.mine);
    return (
      <div className="derby-screen">
        <div className="derby-versus derby-final">
          <p className="derby-status">최종 순위</p>
          <p className="derby-count derby-rank" role="status">{myPlacing?.rank}<small>위</small></p>
          <p className="derby-status">{myPlacing?.seconds.toFixed(1)}초에 1.2km 완주</p>
        </div>
        <ol className="derby-podium" aria-label="1위부터 3위">
          {[placings[1], placings[0], placings[2]].map((p) => (
            <li key={p.lane} data-place={p.rank} data-mine={p.mine || undefined}><span>{p.name}</span><b>{p.rank}</b></li>
          ))}
        </ol>
        <ol className="derby-results">
          {placings.map((p) => (
            <li key={p.lane} data-mine={p.mine || undefined}><b>{p.rank}</b><span>{p.name}</span><small>{p.seconds.toFixed(1)}초</small></li>
          ))}
        </ol>
        <p className="derby-note">기록과 별개인 체험 경기예요. 빈 자리의 봇은 사람이 아니에요.</p>
        <button type="button" className="derby-start" onClick={leave}>다시 경기하기</button>
        <button type="button" className="derby-quiet" onClick={() => { setClock(0); setCount(3); setPhase("starting"); }}>경기 다시 보기</button>
      </div>
    );
  }
  return null;
}
