// 비로그인 작품방: GPX 가져오기 → 자동 전시 → 편집·드래그 → PNG → 새로고침 복원 → 오류 파일 (옛 e2e/guest-flow.mjs)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../fixtures";

const S = "samples";

async function importGpx(page: Page, file: string, count: number) {
  await page.locator('input[type="file"]').setInputFiles(join(S, file));
  await page.getByRole("button", { name: "작품 만들기" }).click();
  await expect(page.locator(".scene-item")).toHaveCount(count);
}

/** 시작 화면에서 첫 작품을 만들어 작품방으로 */
async function startWithHeart(page: Page) {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles(join(S, "01-heart-single-segment.gpx"));
  await page.getByRole("button", { name: "작품 만들기" }).click();
  await page.waitForURL("**/room");
  await expect(page.locator(".scene-item")).toHaveCount(1);
}

test("가입 없이 첫 작품이 임시 작품방에 자동 전시된다", async ({ page }) => {
  await startWithHeart(page);
  await expect(page.getByText("임시 작품방")).toBeVisible();
});

test("끊긴 구간은 잇지 않고 구간별 선·단일점으로 전시", async ({ page }) => {
  await startWithHeart(page);
  await page.locator('input[type="file"]').setInputFiles(join(S, "02-star-two-segments-gap.gpx"));
  await expect(page.getByText("3개 구간이 있어요. 사이를 연결하지 않고 전시합니다.")).toBeVisible();
  await page.getByRole("button", { name: "작품 만들기" }).click();
  await expect(page.locator(".scene-item")).toHaveCount(2);
  const star = page.locator(".scene-item").nth(1);
  await expect(star.locator("polyline")).toHaveCount(2);
  await expect(star.locator("circle")).toHaveCount(1);
});

test("버튼·키보드·드래그로 편집하고 기준선과 비교", async ({ page }) => {
  await startWithHeart(page);
  await importGpx(page, "02-star-two-segments-gap.gpx", 2);
  const first = page.locator(".scene-item").first();
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "선택한 작품 편집" })).toBeVisible();
  const before = await first.getAttribute("transform");
  await page.getByRole("button", { name: "오른쪽으로 이동" }).click();
  await expect.poll(() => first.getAttribute("transform")).not.toBe(before);
  await page.getByRole("radio", { name: /네온/ }).click();
  await page.getByRole("button", { name: "작게" }).click();
  await first.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('rect[stroke-dasharray="10 6"]')).toHaveCount(1);

  const second = page.locator(".scene-item").nth(1);
  const box = (await second.boundingBox())!;
  const t0 = await second.getAttribute("transform");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => second.getAttribute("transform")).not.toBe(t0);

  await page.getByRole("button", { name: "기준선과 전시용 선 비교" }).click();
  await expect(page.getByText(/정규화 기준선 \(\d+점\)/)).toBeVisible();
});

test("PNG 1000×750 내보내기", async ({ page }, info) => {
  await startWithHeart(page);
  await page.getByRole("tab", { name: "이미지" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PNG 저장" }).click()]);
  const path = info.outputPath("export.png");
  await dl.saveAs(path);
  const buf = readFileSync(path);
  expect(buf.subarray(1, 4).toString()).toBe("PNG");
  expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([1000, 750]);
});

test("비로그인 공유는 로그인 안내, 저장 서비스 미설정 안내", async ({ page }) => {
  await startWithHeart(page);
  await page.getByRole("tab", { name: "공유" }).click();
  await expect(page.getByText("로그인해 저장한 작품방에서 만들 수 있어요")).toBeVisible();
  await page.getByRole("button", { name: "로그인하고 저장" }).last().click();
  await expect(page.getByText("설정되어 있지 않아요")).toBeVisible();
});

test("새로고침하면 임시 초안이 복원되고, 원 위경도·시각은 저장하지 않는다", async ({ page }) => {
  await startWithHeart(page);
  await importGpx(page, "02-star-two-segments-gap.gpx", 2);
  await page.waitForTimeout(600); // 초안 저장 지연
  await page.reload();
  await expect(page.locator(".scene-item")).toHaveCount(2);
  await expect(page.getByText("이 기기에 24시간 보관")).toBeVisible();
  const stored = await page.evaluate(
    () =>
      new Promise<string>((res) => {
        const r = indexedDB.open("runcanvas");
        r.onsuccess = () => {
          const g = r.result.transaction("drafts").objectStore("drafts").get("guest");
          g.onsuccess = () => res(JSON.stringify(g.result));
        };
      }),
  );
  expect(stored).not.toMatch(/35\.15|129\.1|2026-10-01T|하트"|별 \(/);
});

test("잘못된 GPX는 이유를 알려 주고, 여러 트랙이면 고르게 한다", async ({ page }) => {
  await startWithHeart(page);
  const file = page.locator('input[type="file"]');
  await file.setInputFiles(join(S, "e2-doctype-entity.gpx"));
  await expect(page.getByText("DOCTYPE·ENTITY")).toBeVisible();
  await file.setInputFiles(join(S, "e1-route-only.gpx"));
  await expect(page.getByText("트랙 기록이 들어 있는 GPX만 지원해요")).toBeVisible();
  await file.setInputFiles(join(S, "e3-bad-coordinate.gpx"));
  await expect(page.getByText("트랙 1, 구간 1의 좌표가 올바르지 않아요")).toBeVisible();
  await file.setInputFiles(join(S, "03-multi-track-prefixed-ns.gpx"));
  await expect(page.getByText("전시할 기록 하나를 선택해 주세요.")).toBeVisible();
  await page.getByRole("button", { name: /트랙 2/ }).click();
  await page.getByRole("button", { name: "작품 만들기" }).click();
  await expect(page.locator(".scene-item")).toHaveCount(2);
});

test("없는 공유 링크는 404와 안내", async ({ page, allowedErrors }) => {
  allowedErrors.push(/404/);
  const res = await page.goto("/share/abc");
  expect(res?.status()).toBe(404);
  await expect(page.getByText("공유가 종료되었거나 링크를 찾을 수 없어요.")).toBeVisible();
});

test("@mobile 360px 작품방에 가로 스크롤 없음", async ({ page }) => {
  await startWithHeart(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
});
