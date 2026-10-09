// 회귀 시험: 비동기 작업 중 화면 이동 시 지도 오류(getZoom of null, appendChild of undefined)가 없어야 한다.
// - A) 길 데이터를 받는 중(응답 3초 지연) 다른 화면으로 이동
// - B) 확대 애니메이션 중 다른 화면으로 이동 (10회)
// - C) 확대·축소와 바탕 지도 전환을 빠르게 반복
// 사전 조건: 앱 실행 중 (BASE_URL, 기본 :3123). 실행: npm run test:e2e:nav
import { chromium } from "playwright-core";
const B = process.env.BASE_URL || "http://localhost:3123";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };
const b = await chromium.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 860 }, geolocation: { latitude: 35.1545, longitude: 129.114, accuracy: 10 }, permissions: ["geolocation"] });
// 길 데이터 응답을 3초 늦춰 '받는 중에 화면 이동' 상황을 만든다 (실제 Overpass 응답 형식)
await ctx.route(/overpass/, async (r) => { await new Promise((res) => setTimeout(res, 3000)); r.fulfill({ status: 200, contentType: "application/json", body: '{"elements":[]}' }); });
const p = await ctx.newPage();
const errs = [];
p.on("console", (m) => m.type() === "error" && errs.push("console: " + m.text().slice(0, 200)));
p.on("pageerror", (e) => errs.push("pageerror: " + String(e).slice(0, 200)));


await p.goto(B + "/routes", { timeout: 120000 });
await p.waitForTimeout(4000);
await p.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
await p.waitForTimeout(300);
await p.getByRole("link", { name: "작품방" }).click(); // 코스 찾기 화면을 떠나는 링크 (리디자인 후 지도 위 pill)
await p.waitForTimeout(5000);
ok("A) 길 데이터 받는 중 화면 이동: 오류 없음", errs.length === 0, errs.slice(0, 2).join(" | "));


const before = errs.length;
for (let k = 0; k < 10; k++) {
  await p.goto(B + "/routes", { timeout: 120000 });
  await p.locator(".leaflet-gl-layer").first().waitFor({ timeout: 20000 }).catch(() => {});
  await p.waitForTimeout(1500);
  await p.locator(".leaflet-control-zoom-in").click();
  await p.waitForTimeout(30 + k * 15);
  await p.getByRole("link", { name: "작품방" }).click(); // 코스 찾기 화면을 떠나는 링크 (리디자인 후 지도 위 pill)
  await p.waitForTimeout(800);
}
ok("B) 확대 중 화면 이동 10회: 오류 없음", errs.length === before, errs.slice(before, before + 2).join(" | "));

console.log("C) 확대·축소 + 바탕 지도 전환 빠르게 반복");
const beforeC = errs.length;
await p.goto(B + "/routes", { timeout: 120000 });
await p.locator(".leaflet-gl-layer").first().waitFor({ timeout: 20000 }).catch(() => {});
const box = await p.locator(".map").boundingBox();
for (let k = 0; k < 6; k++) {
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.mouse.wheel(0, k % 2 ? 300 : -300);
  await p.waitForTimeout(60);
  await p.locator(".map-fabs button").nth(1).click(); // 바탕 지도 전환 버튼
  await p.waitForTimeout(150);
}
await p.waitForTimeout(3000);
ok("C) 확대·바탕 지도 전환 반복: 오류 없음", errs.length === beforeC, errs.slice(beforeC, beforeC + 2).join(" | "));
await b.close();
console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
