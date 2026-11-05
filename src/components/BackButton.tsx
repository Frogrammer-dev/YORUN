"use client";

import { useRouter } from "next/navigation";
import { Icon } from "./Icon";

export function BackButton({ fallback = "/contents" }: { fallback?: string }) {
  const router = useRouter();
  return (
    <button type="button" className="btn btn-link" onClick={() => {
      if (window.history.length > 1) router.back();
      else router.replace(fallback);
    }}>
      <Icon name="back" size={18} /> 뒤로가기
    </button>
  );
}
