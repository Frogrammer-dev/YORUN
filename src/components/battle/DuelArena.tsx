"use client";
// 1대1 턴 대결 화면. 상대 고르기 → 매 턴 직접 선택 → 결과. 판정은 서버가 한다.

import { useCallback, useEffect, useState } from "react";
import { AuthForm } from "@/components/AuthForm";
import { PathThumb } from "@/components/Icon";
import { BATTLE_CHOICES, BATTLE_RULES, CHOICE_LABELS, criticalDamage, type BattleChoice, type BattleSheet, type BattleState, type TurnLog } from "@/lib/battle/turnBattle";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { SHAPES } from "@/lib/route/shapes";

type Opponent = { id: string; name: string; bot: boolean; sheet: BattleSheet };
type Lobby = { me: { name: string; registered: boolean; sheet: BattleSheet }; opponents: Opponent[]; history: { id: string; opponent: string; winner: BattleState["winner"]; turns: number }[] };
type Battle = { id: string; opponent: string; state: BattleState; log: TurnLog | null };

const resultLabel = (winner: BattleState["winner"]) => (winner === 0 ? "승리" : winner === 1 ? "패배" : "무승부");

async function request<T>(init?: { body: unknown }): Promise<T> {
  const response = await fetch("/api/duel/battle", init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "대결 서버에 연결하지 못했어요.");
  return data as T;
}

function describe(log: TurnLog, foe: string): string {
  const [mine, theirs] = log.choices;
  const shown = `나 ${CHOICE_LABELS[mine]}, ${foe} ${CHOICE_LABELS[theirs]}. `;
  if (log.critical[0] && log.critical[1]) return shown + "둘 다 이판사판 성공! 서로 피해가 없어요.";
  if (log.critical[0] && log.damage[1]) return shown + `이판사판 성공! 치명타 ${log.damage[1]} 피해!`;
  if (log.critical[1] && log.damage[0]) return shown + `상대 이판사판 성공! 치명타 ${log.damage[0]} 피해를 받았어요.`;
  if (log.missed[0] && log.damage[0]) return shown + `이판사판 실패! ${log.damage[0]} 피해를 받았어요.`;
  if (log.missed[1] && log.damage[1]) return shown + `상대 이판사판 실패! ${log.damage[1]} 피해를 입혔어요.`;
  if (log.damage[1]) return shown + `이겼어요! ${log.damage[1]} 피해를 입혔어요.`;
  if (log.damage[0]) return shown + `졌어요. ${log.damage[0]} 피해를 받았어요.`;
  return shown + "아무 일도 일어나지 않았어요.";
}

function Hud({ name, hp, maxHp, side }: { name: string; hp: number; maxHp: number; side: "me" | "foe" }) {
  return (
    <div className={`duel-hud duel-hud-${side}`}>
      <strong>{name}</strong>
      <div><span>HP</span><progress aria-label={`${name} 체력`} max={maxHp} value={hp} /></div>
      <small>{hp} / {maxHp}</small>
    </div>
  );
}

/** 코스 그림이 캐릭터가 된다. 상대는 이름으로 모양을 고르므로 같은 상대는 늘 같은 모양이다 */
const FOE_SHAPES = ["airplane", "whale", "rocket", "turtle", "elephant", "rabbit", "butterfly", "car"];
function foeShape(name: string) {
  const hash = Array.from(name).reduce((n, ch) => (n * 31 + ch.charCodeAt(0)) >>> 0, 7);
  return SHAPES.find((shape) => shape.id === FOE_SHAPES[hash % FOE_SHAPES.length]) ?? SHAPES[0];
}
const MY_SHAPE = SHAPES.find((shape) => shape.id === "dog") ?? SHAPES[0];

export function DuelArena({ returnTo }: { returnTo: string }) {
  const supabase = browserSupabase();
  const [signedIn, setSignedIn] = useState<boolean | undefined>(supabase ? undefined : false);
  const [lobby, setLobby] = useState<Lobby | null>(null);
  const [battle, setBattle] = useState<Battle | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      setLobby(await request<Lobby>());
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "대결 정보를 불러오지 못했어요.");
    }
  }, []);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getUser().then(({ data }) => setSignedIn(!!data.user));
  }, [supabase]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그인을 확인한 뒤 서버에서 받아 온 값을 반영한다
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  async function act(body: unknown) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      setBattle(await request<Battle>({ body }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했어요.");
    }
    setBusy(false);
  }

  if (!supabase) return <p role="status">이 실행 환경에서는 대결 서버를 쓸 수 없어요.</p>;
  if (signedIn === undefined) return <p role="status">참가 상태를 확인하고 있어요.</p>;
  if (!signedIn) {
    return (
      <>
        <p>대결에 표시할 이름이 필요해요. 게스트로 바로 참여할 수 있어요.</p>
        <AuthForm supabase={supabase} prepareNext={async () => returnTo} onNavigate={() => setSignedIn(true)} />
      </>
    );
  }

  if (battle && lobby) {
    const { state, log } = battle;
    const over = state.winner !== null;
    return (
      <div className="duel-arena">
        <div className="duel-arena-field">
          <div className="duel-platform duel-platform-foe" />
          <div className="duel-platform duel-platform-me" />
          <Hud name={battle.opponent} hp={state.hp[1]} maxHp={state.sheets[1].maxHp} side="foe" />
          <div key={`foe-${state.turn}`} className={`duel-route duel-route-foe${log?.damage[0] ? " duel-route-move" : ""}`} aria-hidden="true">
            <PathThumb lines={[foeShape(battle.opponent).points]} size={120} width={3.5} />
          </div>
          <div key={`me-${state.turn}`} className={`duel-route duel-route-me${log?.damage[1] ? " duel-route-move" : ""}`} aria-hidden="true">
            <PathThumb lines={[MY_SHAPE.points]} size={155} width={3.5} />
          </div>
          <Hud name={lobby.me.name} hp={state.hp[0]} maxHp={state.sheets[0].maxHp} side="me" />
        </div>
        <p className="duel-log" role="status">{log ? describe(log, battle.opponent) : `${battle.opponent}이(가) 나타났어요! 무엇을 낼까요?`}</p>
        {message && <p className="auth-error" role="alert">{message}</p>}
        {over ? (
          <>
            <h2 className="duel-result">{resultLabel(state.winner)}</h2>
            <button type="button" className="btn btn-primary wide" onClick={() => { setBattle(null); void refresh(); }}>다른 상대 고르기</button>
          </>
        ) : (
          <>
            <div className="duel-choices">
              {BATTLE_CHOICES.map((choice) => (
                <button key={choice} type="button" className={`duel-choice duel-choice-${choice}`} disabled={busy} onClick={() => void act({ action: "turn", id: battle.id, choice })}>
                  <strong>{CHOICE_LABELS[choice]}</strong>
                  {choice === "allin" && <small>성공 {Math.round(BATTLE_RULES.allinChance * 100)}%, 치명타 {criticalDamage(state, 0)}</small>}
                </button>
              ))}
            </div>
            <p className="hint">가위바위보를 이기면 공격해요. 이판사판은 30% 확률로 피해 없이 치명타를 넣고, 실패하면 공격을 맞아요. 뒤처질수록 치명타가 세져요.</p>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="duel-arena">
      {message && <p className="auth-error" role="alert">{message}</p>}
      {!lobby && !message && <p role="status">상대를 불러오고 있어요.</p>}
      {lobby && (
        <>
          <p>내 캐릭터 <strong>{lobby.me.name}</strong>{lobby.me.registered ? "" : " (체험 캐릭터)"}<br />체력 {lobby.me.sheet.maxHp}, 공격 {lobby.me.sheet.attack}</p>
          <h2>상대를 고르세요</h2>
          <ol className="battle-list">
            {lobby.opponents.map((opponent) => (
              <li key={opponent.id}>
                <span><strong>{opponent.name}</strong><br />체력 {opponent.sheet.maxHp}, 공격 {opponent.sheet.attack}</span>
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => void act({ action: "start", opponent: opponent.id })}>대결</button>
              </li>
            ))}
          </ol>
          <p className="hint">다른 사람의 대표 캐릭터를 골라도 상대의 선택은 인공지능이 대신해요.</p>
          {lobby.history.length > 0 && (
            <>
              <h2>최근 대결</h2>
              <ul className="battle-list">
                {lobby.history.map((item) => <li key={item.id}><strong>{item.opponent}</strong><span>{resultLabel(item.winner)}, {item.turns}턴</span></li>)}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
