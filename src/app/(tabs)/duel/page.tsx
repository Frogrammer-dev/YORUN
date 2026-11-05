import type { Metadata } from "next";
import Link from "next/link";
import { DuelArena } from "@/components/battle/DuelArena";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = { title: "1대1 플레이어 대결 — 요런" };

export default function DuelPage() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기"><Icon name="back" size={24} /></Link>
        <span className="appbar-title"><h1>1대1 플레이어 대결</h1></span>
      </header>
      <div className="hub-body">
        <DuelArena returnTo="/duel" />
      </div>
    </main>
  );
}
