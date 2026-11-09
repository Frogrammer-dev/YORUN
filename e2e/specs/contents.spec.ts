// 콘텐츠 화면과 게임 입구: 서버 없이 도는 흐름을 확인한다.
import { expect, test } from "@playwright/test";

test("@mobile 콘텐츠 탭: GPX 불러오기로 가고, 부스 체험 입구는 없다", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /부스 체험/ })).toHaveCount(0);
  await page.goto("/hub");
  await page.getByRole("link", { name: "GPX 불러오기" }).click();
  await page.waitForURL("**/contents");
  await expect(page.getByText("지원 파일과 개인정보 안내")).toBeVisible();
});

test("@mobile 8인 경기: 캐릭터를 고르고 봇 입장, 중계, 결과까지 간다", async ({ page }) => {
  await page.goto("/derby");
  await expect(page.getByRole("heading", { name: "출전할 캐릭터를 고르세요" })).toBeVisible();
  await page.getByRole("radio", { name: /코너형/ }).click();
  await expect(page.getByRole("radio", { name: /코너형/ })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.getByRole("button", { name: "봇과 연습 경기" }).click();
  await expect(page.locator(".derby-seat-in")).toHaveCount(8, { timeout: 15_000 });
  await expect(page.getByLabel("현재 순위")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator(".tabbar")).toBeHidden();
  await page.getByRole("button", { name: "결과 바로 보기" }).click();
  await expect(page.getByLabel("1위부터 3위")).toBeVisible();
  await expect(page.locator(".derby-results li")).toHaveCount(8);
  await page.getByRole("button", { name: "다시 경기하기" }).click();
  await expect(page.getByRole("heading", { name: "출전할 캐릭터를 고르세요" })).toBeVisible();
});

test("@mobile 1대1 대결: 대표 캐릭터 고르기 화면이 먼저 나온다", async ({ page }) => {
  await page.goto("/duel");
  await expect(page.getByRole("heading", { name: "대표 캐릭터를 고르세요" })).toBeVisible();
  await page.getByRole("radio", { name: /코너형/ }).click();
  await expect(page.getByRole("radio", { name: /코너형/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByRole("button", { name: "1대1 대결하기" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
});
