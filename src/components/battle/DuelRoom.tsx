"use client";
// 친구와 하는 1대1 대결 방 화면: 번호 공유하며 기다리기 → 매 턴 각자 고르기 → 결과.
// 판정은 서버가 하고, 화면은 대결 중 1초(기다릴 때 2초)마다 방 상태를 물어 상대의 참가·선택·나가기를 알아챈다.

import { useCallback, useEffect, useRef, useState } from "react";
import { BATTLE_CHOICES, BATTLE_RULES, CHOICE_LABELS, criticalDamage, type BattleChoice } from "@/lib/battle/turnBattle";
import type { RoomView } from "@/lib/battle/room";
import { SHAPES } from "@/lib/route/shapes";
import { BattleStage } from "./BattleStage";

/** 대결 중에는 1초, 상대가 들어오기를 기다릴 때는 2초마다 묻는다 */
const POLL_MS = 1000;
const WAIT_POLL_MS = 2000;
const FOE_SHAPES = ["airplane", "whale", "rocket", "turtle", "elephant", "rabbit", "butterfly", "car"];
function shapeFor(name: string) {
  const hash = Array.from(name).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return (SHAPES.find((s) => s.id === FOE_SHAPES[hash % FOE_SHAPES.length]) ?? SHAPES[0]).points;
}

export async function roomRequest(body?: unknown, id?: string): Promise<RoomView | null> {
  const url = "/api/duel/room" + (id ? `?id=${encodeURIComponent(id)}` : "");
  const response = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "대결 서버에 연결하지 못했어요.");
  return data as RoomView | null;
}

export const inviteLink = (code: string) => `${typeof location !== "undefined" ? location.origin : ""}/duel?room=${code}`;

export function DuelRoom({ initial, myLines, onExit, onNewRoom }: {
  initial: RoomView;
  /** 내 캐릭터 모양 (상대에게는 이름으로 정한 모양이 보인다) */
  myLines: [number, number][];
  onExit: () => void;
  onNewRoom: () => void;
}) {
  const [room, setRoom] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [settled, setSettled] = useState(false);
  const lastTurn = useRef(initial.turnNo);

  const apply = useCallback((next: RoomView | null) => {
    if (!next) return;
    // 새 턴 결과가 오면 연출이 끝날 때까지 다음 선택을 막는다
    if (next.turnNo !== lastTurn.current) {
      lastTurn.current = next.turnNo;
      setSettled(false);
    }
    setRoom(next);
  }, []);

  // 끝나기 전까지 상대의 참가·선택·나가기를 묻는다. 화면이 안 보일 때는 쉬고, 다시 보이면 바로 묻는다.
  // 앞 요청이 끝나기 전에는 다음 요청을 보내지 않는다.
  useEffect(() => {
    if (room.status === "finished" || room.expired) return;
    let stopped = false, inFlight = false;
    const tick = async () => {
      if (inFlight || document.visibilityState !== "visible") return;
      inFlight = true;
      try {
        const next = await roomRequest(undefined, room.id);
        if (!stopped) { apply(next); setMessage(""); }
      } catch (error) {
        if (!stopped) setMessage(error instanceof Error ? error.message : "방 상태를 받지 못했어요.");
      } finally { inFlight = false; }
    };
    const timer = setInterval(() => void tick(), room.status === "waiting" ? WAIT_POLL_MS : POLL_MS);
    const wake = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
    };
  }, [room.id, room.status, room.expired, apply]);

  async function act(body: unknown) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      apply(await roomRequest(body));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했어요.");
    }
    setBusy(false);
  }

  async function share() {
    const url = inviteLink(room.code);
    const text = `요런 1대1 대결 방 번호 ${room.code}`;
    try {
      if (navigator.share) await navigator.share({ title: "요런 1대1 대결", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        setCopied(true);
      }
    } catch {
      /* 공유를 닫으면 아무것도 하지 않는다 */
    }
  }

  if (room.status === "waiting") {
    return (
      <div className="derby-screen duel-room">
        <h2 className="derby-title">상대를 기다리고 있어요</h2>
        <p className="derby-note">방 번호를 알려 주세요. 상대가 이 번호로 들어오면 바로 시작해요.</p>
        <p className="duel-room-code" aria-label={`방 번호 ${room.code.split("").join(" ")}`}>{room.code}</p>
        {room.expired && <p className="derby-error" role="alert">방이 만료됐어요. 새 방을 만들어 주세요.</p>}
        {message && <p className="derby-error" role="alert">{message}</p>}
        <button type="button" className="derby-start" onClick={() => void share()}>번호 공유하기</button>
        {copied && <p className="derby-note" role="status">번호와 링크를 복사했어요.</p>}
        <button type="button" className="derby-quiet" disabled={busy} onClick={() => void act({ action: "leave", id: room.id }).then(onExit)}>방 닫기</button>
      </div>
    );
  }

  const state = room.state!;
  const finished = room.status === "finished" || state.winner !== null;
  const showResult = finished && (settled || room.foeLeft);
  const result = state.winner === 0 ? "승리" : state.winner === 1 ? "패배" : "무승부";
  const foeName = room.foe?.name ?? "상대";
  const waitingLine = room.myChoice
    ? `내 선택: ${CHOICE_LABELS[room.myChoice]} · ${foeName}의 선택을 기다리는 중`
    : room.foeChose ? `${foeName}이(가) 골랐어요. 내가 고르면 바로 판정해요.` : `${foeName}도 고르는 중이에요.`;

  return (
    <div className="duel-arena derby-screen duel-room">
      <BattleStage
        key={room.id}
        me={{ name: room.me.name, lines: myLines }}
        foe={{ name: foeName, lines: shapeFor(foeName) }}
        state={state}
        log={room.log}
        onSettled={() => setSettled(true)}
      />
      {message && <p className="derby-error" role="alert">{message}</p>}
      {showResult ? (
        <div className="bt-result" data-result={state.winner === 0 ? "win" : "lose"}>
          <h2>{result}</h2>
          {room.foeLeft && <p className="derby-note">{foeName}이(가) 대결을 나갔어요.</p>}
          <dl>
            <dt>남은 체력</dt><dd>{state.hp[0]} / {state.sheets[0].maxHp}</dd>
            <dt>상대 체력</dt><dd>{state.hp[1]} / {state.sheets[1].maxHp}</dd>
            <dt>턴</dt><dd>{state.turn}</dd>
          </dl>
          <button type="button" className="derby-start" onClick={onNewRoom}>새 방 만들기</button>
          <button type="button" className="derby-quiet" onClick={onExit}>대결 화면으로</button>
        </div>
      ) : (
        <>
          <p className="derby-note duel-room-wait" role="status">{room.expired ? "대결 시간이 지났어요." : waitingLine}</p>
          <div className="duel-choices">
            {BATTLE_CHOICES.map((choice: BattleChoice) => (
              <button key={choice} type="button" className={`duel-choice duel-choice-${choice}`} aria-pressed={room.myChoice === choice}
                disabled={busy || !settled || !!room.myChoice || room.expired || finished} onClick={() => void act({ action: "turn", id: room.id, choice })}>
                <strong>{CHOICE_LABELS[choice]}</strong>
                {choice === "allin" && <small>성공 {Math.round(BATTLE_RULES.allinChance * 100)}%, 치명타 {criticalDamage(state, 0)}</small>}
              </button>
            ))}
          </div>
          <button type="button" className="derby-quiet" disabled={busy} onClick={() => { if (confirm("나가면 이 대결은 진 것으로 끝나요. 나갈까요?")) void act({ action: "leave", id: room.id }); }}>
            대결 나가기
          </button>
        </>
      )}
    </div>
  );
}
