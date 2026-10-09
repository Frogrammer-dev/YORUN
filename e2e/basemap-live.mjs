// 실제 지도 서버 접속 검수 (가짜 응답 없음): 바탕 지도가 키 없이 뜨는지, 오류 이미지·차단 서버를 쓰지 않는지 확인.
// 사전 조건: 앱 실행 중 (기본 :3123). 실행: npm run test:e2e:basemap
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const B = process.env.BASE_URL || "http://localhost:3123";
const OUT = process.argv[2] || "e2e/output";
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };

const browser = await chromium.launch({
  executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "ko-KR", geolocation: { latitude: 35.1545, longitude: 129.114, accuracy: 10 }, permissions: ["geolocation"] });
const reqs = [];
ctx.on("response", (r) => reqs.push({ url: r.url(), status: r.status() }));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));

for (const [path, label] of [["/routes", "단순 지도"], ["/run", "기본 지도(한국어 지명)"]]) {
  reqs.length = 0;
  consoleErrors.length = 0;
  await page.goto(B + path);
  await page.locator(".leaflet-container").waitFor();
  await page.waitForTimeout(7000);
  const ofm = reqs.filter((r) => r.url.includes("openfreemap.org"));
  const tiles = ofm.filter((r) => /\.pbf/.test(r.url));
  const blocked = reqs.filter((r) => /cartocdn\.com|tile\.openstreetmap\.org/.test(r.url));
  ok(`${path} ${label}: 스타일 받음`, ofm.some((r) => /styles\//.test(r.url) && r.status === 200));
  // 벡터 타일은 MapLibre Worker 안에서 받으므로 페이지 요청 목록에 안 잡힐 수 있다 → Worker·지도 오류로 판정
  ok(`${path} 지도 Worker·타일 오류 없음`, !consoleErrors.some((t) => /Worker failed|Failed to fetch|AJAXError|style/i.test(t)) && tiles.every((r) => r.status === 200), consoleErrors.join(" | ").slice(0, 200));
  ok(`${path} 키 필요/차단 서버 사용 안 함`, blocked.length === 0, blocked.map((r) => r.url).slice(0, 2).join(", "));
  ok(`${path} 바탕 지도 오류 안내 없음`, (await page.getByText(/바탕 지도(를 불러오지 못했어요| 없음)/).count()) === 0);
  ok(`${path} 지도 캔버스 그려짐`, (await page.locator(".leaflet-gl-layer, canvas.maplibregl-canvas").count()) > 0);
  await page.screenshot({ path: join(OUT, `basemap${path.replace("/", "-")}.png`) });
}
// 기본 ↔ 단순 전환
await page.goto(B + "/routes");
await page.locator(".leaflet-container").waitFor();
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /기본 지도/ }).click();
await page.waitForTimeout(5000);
await page.screenshot({ path: join(OUT, "basemap-routes-standard.png") });
ok("바탕 지도 전환 후 오류 없음", (await page.getByText(/바탕 지도 없음/).count()) === 0);

ok("브라우저 오류 없음", errors.length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
