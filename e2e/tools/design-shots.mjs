// 디자인 검수용 화면 캡처: 시작 → 코스 찾기(빈/결과) → 달리기(시작 전/중/완료) → 작품방, 모바일(390) + 데스크톱(1280)
// 길 데이터는 처음 한 번만 실제 Overpass에서 받아 SHOTS_CACHE에 저장 후 재사용. 바탕 지도는 실제 OpenFreeMap.
// 사전 조건: 앱 실행 중 (:3123). 실행: node e2e/tools/design-shots.mjs <출력폴더> (실제 지도 서버 사용, 수동 디자인 검수용)
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const B = process.env.BASE_URL || "http://localhost:3123";
const OUT = process.argv[2] || "e2e/output/design";
const CACHE = process.env.SHOTS_CACHE || join(OUT, "..", "overpass-cache.json");
mkdirSync(OUT, { recursive: true });
const CENTER = { latitude: 35.1545, longitude: 129.114 }; // 부산 광안리
const only = process.env.SHOTS_ONLY; // "mobile" | "desktop"

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });

async function run(label, viewport, isMobile) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: isMobile ? 2 : 1, isMobile, hasTouch: isMobile, locale: "ko-KR", colorScheme: process.env.SHOTS_DARK ? "dark" : "light", geolocation: { ...CENTER, accuracy: 10 }, permissions: ["geolocation"] });
  await ctx.route(/overpass/, async (r) => {
    if (existsSync(CACHE)) return r.fulfill({ status: 200, contentType: "application/json", body: readFileSync(CACHE, "utf8") });
    const res = await r.fetch();
    const body = await res.text();
    if (res.ok()) writeFileSync(CACHE, body);
    return r.fulfill({ response: res, body });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const shot = async (name, full = false) => {
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(OUT, `${label}-${name}.png`), fullPage: full });
    console.log("shot", `${label}-${name}.png`);
  };

  await page.goto(B + "/");
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("01-landing");
  await shot("01b-landing-full", true);

  await page.goto(B + "/routes");
  await page.locator(".leaflet-container").waitFor();
  await page.waitForTimeout(2500);
  await shot("02-routes-idle");
  await shot("02b-routes-idle-full", true);

  await page.getByRole("button", { name: /코스 찾기/ }).first().click();
  await page.getByRole("heading", { name: /찾은 코스 \d+개/ }).waitFor({ timeout: 120000 }).catch(() => console.log("no results"));
  await shot("03-routes-results");
  await shot("03b-routes-results-full", true);

  const cand = page.locator(".cand").first();
  if (await cand.count()) {
    await cand.click();
    await shot("04-routes-selected");
    await page.getByRole("button", { name: /이 코스로 달리기/ }).click();
    await page.waitForURL("**/run");
  } else await page.goto(B + "/run");
  await page.locator(".leaflet-container").waitFor();
  const route = await page.evaluate(() => JSON.parse(localStorage.getItem("runcanvas.route") || "null"));
  if (route) await ctx.setGeolocation({ latitude: route.latlngs[0][0], longitude: route.latlngs[0][1], accuracy: 8 });
  await page.waitForTimeout(2500);
  await shot("05-run-ready");
  await shot("05b-run-ready-full", true);

  await page.getByRole("button", { name: /시작/ }).first().click();
  if (route) {
    // 코스를 따라 약 12m씩 1.8초 간격(약 6.7m/s, 튐 필터 통과)으로 이동
    const hav = (a, b) => { const R = 6371000, r = Math.PI / 180; const dφ = (b[0] - a[0]) * r, dλ = (b[1] - a[1]) * r; const h = Math.sin(dφ / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dλ / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    const pts = [];
    let acc = 0;
    for (let i = 1; i < route.latlngs.length && pts.length < Number(process.env.SHOTS_STEPS || 28); i++) {
      const a = route.latlngs[i - 1], b = route.latlngs[i], d = hav(a, b);
      for (let s = 12 - acc; s <= d; s += 12) pts.push([a[0] + ((b[0] - a[0]) * s) / d, a[1] + ((b[1] - a[1]) * s) / d]);
      acc = (acc + d) % 12;
    }
    for (const p of pts) {
      await ctx.setGeolocation({ latitude: p[0], longitude: p[1], accuracy: 8 });
      await page.waitForTimeout(1800);
    }
  }
  await shot("06-run-active");
  await shot("06b-run-active-full", true);
  if (route) {
    for (let k = 0; k < 4; k++) {
      await ctx.setGeolocation({ latitude: route.latlngs[0][0] + 0.0012 + k * 0.00002, longitude: route.latlngs[0][1] + 0.0012, accuracy: 8 });
      await page.waitForTimeout(1500);
    }
    await shot("06c-run-offroute");
  }
  await page.getByRole("button", { name: /일시정지/ }).click().catch(() => {});
  await shot("07-run-paused");
  await page.getByRole("button", { name: /종료/ }).click().catch(() => {});
  await page.getByRole("heading", { name: "달리기 완료" }).waitFor({ timeout: 8000 }).catch(() => {});
  await shot("08-run-done");
  await shot("08b-run-done-full", true);
  await page.getByRole("button", { name: /작품방에 걸기/ }).click().catch(() => {});
  await page.waitForURL("**/room", { timeout: 10000 }).catch(() => {});
  await page.locator(".scene-item").first().waitFor({ timeout: 10000 }).catch(() => {});
  await shot("09-room");
  await shot("09b-room-full", true);
  // 실제 길이의 기록(샘플 하트 GPX)을 가져와 작품방에 건 모습
  await page.goto(B + "/");
  await page.locator('input[type="file"]').first().setInputFiles("samples/01-heart-single-segment.gpx");
  await page.getByRole("button", { name: "작품 만들기" }).waitFor({ timeout: 10000 }).catch(() => {});
  await page.getByRole("button", { name: "작품 만들기" }).scrollIntoViewIfNeeded().catch(() => {});
  await shot("10a-import-confirm");
  await page.getByRole("button", { name: "작품 만들기" }).click().catch(() => {});
  await page.waitForURL("**/room", { timeout: 15000 }).catch(() => {});
  await page.locator(".scene-item").first().waitFor({ timeout: 10000 }).catch(() => {});
  await shot("10-room-gpx");
  await page.locator(".scene-item").last().click().catch(() => {});
  await shot("10b-room-gpx-selected-full", true);
  await page.evaluate(() => localStorage.removeItem("runcanvas.activeRun"));
  if (errors.length) console.log("ERRORS", label, errors.join(" | ").slice(0, 600));
  await ctx.close();
}

if (only !== "desktop") await run(process.env.SHOTS_DARK ? "dk" : process.env.SHOTS_W ? "s" : "m", { width: Number(process.env.SHOTS_W || 390), height: 844 }, true);
if (only !== "mobile") await run("d", { width: 1280, height: 860 }, false);
await browser.close();
