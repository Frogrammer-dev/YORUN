import type { Metadata } from "next";
import { RunApp } from "@/components/run/RunApp";

export const metadata: Metadata = { title: "달리기 — 요런", robots: { index: false } };

export default function RunPage() {
  return <RunApp />;
}
