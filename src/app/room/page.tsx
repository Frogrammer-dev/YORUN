import { Suspense } from "react";
import type { Metadata } from "next";
import { RoomApp } from "@/components/room/RoomApp";

export const metadata: Metadata = { title: "내 작품방 — 요런", robots: { index: false, follow: false } };

export default function RoomPage() {
  return (
    <Suspense fallback={<main className="room-page"><p role="status">작품방을 여는 중…</p></main>}>
      <RoomApp />
    </Suspense>
  );
}
