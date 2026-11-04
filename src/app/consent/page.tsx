import type { Metadata } from "next";
import { ConsentScreen } from "@/components/ConsentScreen";
import { safeNext } from "@/lib/safeNext";

export const metadata: Metadata = { title: "개인정보 동의 — 요런" };

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next } = await searchParams;
  return <ConsentScreen next={safeNext(typeof next === "string" ? next : null, "/")} />;
}
