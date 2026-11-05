"use client";
// 부스 전용 8인 실시간 매칭. 60초 동안 모인 참가자로 경주하고 빈 레인은 연습 러너가 채운다.

import { useEffect, useState } from "react";
import { AuthForm } from "@/components/AuthForm";
import { BOOTH_STYLES, type BoothPlacing, type BoothStyle } from "@/lib/battle/boothRace";
import { browserSupabase } from "@/lib/client/supabaseBrowser";

interface RaceState {
  race: string;
  closed: boolean;
  secondsLeft: number;
  players: { lane: number; name: string; mine: boolean }[];
  result: BoothPlacing[] | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "경주 서버에 연결하지 못했어요.");
  return data as T;
}

export function BoothRace() {
  const supabase = browserSupabase();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(supabase ? undefined : false);
  const [style, setStyle] = useState<BoothStyle>("balance");
  const [state, setState] = useState<RaceState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, [supabase]);

  const raceId = state?.race;
  const closed = state?.closed;
  useEffect(() => {
    if (!raceId || closed) return;
    const timer = setInterval(() => {
      void request<RaceState>(`/api/booth/race?race=${raceId}`).then(setState).catch((error: Error) => setMessage(error.message));
    }, 3000);
    return () => clearInterval(timer);
  }, [raceId, closed]);

  async function enter() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { race } = await request<{ race: string }>("/api/booth/race", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ style }) });
      setState(await request<RaceState>(`/api/booth/race?race=${race}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "참가하지 못했어요.");
    }
    setBusy(false);
  }

  if (!supabase) return <p role="status">이 실행 환경에서는 실시간 매칭을 쓸 수 없어요. 혼자 하는 연습 경주를 이용해 주세요.</p>;
  if (signedIn === undefined) return <p role="status">참가 상태를 확인하고 있어요.</p>;
  if (!signedIn) {
    return (
      <>
        <p>경주에 표시할 이름이 필요해요. 게스트로 바로 참여할 수 있어요.</p>
        <AuthForm supabase={supabase} prepareNext={async () => "/booth"} onNavigate={() => setSignedIn(true)} />
      </>
    );
  }

  if (state?.result) {
    return (
      <>
        <h2>경주 결과</h2>
        <ol className="booth-standing">
          {state.result.map((placing) => (
            <li key={placing.lane} data-mine={placing.mine}>
              <strong>{placing.rank}위</strong>
              <span>{placing.name}{placing.mine ? " · 나" : ""}</span>
              <span>{placing.seconds.toFixed(1)}초</span>
            </li>
          ))}
        </ol>
        <p>능력치는 체험용이고 실제 기록에 남지 않아요.</p>
        <button type="button" className="btn btn-secondary wide" onClick={() => setState(null)}>다시 참가하기</button>
      </>
    );
  }

  if (state) {
    return (
      <>
        <h2>함께 달릴 러너를 모으는 중</h2>
        <p role="status">{state.players.length}/8명 · {state.secondsLeft}초 뒤 출발. 빈 레인은 연습 러너가 채워요.</p>
        <ol className="booth-standing">
          {state.players.map((player) => (
            <li key={player.lane} data-mine={player.mine}>
              <strong>{player.lane}번</strong>
              <span>{player.name}{player.mine ? " · 나" : ""}</span>
            </li>
          ))}
        </ol>
        {message && <p role="alert">{message}</p>}
      </>
    );
  }

  return (
    <>
      <h2>어떤 유형으로 달릴까요?</h2>
      <div className="booth-choices">
        {(Object.keys(BOOTH_STYLES) as BoothStyle[]).map((id) => (
          <button key={id} type="button" className="booth-choice" aria-pressed={style === id} onClick={() => setStyle(id)}>{BOOTH_STYLES[id].label}</button>
        ))}
      </div>
      <p>{BOOTH_STYLES[style].hint} 세부 능력치는 참가할 때 정해져요.</p>
      {message && <p role="alert">{message}</p>}
      <button type="button" className="btn btn-primary wide" disabled={busy} aria-busy={busy} onClick={() => void enter()}>{busy ? "참가하는 중" : "경주 참가하기"}</button>
    </>
  );
}
