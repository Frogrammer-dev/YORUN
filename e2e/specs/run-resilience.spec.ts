import { expect, test } from "../fixtures";
import { finishRun, installRunGps, moveRunGps } from "../run-gps";

const START: [number, number] = [35.1545, 129.114];
const at = (step: number): [number, number] => [START[0] + step * 0.00012, START[1]];
const STORAGE_WARNING = "기기에 기록을 저장하지 못했어요. 앱을 닫기 전에 GPX로 저장해 주세요.";

test.beforeEach(async ({ page }) => {
  await installRunGps(page, START);
});

for (const event of ["visibilitychange", "pagehide"] as const) {
  test(`@run ${event} 때 마지막 GPS 기록을 즉시 보관하고 새로고침 후 복원한다`, async ({ page }) => {
    await page.goto("/run");
    await expect(page.getByText(/GPS 양호/)).toBeVisible();
    await page.getByRole("button", { name: "시작", exact: true }).click();
    for (let step = 0; step < 3; step++) await moveRunGps(page, at(step));

    // 주기 저장으로 통과하지 않도록, 이벤트 직전에 저장소를 비우고 같은 작업 안에서 결과를 읽는다.
    const saved = await page.evaluate((eventName) => {
      localStorage.removeItem("runcanvas.activeRun");
      if (eventName === "visibilitychange") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        window.dispatchEvent(new Event("pagehide"));
      }
      return JSON.parse(localStorage.getItem("runcanvas.activeRun") ?? "null");
    }, event);
    expect(saved).not.toBeNull();
    expect(saved.record.distanceMeters).toBeGreaterThan(20);
    expect(saved.record.segments.flat().at(-1)).toMatchObject({ lat: at(2)[0], lon: at(2)[1] });

    await page.reload();
    await expect(page.getByText(/끝내지 않은 달리기/)).toBeVisible();
    await page.getByRole("button", { name: "이어 달리기", exact: true }).click();
    await expect(page.locator("[data-stat=distance]")).toContainText((saved.record.distanceMeters / 1000).toFixed(2));
    await page.getByRole("button", { name: "일시정지", exact: true }).click();
    const resumed = await page.evaluate(() => JSON.parse(localStorage.getItem("runcanvas.activeRun") ?? "null"));
    expect(resumed.record.segments[0]).toEqual(saved.record.segments[0]);
    expect(resumed.record.distanceMeters).toBe(saved.record.distanceMeters);
  });
}

test("@run 일시정지 중 이동을 제외하고 두 구간을 GPX로 저장한다", async ({ page }) => {
  await page.goto("/run");
  await expect(page.getByText(/GPS 양호/)).toBeVisible();
  await page.getByRole("button", { name: "시작", exact: true }).click();
  for (let step = 0; step < 3; step++) await moveRunGps(page, at(step));
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  const pausedDistance = await page.locator("[data-stat=distance]").innerText();
  await moveRunGps(page, at(100));
  await expect(page.locator("[data-stat=distance]")).toHaveText(pausedDistance);
  await page.getByRole("button", { name: "다시 시작", exact: true }).click();
  for (let step = 100; step < 103; step++) await moveRunGps(page, at(step));
  await finishRun(page);
  await expect(page.getByRole("heading", { name: "달리기 완료" })).toBeVisible();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("runcanvas.activeRun") ?? "null"));
  expect(saved.record.segments.map((segment: unknown[]) => segment.length)).toEqual([3, 3]);
  expect(saved.record.distanceMeters).toBeLessThan(60);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "GPX로 저장", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("yorun-run.gpx");
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  let gpx = "";
  for await (const chunk of stream!) gpx += chunk.toString();
  expect(gpx.match(/<trkseg>/g)).toHaveLength(2);
  expect(gpx.match(/<trkpt /g)).toHaveLength(6);
});

test("@run GPS 권한을 거절하면 안내하고 달리기 시작을 막는다", async ({ page }) => {
  await page.goto("/run");
  await expect(page.getByText(/GPS 양호/)).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __yorunTestGps: { deny: () => void } }).__yorunTestGps.deny();
  });
  await expect(page.getByText("GPS 권한 없음", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "시작", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("runcanvas.activeRun"))).toBeNull();
});

test("@run 저장소 쓰기가 실패해도 경고와 GPX 내보내기로 기록을 보존할 수 있다", async ({ page }) => {
  await page.goto("/run");
  await expect(page.getByText(/GPS 양호/)).toBeVisible();
  await page.evaluate(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      if (key === "runcanvas.activeRun") throw new DOMException("Test quota exhausted", "QuotaExceededError");
      return setItem.call(this, key, value);
    };
  });
  await page.getByRole("button", { name: "시작", exact: true }).click();
  for (let step = 0; step < 3; step++) await moveRunGps(page, at(step));
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect(page.getByText(STORAGE_WARNING, { exact: true })).toBeVisible();
  await finishRun(page);
  await expect(page.getByRole("heading", { name: "달리기 완료" })).toBeVisible();
  await expect(page.locator(".done-page").getByText(STORAGE_WARNING, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "GPX로 저장", exact: true })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "GPX로 저장", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("yorun-run.gpx");
});
