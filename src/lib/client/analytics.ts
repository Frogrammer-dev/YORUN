// 18.2 최소 분석 이벤트. 좌표·GPX 본문·파일명·제목·공유 토큰·이메일은 넣지 않는다.
// 수집처는 아직 정하지 않았으므로 개발 중에는 콘솔에만 남긴다. 공유 화면에서는 호출하지 않는다.
export type AnalyticsEvent =
  | { name: "import_started" }
  | { name: "import_failed"; errorCode: string }
  | { name: "preview_ready"; durationBucket: "lt1s" | "lt3s" | "lt10s" | "gte10s" }
  | { name: "first_art_saved" }
  | { name: "second_art_saved" }
  | { name: "room_edit_saved" }
  | { name: "png_exported" }
  | { name: "share_created" }
  | { name: "share_revoked" };

export function track(e: AnalyticsEvent) {
  if (process.env.NODE_ENV !== "production") console.debug("[event]", e);
}

export function durationBucket(ms: number): "lt1s" | "lt3s" | "lt10s" | "gte10s" {
  return ms < 1000 ? "lt1s" : ms < 3000 ? "lt3s" : ms < 10000 ? "lt10s" : "gte10s";
}
