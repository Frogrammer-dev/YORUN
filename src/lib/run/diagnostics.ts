import type { LocationFailure } from "./browserLocation";
import type { ScreenLockState } from "./browserLifecycle";
import type { FixRejectionReason } from "./tracker";

export type SaveReason = "start" | "pause" | "finish" | "interval" | "hidden" | "pagehide" | "unmount" | "retry" | "discard" | "artwork";
type DiagnosticEvent =
  | { type: "gps"; accepted: boolean; reason: FixRejectionReason | "accepted" | "invalid"; accuracy: "good" | "weak"; intervalMs: number | null }
  | { type: "gps-error"; reason: LocationFailure }
  | { type: "storage"; reason: SaveReason; ok: boolean }
  | { type: "wake-lock"; state: ScreenLockState };

function allowed<T extends string>(value: string, values: readonly T[], fallback: T): T {
  return values.find((item) => item === value) ?? fallback;
}

/** Pick known fields even when callers pass structurally compatible objects with extra private data. */
function safeEvent(event: DiagnosticEvent): DiagnosticEvent {
  switch (event.type) {
    case "gps": return {
      type: "gps", accepted: event.accepted === true,
      reason: allowed(event.reason, ["paused", "coordinate", "timestamp", "accuracy", "jump", "still", "accepted", "invalid"], "invalid"),
      accuracy: event.accuracy === "good" ? "good" : "weak",
      intervalMs: event.intervalMs !== null && Number.isFinite(event.intervalMs) && event.intervalMs >= 0 ? event.intervalMs : null,
    };
    case "gps-error": return { type: "gps-error", reason: allowed(event.reason, ["denied", "unavailable", "timeout", "unsupported", "invalid"], "invalid") };
    case "storage": return {
      type: "storage", ok: event.ok === true,
      reason: allowed(event.reason, ["start", "pause", "finish", "interval", "hidden", "pagehide", "unmount", "retry", "discard", "artwork"], "interval"),
    };
    case "wake-lock": return { type: "wake-lock", state: allowed(event.state, ["held", "released", "unavailable"], "unavailable") };
  }
}

/** Memory-only, bounded diagnostics. No coordinates, route IDs, GPX, tokens or user-entered text. */
export function createRunDiagnostics() {
  const events: Array<DiagnosticEvent & { at: number }> = [];
  return {
    add(event: DiagnosticEvent) {
      events.push({ ...safeEvent(event), at: Date.now() });
      if (events.length > 500) events.splice(0, events.length - 500);
    },
    report(userAgent: string) {
      return { schemaVersion: 1, application: "yorun-web", capturedAt: new Date().toISOString(), userAgent, events: events.map((event) => ({ ...event })) };
    },
  };
}
