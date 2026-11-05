import type { Page } from "@playwright/test";

type Coordinate = [number, number];
type GpsWindow = Window & {
  __yorunTestGps: {
    emit: (point: Coordinate) => void;
    deny: () => void;
  };
};

/**
 * Chromium/WebKit가 실제 기기의 GPS를 흉내 내는 방식에 기대지 않고 동일한 fix를 전달한다.
 * 앱 코드는 그대로 navigator.geolocation을 사용하며, OS 백그라운드 동작은 실기기에서 따로 검증한다.
 */
export async function installRunGps(page: Page, initial: Coordinate, denied = false) {
  // Date만 고정한다. 화면 전환·지도 애니메이션·저장 타이머는 실제 브라우저 시간을 사용한다.
  await page.clock.setFixedTime(new Date("2026-10-18T00:00:00Z"));
  await page.addInitScript(({ initial, denied }) => {
    const watchers = new Map<number, { success: PositionCallback; error?: PositionErrorCallback | null }>();
    let nextId = 1;
    let point = initial;
    let blocked = denied;
    const position = (): GeolocationPosition => {
      const coords = {
        latitude: point[0], longitude: point[1], accuracy: 8,
        altitude: null, altitudeAccuracy: null, heading: null, speed: null,
        toJSON: () => ({ latitude: point[0], longitude: point[1], accuracy: 8 }),
      };
      return { coords, timestamp: Date.now(), toJSON: () => ({ coords, timestamp: Date.now() }) };
    };
    const report = (success: PositionCallback, error?: PositionErrorCallback | null) => {
      if (blocked) error?.({ code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3, message: "Location permission denied" });
      else success(position());
    };
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback, error?: PositionErrorCallback | null) {
          queueMicrotask(() => report(success, error));
        },
        watchPosition(success: PositionCallback, error?: PositionErrorCallback | null) {
          const id = nextId++;
          watchers.set(id, { success, error });
          queueMicrotask(() => { if (watchers.has(id)) report(success, error); });
          return id;
        },
        clearWatch(id: number) { watchers.delete(id); },
      },
    });
    (window as unknown as GpsWindow).__yorunTestGps = {
      emit(next: Coordinate) {
        point = next;
        blocked = false;
        for (const watcher of watchers.values()) report(watcher.success, watcher.error);
      },
      deny() {
        blocked = true;
        for (const watcher of watchers.values()) report(watcher.success, watcher.error);
      },
    };
  }, { initial, denied });
}

/** 시간과 좌표를 함께 전진해 GPS 속도 필터를 통과한다. 실제 sleep은 필요 없다. */
export async function moveRunGps(page: Page, point: Coordinate, elapsedMs = 2300) {
  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(now + elapsedMs));
  await page.evaluate(async (next) => {
    (window as unknown as GpsWindow).__yorunTestGps.emit(next);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, point);
}

export async function finishRun(page: Page) {
  await page.getByRole("button", { name: "종료", exact: true }).click();
  await page.getByRole("button", { name: "한 번 더 눌러 종료", exact: true }).click();
}
