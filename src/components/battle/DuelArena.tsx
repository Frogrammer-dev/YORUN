"use client";
// 1대1 턴 대결 화면. 캐릭터 고르기 → 상대 고르기 → 매 턴 직접 선택 → 결과. 판정은 서버가 한다.

import { useCallback, useEffect, useState } from "react";
import { AuthForm } from "@/components/AuthForm";
import { CharacterFace, Gauge } from "@/components/derby/CharacterParts";
import { loadCharacters, type DerbyCharacter } from "@/components/derby/characters";
import "@/components/derby/derby.css";
import { PathThumb } from "@/components/Icon";
import { watchBattleDraft, type BattleDraft } from "@/lib/battle/battleDraft";
import type { DuelAction } from "@/lib/battle/duel";
import { BATTLE_CHOICES, BATTLE_RULES, CHOICE_LABELS, criticalDamage, type BattleSheet, type BattleState, type TurnLog } from "@/lib/battle/turnBattle";
import { BattleStage } from "./BattleStage";
import { browserSupabase } from "@/lib/client/supabaseBrowser";
import { SHAPES } from "@/lib/route/shapes";

type Opponent = { id: string; name: string; bot: boolean; sheet: BattleSheet };
type Lobby = { me: { name: string; registered: boolean; sheet: BattleSheet }; opponents: Opponent[]; history: { id: string; opponent: string; winner: BattleState["winner"]; turns: number }[] };
type Battle = { id: string; opponent: string; state: BattleState; log: TurnLog | null };

/** 등록 API가 받는 기존 필드. 새 대결은 매 턴 직접 고르므로 이 값을 쓰지 않는다 */
const UNUSED_PLAN: DuelAction[] = ["strike", "guard", "pierce", "strike", "guard"];
const hpGauge = (sheet: BattleSheet) => (sheet.maxHp - 80) / 30;
const attackGauge = (sheet: BattleSheet) => (sheet.attack - 15) / 7;

const resultLabel = (winner: BattleState["winner"]) => (winner === 0 ? "승리" : winner === 1 ? "패배" : "무승부");

async function request<T>(init?: { body: unknown }): Promise<T> {
  const response = await fetch("/api/duel/battle", init ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message ?? "대결 서버에 연결하지 못했어요.");
  return data as T;
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
  // 등장이나 턴 연출이 끝나면 다음 선택을 받는다
  const [settled, setSettled] = useState(false);
  const [foeUsed, setFoeUsed] = useState<Opponent | null>(null);
  const [view, setView] = useState<"pick" | "opponents">("pick");
  const [draft, setDraft] = useState<BattleDraft | null>(null);
  const [saved, setSaved] = useState<DerbyCharacter[]>([]);
  const [selected, select] = useState("");
  const [consent, agree] = useState(false);
  const [needLogin, setNeedLogin] = useState(false);
  const [guest, setGuest] = useState(false);

  useEffect(() => watchBattleDraft(setDraft), []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 기록은 이 기기 저장소에서만 읽는다
    setSaved(loadCharacters(draft, guest));
  }, [draft, guest]);

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
    void supabase.auth.getUser().then(({ data }) => {
      setSignedIn(!!data.user);
      setGuest(!!data.user?.is_anonymous);
    });
  }, [supabase, signedIn]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 로그인을 확인한 뒤 서버에서 받아 온 값을 반영한다
    if (signedIn) void refresh();
  }, [signedIn, refresh]);

  async function act(body: unknown) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      setSettled(false);
      setBattle(await request<Battle>({ body }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "요청을 처리하지 못했어요.");
    }
    setBusy(false);
  }

  // 이미 등록한 대표 캐릭터가 있으면 맨 앞에 둔다
  const characters: DerbyCharacter[] = lobby?.me.registered
    ? [{ id: "registered", kind: "verified", name: "내 대표 캐릭터", note: "", line: null, straight: 0, corner: 0, body: "biped", duel: lobby.me.sheet, entry: { style: "balance" } }, ...saved]
    : saved;
  const character = characters.find((c) => c.id === selected) ?? characters.find((c) => !c.blocked);
  const isDraft = character?.id.startsWith("verified-") ?? false;
  const myLines = character?.line ? character.line.map(([x, y]) => [x, -y] as [number, number]) : MY_SHAPE.points;

  async function toOpponents() {
    if (!character || busy) return;
    if (!signedIn) {
      setNeedLogin(true);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      if (isDraft && "session" in character.entry) {
        const response = await fetch("/api/duel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", trace: character.entry.trace, session: character.entry.session, plan: UNUSED_PLAN, consent: true }) });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.message ?? "대표 캐릭터를 등록하지 못했어요.");
      }
      setLobby(await request<Lobby>());
      setView("opponents");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "대결 정보를 불러오지 못했어요.");
    }
    setBusy(false);
  }
  const startWith = (opponent: Opponent) => {
    const style = character && character.id !== "registered" && "style" in character.entry ? character.entry.style : undefined;
    setFoeUsed(opponent);
    void act({ action: "start", opponent: opponent.id, ...(style ? { style } : {}) });
  };

  if (signedIn === undefined) return <p role="status" className="derby-note">참가 상태를 확인하고 있어요.</p>;

  if (battle && lobby) {
    const { state, log } = battle;
    const over = state.winner !== null && settled;
    const dealt = state.sheets[1].maxHp - state.hp[1], taken = state.sheets[0].maxHp - state.hp[0];
    return (
      <div className="duel-arena derby-screen">
        <BattleStage
          key={battle.id}
          me={{ name: lobby.me.name, lines: myLines }}
          foe={{ name: battle.opponent, lines: foeShape(battle.opponent).points }}
          state={state}
          log={log}
          onSettled={() => setSettled(true)}
        />
        {message && <p className="derby-error" role="alert">{message}</p>}
        {over ? (
          <div className="bt-result" data-result={state.winner === 0 ? "win" : "lose"}>
            <h2>{resultLabel(state.winner)}</h2>
            <dl>
              <dt>준 피해</dt><dd>{dealt}</dd>
              <dt>받은 피해</dt><dd>{taken}</dd>
              <dt>남은 체력</dt><dd>{state.hp[0]} / {state.sheets[0].maxHp}</dd>
              <dt>턴</dt><dd>{state.turn}</dd>
            </dl>
            {foeUsed && <button type="button" className="derby-start" disabled={busy} onClick={() => startWith(foeUsed)}>다시 대결</button>}
            <button type="button" className="derby-quiet" onClick={() => { setBattle(null); setView("opponents"); void refresh(); }}>다른 상대 고르기</button>
          </div>
        ) : state.winner === null && (
          <div className="duel-choices">
            {BATTLE_CHOICES.map((choice) => (
              <button key={choice} type="button" className={`duel-choice duel-choice-${choice}`} disabled={busy || !settled} onClick={() => void act({ action: "turn", id: battle.id, choice })}>
                <strong>{CHOICE_LABELS[choice]}</strong>
                {choice === "allin" && <small>성공 {Math.round(BATTLE_RULES.allinChance * 100)}%, 치명타 {criticalDamage(state, 0)}</small>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  if (view === "opponents" && lobby) {
    return (
      <div className="derby-screen">
        <h2 className="derby-title">겨룰 상대를 고르세요</h2>
        {message && <p className="derby-error" role="alert">{message}</p>}
        <ol className="duel-foes">
          {lobby.opponents.map((opponent) => (
            <li key={opponent.id}>
              <button type="button" className="duel-foe" disabled={busy} onClick={() => startWith(opponent)}>
                <span className="duel-foe-face" aria-hidden="true"><PathThumb lines={[foeShape(opponent.name).points]} size={72} width={3} /></span>
                <strong>{opponent.name}</strong>
                <Gauge label="체력" value={hpGauge(opponent.sheet)} />
                <Gauge label="공격" value={attackGauge(opponent.sheet)} />
              </button>
            </li>
          ))}
        </ol>
        {lobby.history.length > 0 && (
          <details className="duel-history">
            <summary>최근 대결</summary>
            <ul>{lobby.history.map((item) => <li key={item.id}><span>{item.opponent}</span><b>{resultLabel(item.winner)}</b></li>)}</ul>
          </details>
        )}
        <button type="button" className="derby-quiet" onClick={() => { setMessage(""); setView("pick"); }}>캐릭터 바꾸기</button>
      </div>
    );
  }

  return (
    <div className="derby-screen">
      <h2 className="derby-title">대표 캐릭터를 고르세요</h2>
      <div className="derby-roster" role="radiogroup" aria-label="대표 캐릭터">
        {characters.map((c) => (
          <button key={c.id} type="button" role="radio" aria-checked={c.id === character?.id} className="derby-card" disabled={!!c.blocked} onClick={() => { select(c.id); setMessage(""); }}>
            <CharacterFace character={c} size={72} />
            <strong>{c.name}</strong>
            {c.blocked && <small>{c.blocked}</small>}
            <Gauge label="체력" value={hpGauge(c.duel)} />
            <Gauge label="공격" value={attackGauge(c.duel)} />
          </button>
        ))}
      </div>
      {isDraft && (
        <label className="consent derby-consent">
          <input type="checkbox" checked={consent} onChange={(e) => agree(e.target.checked)} />
          <span>위치를 뺀 기록을 검증하고 내 캐릭터를 상대 목록에 표시하는 데 동의해요.</span>
        </label>
      )}
      {message && <p className="derby-error" role="alert">{message}</p>}
      {!supabase && <p className="derby-note" role="status">이 실행 환경에서는 대결 서버를 쓸 수 없어요.</p>}
      {needLogin && supabase ? (
        <section className="derby-login">
          <p>대결에 표시할 이름이 필요해요.</p>
          <AuthForm supabase={supabase} prepareNext={async () => returnTo} onNavigate={() => { setSignedIn(true); setNeedLogin(false); }} />
        </section>
      ) : (
        <button type="button" className="derby-start" disabled={!supabase || !character || busy || (isDraft && !consent)} aria-busy={busy} onClick={() => void toOpponents()}>
          {busy ? "상대를 찾는 중" : "1대1 대결하기"}
        </button>
      )}
    </div>
  );
}
