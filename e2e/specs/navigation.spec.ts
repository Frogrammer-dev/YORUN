// 비동기 작업 중 화면 이동 회귀 시험 (옛 e2e/navigation-stress.mjs): 지도 오류(getZoom of null 등)가 없어야 한다.
// 브라우저 오류 확인은 공용 준비물이 테스트마다 자동으로 한다.
import { http, HttpResponse, delay } from "msw";
import { test } from "../fixtures";

test("길 데이터를 받는 중(3초 지연)에 다른 화면으로 이동", async ({ page, network }) => {
  network.use(
    http.post(/overpass/, async () => {
      await delay(3000);
      return HttpResponse.json({ elements: [] });
    }),
  );
  await page.goto("/routes");
  await page.waitForTimeout(4000);
  await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("link", { name: "작품방" }).click();
  await page.waitForTimeout(5000);
});

test("확대 애니메이션 중 화면 이동 10회", async ({ page }) => {
  for (let k = 0; k < 10; k++) {
    await page.goto("/routes");
    await page.locator(".leaflet-container").waitFor();
    await page.waitForTimeout(1500);
    await page.locator(".leaflet-control-zoom-in").click();
    await page.waitForTimeout(30 + k * 15);
    await page.getByRole("link", { name: "작품방" }).click();
    await page.waitForTimeout(800);
  }
});

test("확대·축소와 바탕 지도 전환을 빠르게 반복", async ({ page }) => {
  await page.goto("/routes");
  await page.locator(".leaflet-container").waitFor();
  const box = (await page.locator(".map").boundingBox())!;
  for (let k = 0; k < 6; k++) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, k % 2 ? 300 : -300);
    await page.waitForTimeout(60);
    await page.locator(".map-fabs button").nth(1).click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(3000);
});
