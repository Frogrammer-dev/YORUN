"use client";
import { useEffect, useState } from "react";
import { PathThumb } from "@/components/Icon";
import { SHAPES } from "@/lib/route/shapes";
import { simulateDuel, type DuelResult } from "@/lib/battle/duel";

export function exampleDuel(seed = "arena-preview"): DuelResult {
  return simulateDuel(
    { id: "me", stats: { distanceM: 5000, adherence: 0.85, climbMPerKm: 6 }, plan: ["strike", "guard", "pierce", "strike", "guard"] },
    { id: "opponent", stats: { distanceM: 4200, adherence: 0.8, climbMPerKm: 8 }, plan: ["guard", "strike", "strike", "pierce", "strike"] },
    seed,
  );
}
const actions = { strike: "강타", guard: "방어", pierce: "꿰뚫기" };

export function DuelArena({ result, opponent = "상대 러너", example = false }: { result: DuelResult; opponent?: string; example?: boolean }) {
  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setTimeout(() => {
      if (turn < result.turns.length) setTurn(turn + 1);
      else setPlaying(false);
    }, 1100);
    return () => clearTimeout(timer);
  }, [playing, turn, result]);
  const log = result.turns[turn - 1];
  const hp = log?.hp ?? result.sheets.map(sheet => sheet.maxHp);
  const finished = turn === result.turns.length;
  const message = finished ? result.winner === null ? "무승부" : result.winner === 0 ? "승리!" : "패배" :
    log ? `${turn}턴 · 내 ${actions[log.actions[0]]} / 상대 ${actions[log.actions[1]]}` : "배틀 준비 완료!";
  return <section className="duel-arena" aria-label={example ? "예시 대결" : "대결 재생"}>
    <div className="duel-arena-field">
      <div className="duel-platform duel-platform-foe" />
      <div className="duel-platform duel-platform-me" />
      <div className="duel-hud duel-hud-foe">
        <strong>{opponent}</strong>
        <div><span>HP</span><progress aria-label="상대 체력" max={result.sheets[1].maxHp} value={hp[1]} /></div>
        <small>{Math.ceil(hp[1])} / {Math.ceil(result.sheets[1].maxHp)}</small>
      </div>
      <div key={"foe" + turn} className={`duel-route duel-route-foe ${playing ? "duel-route-move" : ""}`}>
        <PathThumb lines={[SHAPES.find(s => s.id === "airplane")!.points]} size={120} width={3.5} />
      </div>
      <div key={"me" + turn} className={`duel-route duel-route-me ${playing ? "duel-route-move" : ""}`}>
        <PathThumb lines={[SHAPES.find(s => s.id === "dog")!.points]} size={155} width={3.5} />
      </div>
      <div className="duel-hud duel-hud-me">
        <strong>내 러너</strong>
        <div><span>HP</span><progress aria-label="내 체력" max={result.sheets[0].maxHp} value={hp[0]} /></div>
        <small>{Math.ceil(hp[0])} / {Math.ceil(result.sheets[0].maxHp)}</small>
      </div>
    </div>
    <div className="duel-arena-controls">
      <strong role="status">{message}</strong>
      <button type="button" className="btn btn-sm" onClick={() => { if (finished) setTurn(0); setPlaying(!playing); }}>
        {playing ? "일시정지" : finished ? "다시 재생" : "배틀 재생"}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => { setTurn(0); setPlaying(false); }}>처음으로</button>
    </div>
    <p className="hint">{example ? "합성 기록으로 진행하는 예시 경기예요. " : ""}캐릭터는 예시 경로 모양이에요.</p>
  </section>;
}
