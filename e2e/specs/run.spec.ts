// 달리기 흐름 (옛 e2e/route-run-flow.mjs 뒷부분). 코스 찾기 결과에 기대지 않도록, 가짜 길 바둑판 위의
// 네모 코스를 저장소에 직접 넣고 시작한다 → GPS 이동 → 이탈 경고 → 새로고침 후 이어 달리기 → 종료 → 작품방
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures";

/** tests/mocks/handlers.ts 바둑판과 같은 격자 (70m, 기준 위도 35°) 위의 8칸×8칸 네모 코스 */
function squareRoute(): [number, number][] {
  const dLat = 70 / 111_195, dLon = 70 / (111_195 * Math.cos((35 * Math.PI) / 180));
  const i0 = Math.floor(35.15 / dLat), j0 = Math.floor(129.11 / dLon);
  const pts: [number, number][] = [];
  const at = (i: number, j: number): [number, number] => [Math.round(i * dLat * 1e7) / 1e7, Math.round(j * dLon * 1e7) / 1e7];
  for (let j = 0; j < 8; j++) pts.push(at(i0, j0 + j));
  for (let i = 0; i < 8; i++) pts.push(at(i0 + i, j0 + 8));
  for (let j = 8; j > 0; j--) pts.push(at(i0 + 8, j0 + j));
  for (let i = 8; i >= 0; i--) pts.push(at(i0 + i, j0));
  return pts;
}

const ROUTE = squareRoute();

test.beforeEach(async ({ page }) => {
  await page.addInitScript((latlngs) => {
    if (localStorage.getItem("e2e.seeded")) return;
    localStorage.setItem("e2e.seeded", "1");
    localStorage.setItem(
      "runcanvas.route",
      JSON.stringify({ id: "e2e-square", shapeId: "square", shapeName: "네모", latlngs, outline: latlngs, lengthMeters: 2240, similarity: 90, dataTimestamp: "2026-10-01T00:00:00Z" }),
    );
  }, ROUTE);
});

const hav = (a: [number, number], b: [number, number]) => {
  const R = 6371000, r = Math.PI / 180;
  const h = Math.sin(((b[0] - a[0]) * r) / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(((b[1] - a[1]) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** 코스를 따라 약 15m 간격 점 (GPS 튐 필터를 통과하는 속도로 보낸다) */
function along(route: [number, number][], count: number): [number, number][] {
  const pts: [number, number][] = [];
  let acc = 0;
  for (let i = 1; i < route.length && pts.length < count; i++) {
    const a = route[i - 1], b = route[i], d = hav(a, b);
    for (let s = 15 - acc; s <= d && pts.length < count; s += 15) pts.push([a[0] + ((b[0] - a[0]) * s) / d, a[1] + ((b[1] - a[1]) * s) / d]);
    acc = (acc + d) % 15;
  }
  return pts;
}

async function moveTo(ctx: BrowserContext, page: Page, p: [number, number], wait = 2300) {
  await ctx.setGeolocation({ latitude: p[0], longitude: p[1], accuracy: 8 });
  await page.waitForTimeout(wait);
}

test("코스를 따라 달리고, 이탈 경고·이어 달리기·종료 후 작품방에 건다", async ({ page, context }) => {
  await context.setGeolocation({ latitude: ROUTE[0][0], longitude: ROUTE[0][1], accuracy: 8 });
  await page.goto("/run");
  await page.locator(".leaflet-container").waitFor();
  await expect(page.getByText(/네모 코스 · [\d.]+km · 유사도 90/)).toBeVisible();
  await expect(page.getByText(/GPS 양호/)).toBeVisible();
  await page.getByRole("button", { name: /시작/ }).click();
  await expect(page.getByRole("button", { name: /일시정지/ })).toBeVisible();

  const pts = along(ROUTE, 26);
  for (const p of pts) await moveTo(context, page, p);
  const dist = parseFloat((await page.locator("[data-stat=distance]").innerText()).replace("km", ""));
  expect(dist).toBeGreaterThan(0.3);
  expect(parseInt(await page.locator("[data-stat=progress]").innerText())).toBeGreaterThan(0);
  await expect(page.locator(".next-turn")).toBeVisible();
  await expect(page.getByText(/코스에서 \d+m 벗어났어요/)).toHaveCount(0);

  // 코스 이탈
  const last = pts[pts.length - 1];
  for (let k = 0; k < 4; k++) await moveTo(context, page, [last[0] + 0.0012 + k * 0.00002, last[1] + 0.0012], 1500);
  await expect(page.getByText(/코스에서 \d+m 벗어났어요/)).toBeVisible();

  // 진행 중 기록 보관 → 새로고침 후 이어 달리기
  await page.waitForTimeout(5500);
  await page.reload();
  await expect(page.getByText(/끝내지 않은 달리기/)).toBeVisible();
  await page.getByRole("button", { name: "이어 달리기" }).click();
  for (const p of pts.slice(-4).reverse()) await moveTo(context, page, p);
  await page.getByRole("button", { name: /종료/ }).click();
  await expect(page.getByRole("heading", { name: "달리기 완료" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("runcanvas.activeRun"))).toBeNull();

  // 작품방에 걸기: 재개 전후 끊김을 이어 붙이지 않는다
  await page.getByRole("button", { name: /작품방에 걸기/ }).click();
  await page.waitForURL("**/room");
  await expect(page.locator(".scene-item").first()).toBeVisible();
  await page.locator(".scene-item").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "네모 러닝" })).toBeVisible();
  await expect(page.getByText(/^2개 \(사이를 연결하지 않음\)/)).toBeVisible();
});
