import type { Metadata } from "next";
import Link from "next/link";
import { DerbyGame } from "@/components/derby/DerbyGame";
import { Icon } from "@/components/Icon";

export const metadata: Metadata = { title: "8인 드로잉 더비 — 요런" };

export default function DerbyPage() {
  return (
    <main className="hub-page">
      <header className="appbar">
        <Link href="/hub" className="icon-btn appbar-back" aria-label="콘텐츠로 돌아가기"><Icon name="back" size={24} /></Link>
        <span className="appbar-title"><h1>8인 드로잉 더비</h1></span>
      </header>
      <div className="hub-body">
        <DerbyGame />
      </div>
    </main>
  );
}
