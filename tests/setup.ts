// 화면 컴포넌트 테스트가 끝날 때마다 그린 DOM을 지운다 (vitest는 전역 afterEach를 켜지 않으므로 직접 등록)
import { afterEach } from "vitest";

afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
