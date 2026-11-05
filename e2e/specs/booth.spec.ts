// 부스 체험: 코스 추출 → 가상 완주 → 체험 경주 → 다음 참가자. 서버 없이 도는 흐름을 확인한다.
import { expect, test } from "@playwright/test";

test("@mobile 부스 체험: 코스를 뽑아 가상으로 완주하고 연습 경주까지 간다", async ({ page }) => {
  await page.goto("/booth");
  await expect(page.getByRole("heading", { name: "어떤 그림을 달려 볼까요?", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "이곳에서 경로 추출" }).click();
  await page.getByRole("button", { name: /가상 달리기 시작/ }).click();
  await expect(page.getByRole("heading", { name: "내가 고른 길이 작품이 됐어요", level: 1 })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "혼자 연습 경주" }).click();
  await page.getByRole("button", { name: "경주 결과 보기" }).click();
  await expect(page.getByText("· 나")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);

  await page.getByRole("button", { name: "다음 참가자 시작" }).click();
  await expect(page.getByRole("heading", { name: "어떤 그림을 달려 볼까요?", level: 1 })).toBeVisible();
  await expect(page.getByText(/체험 작품방 · 1개/)).toBeVisible();
});

test("@mobile 부스 체험: 윤곽을 만들지 못해도 준비된 모양으로 계속할 수 있다", async ({ page }) => {
  await page.route("**/api/recognition/outline", (route) => route.fulfill({ status: 503, json: { message: "윤곽 생성 서비스에 연결하지 못했어요." } }));
  await page.goto("/booth");
  await page.getByRole("button", { name: "설명으로 만들기" }).click();
  await page.getByLabel("어떤 모습으로 달릴까요?").fill("토끼");
  await page.getByRole("button", { name: "윤곽 만들기" }).click();
  await expect(page.locator('.booth [role="alert"]')).toContainText("연결하지 못했어요");
  await page.getByRole("button", { name: "하트" }).click();
  await page.getByRole("button", { name: "이곳에서 경로 추출" }).click();
  await expect(page.getByRole("button", { name: /가상 달리기 시작/ })).toBeVisible();
});

test("@mobile 콘텐츠 탭: 도감과 GPX 불러오기로 갈 수 있다", async ({ page }) => {
  await page.goto("/hub");
  await page.locator('.hub-tile[href="/contents/catalog"]').click();
  await page.waitForURL("**/contents/catalog");
  await expect(page.getByRole("heading", { name: "도감", level: 1 })).toBeVisible();
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
