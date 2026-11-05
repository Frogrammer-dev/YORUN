/** Best effort synchronous checkpoint. This cannot make a web app track in the background. */
export function onRunLifecycle(flush: (reason: "hidden" | "pagehide" | "unmount") => void): () => void {
  let disposed = false;
  const hidden = () => { if (document.visibilityState === "hidden") flush("hidden"); };
  const leaving = () => flush("pagehide");
  document.addEventListener("visibilitychange", hidden);
  window.addEventListener("pagehide", leaving);
  return () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener("visibilitychange", hidden);
    window.removeEventListener("pagehide", leaving);
    flush("unmount");
  };
}

export type ScreenLockState = "held" | "released" | "unavailable";
type ScreenLock = {
  release(): Promise<void>;
  addEventListener(type: "release", callback: () => void): void;
  removeEventListener(type: "release", callback: () => void): void;
};
type ScreenLockApi = { request(type: "screen"): Promise<ScreenLock> };

/** Dispose pending requests too: a lock resolved after pause/unmount must not remain held. */
export function keepScreenAwake(
  onState: (state: ScreenLockState) => void,
  api: ScreenLockApi | undefined = (navigator as Navigator & { wakeLock?: ScreenLockApi }).wakeLock,
): () => void {
  let disposed = false;
  let pending = false;
  let lock: ScreenLock | null = null;
  let removeReleaseListener: (() => void) | null = null;
  function releaseCurrent() {
    const previous = lock;
    lock = null;
    removeReleaseListener?.();
    removeReleaseListener = null;
    if (previous) {
      void previous.release().catch(() => {});
      if (!disposed) onState("released");
    }
  }
  async function request() {
    if (disposed || pending || lock || document.visibilityState !== "visible") return;
    if (!api) { onState("unavailable"); return; }
    pending = true;
    let releasedWhileHidden = false;
    try {
      const acquired = await api.request("screen");
      if (disposed || document.visibilityState !== "visible") {
        releasedWhileHidden = !disposed;
        await acquired.release();
        return;
      }
      lock = acquired;
      const released = () => {
        if (lock !== acquired) return;
        lock = null;
        removeReleaseListener?.();
        removeReleaseListener = null;
        if (!disposed) onState("released");
      };
      acquired.addEventListener("release", released);
      removeReleaseListener = () => acquired.removeEventListener("release", released);
      onState("held");
    } catch {
      if (!disposed) onState("unavailable");
    } finally {
      pending = false;
      // Visibility may have changed while awaiting release, when request() was still pending.
      if (releasedWhileHidden && !disposed && document.visibilityState === "visible") void request();
    }
  }
  const visible = () => {
    if (document.visibilityState === "visible") void request();
    else releaseCurrent();
  };
  document.addEventListener("visibilitychange", visible);
  void request();
  return () => {
    disposed = true;
    document.removeEventListener("visibilitychange", visible);
    releaseCurrent();
  };
}
