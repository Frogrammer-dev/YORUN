// 코스 찾기 화면 (옛 e2e/route-run-flow.mjs 앞부분)
import type { Page } from "@playwright/test";
import { expect, perfBudget, searchCourses, test, waitForMap } from "../fixtures";

async function openFinder(page: Page) {
  await page.goto("/");
  await page.getByRole("link", { name: /내 주변 드로잉 코스 찾기/ }).click();
  await page.waitForURL("**/routes");
  await waitForMap(page);
}

/** 그리기 칸에 정규화 좌표(0~1) 꼭짓점을 잇는 한 획을 그린다 */
async function drawStroke(page: Page, pts: Array<[number, number]>) {
  const pad = (await page.locator(".draw-canvas").boundingBox())!;
  const P = (x: number, y: number) => [pad.x + pad.width * x, pad.y + pad.height * y] as const;
  await page.mouse.move(...P(...pts[0]));
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++)
    for (let k = 1; k <= 12; k++)
      await page.mouse.move(...P(pts[i - 1][0] + ((pts[i][0] - pts[i - 1][0]) * k) / 12, pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * k) / 12));
  await page.mouse.up();
}

test("동네 추천: 길 데이터 한 번 받아 코스 목록·선·안내 표시", async ({ page, apiCalls }) => {
  await openFinder(page);
  await expect(page.getByText(/화면 영역 \d/)).toBeVisible();
  const ms = await searchCourses(page);
  perfBudget("동네 추천 (합성 바둑판, 낙서 인식 포함)", ms, 45_000);
  expect(apiCalls.overpass).toHaveLength(1);
  await expect(page.locator(".cand").first()).toBeVisible();
  await expect(page.getByText(/지도 데이터 기준 .*통행 가능 여부/)).toBeVisible();
  expect(await page.locator("path.leaflet-interactive").count()).toBeGreaterThanOrEqual(2);
  await expect(page.getByRole("radio", { name: "큰길 위주" })).toHaveAttribute("aria-checked", "true");
  // 탐색에 쓴 길 겹쳐 보기·바탕 지도 전환
  await page.getByRole("button", { name: "탐색에 쓴 길 보기" }).click();
  await expect(page.locator(".leaflet-overlay-pane canvas")).not.toHaveCount(0);
  await page.getByRole("button", { name: /기본 지도/ }).click();
  await expect(page.getByRole("button", { name: /단순 지도/ })).toBeVisible();
});

test("같은 영역에서 그림만 바꾸면 길 데이터를 다시 받지 않는다", async ({ page, apiCalls }) => {
  await openFinder(page);
  await page.getByRole("radio", { name: "네모" }).click();
  await searchCourses(page);
  await page.getByRole("radio", { name: /하트/ }).click();
  await searchCourses(page);
  const titles = await page.locator(".cand-title").allInnerTexts();
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.every((t) => t.includes("하트"))).toBe(true);
  expect(apiCalls.overpass).toHaveLength(1);
});

test("고른 코스의 길 정보와 고도", async ({ page, apiCalls }) => {
  await openFinder(page);
  await page.getByRole("radio", { name: "네모" }).click();
  await searchCourses(page);
  await page.locator(".cand").first().click();
  await expect(page.getByLabel("코스 길 정보")).toBeVisible();
  await expect(page.locator(".road-facts li", { hasText: /오르막\s*\d+m/ })).toBeVisible();
  await expect(page.locator(".elev-chart")).toBeVisible();
  expect(apiCalls.elevation).toBeGreaterThanOrEqual(1);
});

test("글자로 찾기: 'LO' → 획 2개, 획 사이 이동 구간 점선", async ({ page }) => {
  await openFinder(page);
  await page.getByRole("radio", { name: /직접 그리기/ }).click();
  await expect(page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" })).toBeDisabled();
  await page.getByRole("tab", { name: "글자" }).click();
  await page.getByLabel("글자 (최대 4자)").fill("LO");
  await expect(page.getByText(/획 2개 — 획마다 고리 코스/)).toBeVisible();
  await searchCourses(page);
  const meta = await page.locator(".cand-meta").allInnerTexts();
  expect(meta.length).toBeGreaterThan(0);
  for (const m of meta) expect(m).toMatch(/이동 [\d.]+km/);
  await page.locator(".cand").first().click();
  await expect(page.locator('path[stroke-dasharray="2 9"]').first()).toBeAttached();
});

test("이미지로 만들기: 동그라미·네모 실루엣 → 획 2개 (기기 안에서 처리)", async ({ page }) => {
  await openFinder(page);
  await page.getByRole("radio", { name: /직접 그리기/ }).click();
  await page.getByRole("tab", { name: "이미지" }).click();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#fff"/><circle cx="70" cy="75" r="55" fill="#000"/><rect x="170" y="25" width="100" height="100" fill="#000"/></svg>`;
  await page.getByLabel("이미지").setInputFiles({ name: "two.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
  await expect(page.getByText(/획 2개 — 획마다 고리 코스/)).toBeVisible();
});

test("직접 그린 세모로 찾기", async ({ page }) => {
  await openFinder(page);
  await page.getByRole("radio", { name: /직접 그리기/ }).click();
  await drawStroke(page, [[0.5, 0.12], [0.88, 0.85], [0.12, 0.85], [0.5, 0.14]]);
  await expect(page.getByText(/이 그림과 닮은 코스를 찾아요/)).toBeVisible();
  await searchCourses(page);
  const titles = await page.locator(".cand-title").allInnerTexts();
  expect(titles.length).toBeGreaterThan(0);
  expect(titles.every((t) => t.includes("내 그림"))).toBe(true);
});

test("넓은 영역 10km는 5km 칸 4개로 나눠 받는다", async ({ page, apiCalls }) => {
  await openFinder(page);
  await page.getByRole("radio", { name: "네모" }).click();
  await page.getByRole("radio", { name: "지도 가운데 10km 사방" }).click();
  const ms = await searchCourses(page, 170_000);
  perfBudget("10km 영역 네모", ms, 60_000);
  expect(apiCalls.overpass).toHaveLength(4);
});

test("지도 출처는 ⓘ로 접혀 있다가 누르면 펼쳐진다", async ({ page }) => {
  await openFinder(page);
  await expect(page.locator(".leaflet-control-attribution")).toBeHidden();
  await page.getByRole("button", { name: "지도 출처 보기" }).click();
  await expect(page.locator(".leaflet-control-attribution")).not.toHaveCSS("display", "none");
  await page.getByRole("button", { name: "지도 출처 접기" }).click();
  await expect(page.locator(".leaflet-control-attribution")).toBeHidden();
});

test("@mobile 360px 코스 찾기·달리기 화면에 가로 스크롤 없음", async ({ page }) => {
  for (const p of ["/routes", "/run"]) {
    await page.goto(p);
    await page.locator(".leaflet-container").waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), p).toBeLessThanOrEqual(360);
  }
});
