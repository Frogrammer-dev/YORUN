import type { Metadata } from "next";
import { LoginScreen } from "@/components/LoginScreen";
import { safeNext } from "@/lib/safeNext";

export const metadata: Metadata = { title: "로그인 — 요런" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { next } = await searchParams;
  return <LoginScreen next={safeNext(typeof next === "string" ? next : null, "/")} />;
}
