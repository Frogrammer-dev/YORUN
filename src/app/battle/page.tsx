import type { Metadata } from "next";
import { BattleApp } from "@/components/battle/BattleApp";

export const metadata: Metadata = { title: "그림 대결 — 요런", robots: { index: false } };

export default function BattlePage() {
  return <BattleApp />;
}
