// 드로잉 러닝 핵심 흐름 브라우저 검수:
// 코스 찾기(/routes) → 후보 선택 → 달리기(/run) 시작 → 코스를 따라 GPS 이동 → 종료 → 작품방에 걸기
// - Overpass 응답: OVERPASS_FIXTURE(JSON 파일 경로)가 있으면 그것을, 없으면 합성 격자 도로망을 돌려준다.
// - 지도 타일 요청은 빈 이미지로 대체(외부 타일 서버 부하 없음). GPS는 Playwright 위치 흉내.
// 사전 조건: 앱 실행 중 (npm run build && npm start -- -p 3123). 실행: npm run test:e2e:route
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const B = process.env.BASE_URL || "http://localhost:3123";
const OUT = process.argv[2] || "e2e/output";
mkdirSync(OUT, { recursive: true });
const [cLat, cLon] = (process.env.E2E_CENTER || "35.1545,129.114").split(",").map(Number);
const CENTER = { latitude: cLat, longitude: cLon };
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };
const vis = (loc, timeout = 10000) => loc.first().waitFor({ state: "visible", timeout }).then(() => true, () => false);

function syntheticGrid() {
  const els = [];
  const n = 60, step = 70, lat0 = CENTER.latitude - 0.019, lon0 = CENTER.longitude - 0.023;
  const id = (i, j) => 1 + i * n + j;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) els.push({ type: "node", id: id(i, j), lat: lat0 + (i * step) / 111195, lon: lon0 + (j * step) / (111195 * Math.cos((lat0 * Math.PI) / 180)) });
  let w = 1e6;
  for (let i = 0; i < n; i++) els.push({ type: "way", id: w++, nodes: [...Array(n)].map((_, j) => id(i, j)), tags: { highway: "residential" } });
  for (let j = 0; j < n; j++) els.push({ type: "way", id: w++, nodes: [...Array(n)].map((_, i) => id(i, j)), tags: { highway: "footway" } });
  return JSON.stringify({ osm3s: { timestamp_osm_base: "2026-10-01T00:00:00Z" }, elements: els });
}
const overpassBody = process.env.OVERPASS_FIXTURE ? readFileSync(process.env.OVERPASS_FIXTURE, "utf8") : syntheticGrid();
const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "ko-KR", geolocation: { ...CENTER, accuracy: 10 }, permissions: ["geolocation"] });
let overpassCalls = 0;
await ctx.route(/overpass/, (r) => { overpassCalls++; return r.fulfill({ status: 200, contentType: "application/json", body: overpassBody }); });
// 바탕 지도(OpenFreeMap)는 최소 스타일로 대체 — 실제 서버 검수는 e2e/basemap-live.mjs
await ctx.route(/tiles\.openfreemap\.org\/styles\//, (r) =>
  r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": "#eef0f2" } }] }) }),
);
await ctx.route(/tile\.openstreetmap\.org|basemaps\.cartocdn\.com/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG1 }));
// 고도 서버(Open-Meteo)는 좌표 수만큼 완만한 언덕을 돌려준다
let elevCalls = 0;
await ctx.route(/api\.open-meteo\.com\/v1\/elevation/, (r) => {
  elevCalls++;
  const n = new URL(r.request().url()).searchParams.get("latitude").split(",").length;
  return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ elevation: [...Array(n)].map((_, i) => 20 + 30 * Math.sin((i / n) * Math.PI)) }) });
});
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e) + (process.env.E2E_STACK ? `
${e.stack}
@ ${page.url()}` : "")));
page.on("console", (m) => m.type() === "error" && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

// ── 시작 화면 → 코스 찾기
await page.goto(B + "/");
ok("시작 화면: 내 주변 드로잉 코스 찾기", await vis(page.getByRole("link", { name: /내 주변 드로잉 코스 찾기/ })));
await page.getByRole("link", { name: /내 주변 드로잉 코스 찾기/ }).click();
await page.waitForURL("**/routes");
await page.locator(".leaflet-container").waitFor();
ok("지도 표시", (await page.locator(".leaflet-container").count()) === 1);
ok("화면 영역 크기 표시", await vis(page.getByText(/화면 영역 \d/)));
// 지도 출처: 평소엔 ⓘ만, 누르면 펼침
ok("지도 출처 접힘", (await page.locator(".leaflet-control-attribution").isHidden()) && (await page.getByRole("button", { name: "지도 출처 보기" }).isVisible()));
await page.getByRole("button", { name: "지도 출처 보기" }).click();
ok("ⓘ 누르면 출처 표시", (await page.locator(".leaflet-control-attribution").evaluate((el) => getComputedStyle(el).display)) !== "none");
await page.getByRole("button", { name: "지도 출처 접기" }).click();
// 내 위치로 지도 이동이 끝난 뒤 탐색 (위치 점이 그려질 때까지 대기)
await page.locator("path.leaflet-interactive").first().waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
const areaBefore = await page.getByText(/화면 영역 \d/).innerText();

const t0 = Date.now();
await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
const found = await vis(page.getByRole("heading", { name: /찾은 코스 \d+개/ }), 60000);
const took = Date.now() - t0;
ok("코스 탐색 완료", found, `${took}ms, overpass ${overpassCalls}회`);
const nCands = await page.locator(".cand").count();
ok("후보 1개 이상", nCands > 0, `${nCands}개: ${(await page.locator(".cand-title").allInnerTexts()).join(", ")}`);
ok("지도 데이터 기준 시각·미확인 안내", await vis(page.getByText(/지도 데이터 기준 .*통행 가능 여부/)));
ok("지도에 코스 선 표시", (await page.locator("path.leaflet-interactive").count()) >= 2);
ok("길 단순화 기본값: 큰길 위주", (await page.getByRole("radio", { name: "큰길 위주" }).getAttribute("aria-checked")) === "true");
await page.getByRole("button", { name: "탐색에 쓴 길 보기" }).click();
ok("탐색에 쓴 길 겹쳐 보기", (await page.locator(".leaflet-overlay-pane canvas").count()) >= 1);
await page.screenshot({ path: join(OUT, "route-1b-roads.png") });
await page.getByRole("button", { name: "길 숨기기" }).click();
await page.getByRole("button", { name: /기본 지도/ }).click();
ok("바탕 지도 전환", await vis(page.getByRole("button", { name: /단순 지도/ })));
await page.screenshot({ path: join(OUT, "route-1-finder.png") });

// 특정 그림만 다시 찾기 (같은 영역: 데이터 재요청 없음)
await page.getByRole("radio", { name: /하트/ }).click();
await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
await vis(page.getByRole("heading", { name: /찾은 코스 \d+개/ }), 60000);
const heartTitles = await page.locator(".cand-title").allInnerTexts();
const areaAfter = await page.getByText(/화면 영역 \d/).innerText();
console.log("area", areaBefore, "->", areaAfter);
ok("하트만 찾기 + 같은 영역은 데이터 재사용", heartTitles.length > 0 && heartTitles.every((t) => t.includes("하트")) && overpassCalls === 1, `${heartTitles.length}개, overpass ${overpassCalls}회`);

// 고른 코스의 길 정보·고도
await page.locator(".cand").first().click();
ok("길 정보 표시 (큰 차도·비포장·가로등·계단)", await vis(page.getByLabel("코스 길 정보")));
ok("고도: 오르막 합계", await vis(page.locator(".road-facts li", { hasText: /오르막\s*\d+m/ })), `고도 요청 ${elevCalls}회`);

// 글자로 찾기: "LO" → 획 2개, 획 사이 이동 구간
await page.getByRole("radio", { name: /직접 그리기/ }).click();
ok("그리기 전에는 찾기 버튼 비활성", await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).isDisabled());
await page.getByRole("tab", { name: "글자" }).click();
await page.getByLabel("글자 (최대 4자)").fill("LO");
ok("글자 → 획 2개", await vis(page.getByText(/획 2개 — 획마다 고리 코스/)));
await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
await page.getByRole("status").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
await vis(page.getByRole("heading", { name: /찾은 코스 \d+개/ }), 90000);
const textMeta = await page.locator(".cand-meta").allInnerTexts();
ok("글자 코스: 이동 구간 포함", textMeta.length > 0 && textMeta.every((t) => /이동 [\d.]+km/.test(t)), `${textMeta.length}개`);
await page.locator(".cand").first().click();
ok("지도에 이동 구간 점선", (await page.locator("path[stroke-dasharray=\"2 9\"]").count()) >= 1);
await page.screenshot({ path: join(OUT, "route-1e-text.png") });

// 이미지로 만들기: 흰 배경에 검은 동그라미·네모 → 획 2개 (기기 안에서만 처리)
await page.getByRole("tab", { name: "이미지" }).click();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#fff"/><circle cx="70" cy="75" r="55" fill="#000"/><rect x="170" y="25" width="100" height="100" fill="#000"/></svg>`;
await page.getByLabel("이미지").setInputFiles({ name: "two.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svg) });
ok("이미지 → 획 2개", await vis(page.getByText(/획 2개 — 획마다 고리 코스/)));
await page.screenshot({ path: join(OUT, "route-1g-image.png") });
await page.getByRole("tab", { name: "글자" }).click();
await page.getByLabel("글자 (최대 4자)").fill("LO");

// 넓은 영역: 10km를 고르면 5km 칸 4개로 나눠 받는다
const callsBefore = overpassCalls;
await page.getByRole("radio", { name: "지도 가운데 10km 사방" }).click();
await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
await page.getByRole("status").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
await vis(page.getByRole("heading", { name: /찾은 코스 \d+개/ }), 120000);
ok("10km 영역: 칸 4개로 나눠 받기", overpassCalls - callsBefore === 4, `overpass ${overpassCalls - callsBefore}회`);
await page.screenshot({ path: join(OUT, "route-1f-area.png") });
await page.getByRole("radio", { name: "지금 화면" }).click();

// 직접 그린 그림으로 찾기: 그리기 칸에 세모를 한 번에 그린다
await page.getByRole("tab", { name: "그리기" }).click();
const pad = await page.locator(".draw-canvas").boundingBox();
const P = (fx, fy) => [pad.x + pad.width * fx, pad.y + pad.height * fy];
await page.mouse.move(...P(0.5, 0.12));
await page.mouse.down();
for (const [a, b] of [[[0.5, 0.12], [0.88, 0.85]], [[0.88, 0.85], [0.12, 0.85]], [[0.12, 0.85], [0.5, 0.14]]])
  for (let k = 1; k <= 12; k++) await page.mouse.move(...P(a[0] + ((b[0] - a[0]) * k) / 12, a[1] + ((b[1] - a[1]) * k) / 12));
await page.mouse.up();
ok("그린 그림 미리보기", await vis(page.getByText(/이 그림과 닮은 코스를 찾아요/)));
await page.screenshot({ path: join(OUT, "route-1c-draw.png") });
await page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" }).click();
await page.getByRole("status").first().waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
await vis(page.getByRole("heading", { name: /찾은 코스 \d+개/ }), 60000);
const customTitles = await page.locator(".cand-title").allInnerTexts();
ok("내 그림으로 찾기", customTitles.length > 0 && customTitles.every((t) => t.includes("내 그림")), `${customTitles.length}개`);
await page.screenshot({ path: join(OUT, "route-1d-custom.png") });

// 코스 선택 → 달리기
const firstMeta = await page.locator(".cand-meta").first().innerText();
await page.locator(".cand").first().click();
await page.getByRole("button", { name: /이 코스로 달리기/ }).click();
await page.waitForURL("**/run");
await page.locator(".leaflet-container").waitFor();
ok("달리기 화면: 코스 정보", await vis(page.getByText(/내 그림 코스 · [\d.]+km · 유사도/)), firstMeta);
const route = await page.evaluate(() => JSON.parse(localStorage.getItem("runcanvas.route")));
ok("선택 코스는 이 기기에만 저장", Array.isArray(route?.latlngs) && route.latlngs.length > 5);

// 출발점으로 이동 후 시작
const hav = (a, b) => { const R = 6371000, r = Math.PI / 180; const dφ = (b[0] - a[0]) * r, dλ = (b[1] - a[1]) * r; const h = Math.sin(dφ / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dλ / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
await ctx.setGeolocation({ latitude: route.latlngs[0][0], longitude: route.latlngs[0][1], accuracy: 8 });
await page.waitForTimeout(800);
ok("GPS 양호 표시", await vis(page.getByText(/GPS 양호/)));
await page.getByRole("button", { name: /시작/ }).click();
ok("달리는 중 버튼", await vis(page.getByRole("button", { name: /일시정지/ })));

// 코스를 따라 약 15m씩 이동 (초당 ~7m/s 이하로 GPS 튐 필터 통과)
const pts = [];
let acc = 0;
for (let i = 1; i < route.latlngs.length && pts.length < 40; i++) {
  const a = route.latlngs[i - 1], b = route.latlngs[i];
  const d = hav(a, b);
  for (let s = 15 - acc; s <= d; s += 15) pts.push([a[0] + ((b[0] - a[0]) * s) / d, a[1] + ((b[1] - a[1]) * s) / d]);
  acc = (acc + d) % 15;
}
for (const p of pts) {
  await ctx.setGeolocation({ latitude: p[0], longitude: p[1], accuracy: 8 });
  await page.waitForTimeout(2300);
}
const dist = parseFloat((await page.locator("[data-stat=distance]").innerText()).replace("km", ""));
ok("이동 거리 기록", dist > 0.3, `${dist}km (${pts.length}점 이동)`);
const pctText = await page.locator("[data-stat=progress]").innerText();
ok("코스 진행률 증가", parseInt(pctText) > 0, pctText);
ok("방향 안내 표시", await vis(page.locator(".next-turn")), await page.locator(".next-turn").innerText().catch(() => ""));
ok("코스 위에서는 이탈 경고 없음", (await page.getByText(/코스에서 \d+m 벗어났어요/).count()) === 0);

// 코스 이탈
const off = [pts[pts.length - 1][0] + 0.0012, pts[pts.length - 1][1] + 0.0012];
for (let k = 0; k < 4; k++) {
  await ctx.setGeolocation({ latitude: off[0] + k * 0.00002, longitude: off[1], accuracy: 8 });
  await page.waitForTimeout(1500);
}
ok("코스 이탈 경고", await vis(page.getByText(/코스에서 \d+m 벗어났어요/)));
await page.screenshot({ path: join(OUT, "route-2-running.png") });

// 진행 중 기록 기기 보관 → 새로고침 후 이어 달리기 제안
await page.waitForTimeout(5500);
await page.reload();
ok("새로고침 후 이어 달리기 제안", await vis(page.getByText(/끝내지 않은 달리기/)));
await page.getByRole("button", { name: "이어 달리기" }).click();
for (const p of pts.slice(-4).reverse()) {
  await ctx.setGeolocation({ latitude: p[0], longitude: p[1], accuracy: 8 });
  await page.waitForTimeout(2300);
}
await page.getByRole("button", { name: /종료/ }).click();
ok("완료 요약", await vis(page.getByRole("heading", { name: "달리기 완료" })));
ok("완료 후 진행 기록 삭제", (await page.evaluate(() => localStorage.getItem("runcanvas.activeRun"))) === null);

// 작품방에 걸기
await page.getByRole("button", { name: /작품방에 걸기/ }).click();
await page.waitForURL("**/room");
await page.locator(".scene-item").first().waitFor({ timeout: 10000 });
ok("달린 그림이 작품방에 전시", (await page.locator(".scene-item").count()) >= 1);
await page.locator(".scene-item").first().focus();
await page.keyboard.press("Enter");
ok("작품 제목 '내 그림 러닝'", await vis(page.getByRole("heading", { name: "내 그림 러닝" })));
ok("구간 2개 (재개 전후 끊김 보존)", await vis(page.getByText(/^2개 \(사이를 연결하지 않음\)/)));
await page.screenshot({ path: join(OUT, "route-3-room.png") });

// 모바일 폭
await page.setViewportSize({ width: 360, height: 780 });
for (const p of ["/routes", "/run"]) {
  await page.goto(B + p);
  await page.locator(".leaflet-container").waitFor();
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  ok(`360px ${p} 가로 스크롤 없음`, sw <= 360, `scrollWidth=${sw}`);
}
await page.screenshot({ path: join(OUT, "route-4-run-mobile.png"), fullPage: true });

ok("브라우저 오류 없음", errors.length === 0, errors.join(" | ").slice(0, process.env.E2E_STACK ? 4000 : 300));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
