import type { Metadata } from "next";

// page.tsx가 클라이언트 컴포넌트라 탭 제목은 여기서 정한다
export const metadata: Metadata = { title: "데이터와 계정 — 요런" };

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
