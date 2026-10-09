// E2E 공용 준비물
// - network: 외부 서버(Overpass·Open-Meteo·바탕 지도)를 tests/mocks/handlers.ts 가짜 응답으로 가로챈다 (단위 테스트와 같은 정의)
// - apiCalls: 테스트 안에서 외부 요청 횟수를 셀 때
// - 모든 테스트가 끝날 때 브라우저 오류(페이지 예외·콘솔 오류)가 없었는지 자동으로 확인한다
import { test as base, expect, type Page } from "@playwright/test";
import { defineNetworkFixture, type NetworkFixture } from "@msw/playwright";
import type { AnyHandler } from "msw";
import { createHandlers, type BBox } from "../tests/mocks/handlers";

export interface ApiCalls {
  overpass: BBox[];
  elevation: number;
}

interface Fixtures {
  apiCalls: ApiCalls;
  handlers: AnyHandler[];
  network: NetworkFixture;
  /** 이 테스트에서 일부러 내는 오류는 여기 패턴을 넣어 제외 */
  allowedErrors: RegExp[];
  browserErrors: string[];
}

export const test = base.extend<Fixtures>({
  apiCalls: async ({}, use) => {
    await use({ overpass: [], elevation: 0 });
  },
  handlers: async ({ apiCalls }, use) => {
    await use(createHandlers({ onOverpass: (b) => apiCalls.overpass.push(b), onElevation: () => apiCalls.elevation++ }));
  },
  network: [
    async ({ context, handlers }, use, info) => {
      // live 프로젝트는 실제 서버를 쓴다
      if (info.project.name === "live") return use(undefined as unknown as NetworkFixture);
      const network = defineNetworkFixture({ context, handlers });
      await network.enable();
      await use(network);
      await network.disable();
    },
    { auto: true },
  ],
  allowedErrors: async ({}, use) => {
    await use([]);
  },
  browserErrors: [
    async ({ page, allowedErrors }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
      });
      await use(errors);
      const real = errors.filter((e) => !allowedErrors.some((r) => r.test(e)));
      expect(real, "브라우저 오류 없음").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

/** 지도가 뜨고 첫 위치 이동까지 끝나기를 기다린다 (내 위치 점이 그려지면 끝) */
export async function waitForMap(page: Page) {
  await page.locator(".leaflet-container").waitFor();
  await page.locator("path.leaflet-interactive").first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
}

/** 코스 찾기 버튼을 누르고 결과 목록(또는 오류)이 나올 때까지 기다린다. 걸린 시간(ms)을 돌려준다 */
export async function searchCourses(page: Page, timeout = 120_000): Promise<number> {
  const t = Date.now();
  await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
  await expect(page.locator(".progress-cta")).toBeVisible();
  await expect(page.getByRole("heading", { name: /찾은 코스 \d+개/ }).or(page.locator(".banner-error"))).toBeVisible({ timeout });
  await expect(page.locator(".banner-error")).toHaveCount(0);
  return Date.now() - t;
}

/** 성능 예산: 넘으면 테스트 결과에 경고를 남긴다 (CI 기기 편차가 커서 실패로 하지 않는다. 절대 상한은 timeout이 맡는다) */
export function perfBudget(name: string, ms: number, budgetMs: number) {
  const info = test.info();
  info.annotations.push({ type: ms > budgetMs ? "성능 예산 초과" : "성능", description: `${name}: ${Math.round(ms / 100) / 10}초 (예산 ${budgetMs / 1000}초)` });
}
