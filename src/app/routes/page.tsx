import type { Metadata } from "next";
import { RouteFinderApp } from "@/components/route/RouteFinderApp";

export const metadata: Metadata = { title: "드로잉 루트 찾기 — 요런" };

export default function RoutesPage() {
  return <RouteFinderApp />;
}
