"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DuelArena } from "@/components/battle/DuelArena";
import { Icon } from "@/components/Icon";
import { watchBattleDraft, type BattleDraft } from "@/lib/battle/battleDraft";
import type { DuelAction } from "@/lib/battle/duel";

/** 등록 API가 받는 기존 필드. 새 대결은 매 턴 직접 고르므로 이 값을 쓰지 않는다 */
const UNUSED_PLAN: DuelAction[] = ["strike", "guard", "pierce", "strike", "guard"];

export default function DuelPage() {
  const [consent, agree] = useState(false);
  const [trace, setTrace] = useState<BattleDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, notice] = useState("");
  const [arenaKey, setArenaKey] = useState(0);
  useEffect(() => watchBattleDraft(setTrace), []);

  async function register() {
    if (busy) return;
    setBusy(true);
    notice("");
    try {
      const response = await fetch("/api/duel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", trace: trace?.trace, session: trace?.id, plan: UNUSED_PLAN, consent }) });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.message ?? "대표 캐릭터를 등록하지 못했어요.");
      notice("달린 기록으로 대표 캐릭터를 등록했어요.");
      setArenaKey((key) => key + 1);
    } catch (error) {
      notice(error instanceof Error ? error.message : "대표 캐릭터를 등록하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="hub-page">
      <header className="appbar">
        <Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기"><Icon name="back" size={24} /></Link>
        <span className="appbar-title"><h1>1대1 플레이어 대결</h1></span>
      </header>
      <div className="hub-body">
        <p className="battle-lead">다른 사람의 대표 캐릭터나 봇을 골라 매 턴 직접 겨뤄요. 상대의 선택은 인공지능이 해요.</p>
        <section className="hub-card"><DuelArena key={arenaKey} returnTo="/duel" /></section>
        <section className="hub-card">
          <h2>내 대표 캐릭터</h2>
          <p>최근 완료한 코스 기록을 등록하면 체력과 공격에 조금 반영되고, 다른 사람의 상대 목록에도 나타나요. 등록하지 않아도 체험 캐릭터로 대결할 수 있어요.</p>
          <label className="consent"><input type="checkbox" checked={consent} onChange={(e) => agree(e.target.checked)} /> <span>위치를 제거한 기록을 검증하고 내 캐릭터를 상대 목록에 표시하는 데 동의해요.</span></label>
          <button type="button" className="btn btn-primary wide" disabled={!trace || !consent || busy} onClick={() => void register()}>대표 캐릭터 등록</button>
          {!trace && <p className="hint">로그인한 상태에서 온라인으로 코스 달리기를 시작하고 완료하면 인증 기록이 생겨요. <Link href="/routes">러닝으로 이동</Link></p>}
          {message && <p className="battle-msg" role="status">{message}</p>}
        </section>
      </div>
    </main>
  );
}
