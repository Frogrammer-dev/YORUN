// 브라우저 E2E (Next.js 안내: node_modules/next/dist/docs/01-app/02-guides/testing/playwright.md)
// - 앱 서버는 webServer가 띄운다 (CI: 미리 빌드한 것을 start, 로컬: 빌드 후 start, 이미 떠 있으면 재사용)
// - 외부 서버는 e2e/fixtures.ts가 MSW 가짜 응답으로 막는다 (live 프로젝트만 실제 서버)
// - 실패하면 trace·스크린샷을 남긴다: npx playwright show-trace test-results/.../trace.zip
// 로컬에서 Playwright 브라우저를 따로 받지 않으려면 설치된 Edge·Chrome을 쓴다: PW_CHANNEL=msedge
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3123);
const CI = !!process.env.CI;
const channel = process.env.PW_CHANNEL || undefined;

export default defineConfig({
  testDir: "e2e/specs",
  outputDir: "test-results",
  // 달리기 흐름은 GPS 이동을 기다리므로 길다
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: CI ? 1 : 0,
  forbidOnly: CI,
  reporter: CI ? [["list"], ["html", { open: "never" }], ["github"]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "ko-KR",
    channel,
    trace: CI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    // 부산 광안리 (가짜 길 데이터는 어디든 바둑판을 만들어 준다)
    geolocation: { latitude: 35.1545, longitude: 129.114, accuracy: 10 },
    permissions: ["geolocation"],
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel, viewport: { width: 1280, height: 900 } }, grepInvert: /@live|@mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel, viewport: { width: 360, height: 780 } }, grep: /@mobile/ },
    // 실제 바탕 지도 서버 접속 확인 (기본 실행에서 제외): npm run test:e2e:live
    { name: "live", use: { ...devices["Desktop Chrome"], channel }, grep: /@live/ },
  ],
  webServer: {
    command: CI ? `npm run start -- -p ${PORT}` : `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 300_000,
  },
});
