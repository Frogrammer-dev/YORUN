// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { watchBrowserLocation } from "@/lib/run/browserLocation";
import { keepScreenAwake, onRunLifecycle } from "@/lib/run/browserLifecycle";
import { createRunDiagnostics } from "@/lib/run/diagnostics";

const cleanups: Array<() => void> = [];
let visibility: DocumentVisibilityState;

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  vi.restoreAllMocks();
});

function show(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event("visibilitychange"));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function screenLock() {
  const target = new EventTarget();
  return {
    release: vi.fn(async () => { target.dispatchEvent(new Event("release")); }),
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    browserRelease: () => target.dispatchEvent(new Event("release")),
  };
}

async function settle() {
  // Drain request/release/finally promises without advancing time or relying on polling.
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("화면 잠금 방지 수명", () => {
  it("일시정지/화면 종료 이후 완료된 요청은 곧바로 해제하고 상태를 갱신하지 않음", async () => {
    const pending = deferred<ReturnType<typeof screenLock>>();
    const onState = vi.fn();
    const dispose = keepScreenAwake(onState, { request: () => pending.promise });
    cleanups.push(dispose);
    dispose();
    const lock = screenLock();
    pending.resolve(lock);
    await settle();
    expect(lock.release).toHaveBeenCalledOnce();
    expect(onState).not.toHaveBeenCalled();
  });

  it("pending 중 반복 visible 이벤트로 중복 요청하지 않으며 해제 뒤 재획득", async () => {
    const pending = deferred<ReturnType<typeof screenLock>>();
    const request = vi.fn(() => pending.promise);
    const onState = vi.fn();
    cleanups.push(keepScreenAwake(onState, { request }));
    show("visible");
    show("visible");
    expect(request).toHaveBeenCalledTimes(1);
    const lock = screenLock();
    pending.resolve(lock);
    await settle();
    expect(onState).toHaveBeenLastCalledWith("held");
    show("visible");
    expect(request).toHaveBeenCalledTimes(1);
    lock.browserRelease();
    expect(onState).toHaveBeenLastCalledWith("released");
    show("visible");
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("요청 실패를 표시하되 종료 후 늦게 도착한 실패는 무시", async () => {
    const pending = deferred<ReturnType<typeof screenLock>>();
    const request = vi.fn().mockRejectedValueOnce(new Error("not allowed")).mockReturnValueOnce(pending.promise);
    const onState = vi.fn();
    const dispose = keepScreenAwake(onState, { request });
    cleanups.push(dispose);
    await settle();
    expect(onState).toHaveBeenCalledExactlyOnceWith("unavailable");
    show("visible");
    dispose();
    pending.reject(new Error("late rejection"));
    await settle();
    expect(onState).toHaveBeenCalledTimes(1);
  });

  it("숨겨진 화면에서 반환된 lock 해제가 끝나기 전에 복귀해도 다시 획득", async () => {
    const pending = deferred<ReturnType<typeof screenLock>>();
    const releasing = deferred<void>();
    const first = screenLock();
    first.release.mockImplementation(() => releasing.promise);
    const second = screenLock();
    const request = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValueOnce(second);
    const onState = vi.fn();
    cleanups.push(keepScreenAwake(onState, { request }));
    show("hidden");
    pending.resolve(first);
    await settle();
    expect(first.release).toHaveBeenCalledOnce();
    show("visible");
    releasing.resolve();
    await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(onState).toHaveBeenLastCalledWith("held");
  });

  it("교체된 예전 lock의 release 이벤트가 현재 held 상태를 덮어쓰지 않음", async () => {
    const first = screenLock();
    const second = screenLock();
    const request = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const onState = vi.fn();
    cleanups.push(keepScreenAwake(onState, { request }));
    await settle();
    first.browserRelease();
    show("visible");
    await settle();
    const count = onState.mock.calls.length;
    first.browserRelease();
    expect(onState).toHaveBeenCalledTimes(count);
    expect(onState).toHaveBeenLastCalledWith("held");
  });

  it("cleanup은 이미 획득한 lock을 한 번만 해제하고 이후 복귀 이벤트를 무시", async () => {
    const lock = screenLock();
    const request = vi.fn().mockResolvedValue(lock);
    const onState = vi.fn();
    const dispose = keepScreenAwake(onState, { request });
    cleanups.push(dispose);
    await settle();
    dispose();
    dispose();
    show("hidden");
    show("visible");
    expect(lock.release).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(onState).toHaveBeenCalledExactlyOnceWith("held");
  });
});

describe("러닝 화면 생명주기", () => {
  it("hidden/pagehide를 동기 저장하고 cleanup 뒤에는 이벤트를 받지 않음", () => {
    const flush = vi.fn();
    const dispose = onRunLifecycle(flush);
    cleanups.push(dispose);
    show("visible");
    expect(flush).not.toHaveBeenCalled();
    show("hidden");
    expect(flush.mock.calls).toEqual([["hidden"]]);
    window.dispatchEvent(new Event("pagehide"));
    expect(flush.mock.calls).toEqual([["hidden"], ["pagehide"]]);
    dispose();
    expect(flush.mock.calls).toEqual([["hidden"], ["pagehide"], ["unmount"]]);
    show("hidden");
    window.dispatchEvent(new Event("pagehide"));
    expect(flush).toHaveBeenCalledTimes(3);
  });
});

describe("브라우저 위치 수신", () => {
  it("잘못된 위치는 지도·기록에 전달하지 않고 종료 뒤 늦은 위치/오류도 무시", () => {
    let success!: PositionCallback;
    let failure!: PositionErrorCallback;
    const watchPosition = vi.fn((ok: PositionCallback, error?: PositionErrorCallback | null) => {
      success = ok;
      failure = error!;
      return 7;
    });
    const clearWatch = vi.fn();
    const geolocation = { watchPosition, clearWatch, getCurrentPosition: vi.fn() };
    const onFix = vi.fn();
    const onError = vi.fn();
    const dispose = watchBrowserLocation(onFix, onError, geolocation);
    cleanups.push(dispose);
    const position = {
      coords: { latitude: 35.15, longitude: 129.1, accuracy: 8, altitude: null, altitudeAccuracy: null, heading: null, speed: null, toJSON: () => ({}) },
      timestamp: 1_000,
      toJSON: () => ({}),
    };
    success(position);
    expect(onFix).toHaveBeenCalledExactlyOnceWith({ lat: 35.15, lon: 129.1, accuracy: 8, time: 1_000 });
    success({ ...position, coords: { ...position.coords, latitude: NaN } });
    success({ ...position, coords: { ...position.coords, accuracy: -1 } });
    expect(onError.mock.calls).toEqual([["invalid"], ["invalid"]]);
    dispose();
    success(position);
    failure({ code: 1, message: "late", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(clearWatch).toHaveBeenCalledWith(7);
  });

  it("위치 기능 없음 및 watchPosition 동기 예외를 명시적 오류로 처리", () => {
    vi.stubGlobal("navigator", {});
    const onError = vi.fn();
    watchBrowserLocation(vi.fn(), onError);
    expect(onError).toHaveBeenLastCalledWith("unsupported");
    watchBrowserLocation(vi.fn(), onError, {
      watchPosition: () => { throw new Error("blocked"); },
      clearWatch: vi.fn(), getCurrentPosition: vi.fn(),
    });
    expect(onError).toHaveBeenLastCalledWith("unavailable");
    vi.unstubAllGlobals();
  });
});

describe("러닝 진단 개인정보 경계", () => {
  it("최근 500개 이벤트만 유지하고 반환 보고서 수정이 다음 보고서에 영향을 주지 않음", () => {
    const diagnostics = createRunDiagnostics();
    for (let i = 0; i < 503; i++) {
      diagnostics.add({ type: "gps", accepted: true, reason: "accepted", accuracy: "good", intervalMs: i });
    }
    const report = diagnostics.report("test-device");
    expect(report.events).toHaveLength(500);
    expect(report.events[0]).toMatchObject({ intervalMs: 3 });
    expect(report.events.at(-1)).toMatchObject({ intervalMs: 502 });
    report.events[0].at = -1;
    report.events.pop();
    const again = diagnostics.report("test-device");
    expect(again.events).toHaveLength(500);
    expect(again.events[0].at).toBeGreaterThan(0);
  });

  it("실제 GPS 객체의 좌표·코스 ID·토큰이 추가 필드로 전달되어도 내보내지 않음", () => {
    const diagnostics = createRunDiagnostics();
    const event = {
      type: "gps" as const, accepted: true, reason: "accepted" as const, accuracy: "good" as const, intervalMs: 1000,
      lat: 35.15, lon: 129.1, routeId: "private-route", accessToken: "secret-token", points: [[35.15, 129.1]],
    };
    diagnostics.add(event);
    expect(Object.keys(diagnostics.report("test-device").events[0]).sort()).toEqual(["accepted", "accuracy", "at", "intervalMs", "reason", "type"]);
    expect(JSON.stringify(diagnostics.report("test-device"))).not.toMatch(/35\.15|129\.1|private-route|secret-token/);
  });
});
