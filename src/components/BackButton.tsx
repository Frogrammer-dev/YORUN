"use client";
// 들어온 화면으로 돌아간다. 바로 열어 돌아갈 곳이 없으면 정해 둔 화면으로 간다.

import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

export function BackButton({ fallback }: { fallback: string }) {
  const router = useRouter();
  return (
    <button type="button" className="icon-btn appbar-back" aria-label="뒤로가기" onClick={() => {
      if (window.history.length > 1) router.back();
      else router.replace(fallback);
    }}>
      <Icon name="back" size={24} />
    </button>
  );
}
