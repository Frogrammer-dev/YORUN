// 비로그인 핵심 흐름 브라우저 검수: 가져오기 → 자동 전시 → 편집·드래그 → PNG → 새로고침 복원 → 오류 파일 → 360px.
// 사전 조건: 앱이 실행 중 (npm run build && npm start -- -p 3123)
// 실행: npm run test:e2e   (BROWSER_PATH로 Chrome/Edge 실행 파일 지정 가능)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const B = process.env.BASE_URL || "http://localhost:3123";
const S = process.argv[2] || "samples";
const OUT = process.argv[3] || "e2e/output";
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const vis = (loc) => loc.first().waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
const ok = (n, c, x = "") => { if (c) pass++; else fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${x ? "  — " + x : ""}`); };

const browser = await chromium.launch({ executablePath: process.env.BROWSER_PATH || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: "ko-KR" });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(B + "/");
// 화면이 준비(hydration)되기 전에 스크린샷을 찍으면 입력칸에 caret 스타일이 끼어 React 불일치 경고가 난다
await page.waitForLoadState("networkidle");
await page.screenshot({ path: join(OUT, "1-landing.png"), fullPage: true });

// 첫 작품: 비로그인 파일 → 자동 전시 (AT-01)
await page.locator('input[type="file"]').setInputFiles(join(S, "01-heart-single-segment.gpx"));
await page.getByRole("button", { name: "작품 만들기" }).click();
await page.waitForURL("**/room");
await page.locator(".scene-item").first().waitFor();
ok("가입 없이 첫 작품 자동 전시", (await page.locator(".scene-item").count()) === 1);
ok("임시 작품방 표시", await vis(page.getByText("임시 작품방")));

// 두 번째 작품: 끊긴 구간 안내 + 빈 슬롯 배치
await page.locator('input[type="file"]').setInputFiles(join(S, "02-star-two-segments-gap.gpx"));
ok("끊긴 구간 안내", await vis(page.getByText("3개 구간이 있어요. 사이를 연결하지 않고 전시합니다.")));
await page.getByRole("button", { name: "작품 만들기" }).click();
await page.waitForFunction(() => document.querySelectorAll(".scene-item").length === 2);
ok("두 번째 작품 배치", true);
const polylines = await page.locator(".scene-item").nth(1).locator("polyline").count();
const circles = await page.locator(".scene-item").nth(1).locator("circle").count();
ok("별 작품: 구간별 선 2개 + 단일점 원 1개", polylines === 2 && circles === 1, `${polylines}/${circles}`);

// 선택·편집 (버튼·키보드)
const first = page.locator(".scene-item").first();
await first.focus();
await page.keyboard.press("Enter");
await page.getByRole("region", { name: "선택한 작품 편집" }).waitFor();
const before = await first.getAttribute("transform");
await page.getByRole("button", { name: "오른쪽으로 이동" }).click();
await page.keyboard.press("Tab"); // 초점 이동만
const after = await page.locator(".scene-item").first().getAttribute("transform");
ok("방향 버튼으로 이동", before !== after, `${before} → ${after}`);
await page.getByRole("radio", { name: /네온/ }).click();
await page.getByRole("button", { name: "작게" }).click();
await page.locator(".scene-item").first().focus();
await page.keyboard.press("ArrowDown");
ok("편집 후 선택 표시(점선)", (await page.locator('rect[stroke-dasharray="10 6"]').count()) === 1);

// 드래그
const box = await page.locator(".scene-item").nth(1).boundingBox();
const t0 = await page.locator(".scene-item").nth(1).getAttribute("transform");
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 8 });
await page.mouse.up();
const t1 = await page.locator(".scene-item").nth(1).getAttribute("transform");
ok("포인터 드래그 이동", t0 !== t1, `${t0} → ${t1}`);

// 비교 보기 (FR-07)
await page.getByRole("button", { name: "기준선과 전시용 선 비교" }).click();
ok("기준선/전시용 선 비교 표시", await vis(page.getByText(/정규화 기준선 \(\d+점\)/)));
await page.screenshot({ path: join(OUT, "2-room-edit.png"), fullPage: true });

// PNG 내보내기 (FR-11)
await page.getByRole("tab", { name: "이미지" }).click();
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "PNG 저장" }).click()]);
const pngPath = join(OUT, "export.png");
await dl.saveAs(pngPath);
const buf = readFileSync(pngPath);
const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
ok("PNG 1000×750 생성", buf.subarray(1, 4).toString() === "PNG" && w === 1000 && h === 750, `${w}×${h}, ${buf.length}B`);

// 공유: 비로그인은 로그인 안내
await page.getByRole("tab", { name: "공유" }).click();
ok("비로그인 공유 → 로그인 안내", await vis(page.getByText("로그인해 저장한 작품방에서 만들 수 있어요")));
await page.getByRole("button", { name: "로그인하고 저장" }).last().click();
ok("저장 서비스 미설정 안내", await vis(page.getByText("설정되어 있지 않아요")));

// 새로고침 → IndexedDB 임시 초안 복원
await page.waitForTimeout(600);
await page.reload();
await page.locator(".scene-item").first().waitFor();
ok("새로고침 후 임시 초안 복원 (2개)", (await page.locator(".scene-item").count()) === 2);
ok("기기 보관 상태 표시", await vis(page.getByText("이 기기에 24시간 보관")));

// IndexedDB에 원 위경도·시각이 없는지 확인 (AT-11)
const stored = await page.evaluate(
  () =>
    new Promise((res) => {
      const r = indexedDB.open("runcanvas");
      r.onsuccess = () => {
        const g = r.result.transaction("drafts").objectStore("drafts").get("guest");
        g.onsuccess = () => res(JSON.stringify(g.result));
      };
    }),
);
ok("임시 초안에 원 위경도·시각·트랙 이름 없음", !/35\.15|129\.1|2026-10-01T|하트"|별 \(/.test(stored), `${stored.length}B`);

// 오류 파일
await page.locator('input[type="file"]').setInputFiles(join(S, "e2-doctype-entity.gpx"));
ok("DOCTYPE 파일 거절 안내", await vis(page.getByText("DOCTYPE·ENTITY")));
await page.locator('input[type="file"]').setInputFiles(join(S, "e1-route-only.gpx"));
ok("계획 경로 파일 거절 안내", await vis(page.getByText("트랙 기록이 들어 있는 GPX만 지원해요")));
await page.locator('input[type="file"]').setInputFiles(join(S, "e3-bad-coordinate.gpx"));
ok("좌표 오류 위치 안내", await vis(page.getByText("트랙 1, 구간 1의 좌표가 올바르지 않아요")));

// 여러 트랙 선택
await page.locator('input[type="file"]').setInputFiles(join(S, "03-multi-track-prefixed-ns.gpx"));
ok("여러 트랙 선택 안내", await vis(page.getByText("전시할 기록 하나를 선택해 주세요.")));
await page.getByRole("button", { name: /트랙 2/ }).click();
await page.getByRole("button", { name: "작품 만들기" }).click();
await page.waitForFunction(() => document.querySelectorAll(".scene-item").length === 3);
ok("선택한 트랙으로 세 번째 작품", true);

// 모바일 360px (NFR-01)
await page.setViewportSize({ width: 360, height: 780 });
await page.waitForTimeout(300);
const sw = await page.evaluate(() => document.documentElement.scrollWidth);
ok("360px에서 가로 스크롤 없음", sw <= 360, `scrollWidth=${sw}`);
await page.screenshot({ path: join(OUT, "3-room-mobile.png"), fullPage: true });

// 없는 공유 링크
const res = await page.goto(B + "/share/abc");
ok("없는 공유 링크 404 + 안내", res.status() === 404 && (await vis(page.getByText("공유가 종료되었거나 링크를 찾을 수 없어요."))));

ok("브라우저 콘솔 오류 없음", errors.filter((e) => !/404|Failed to load resource/.test(e)).length === 0, errors.join(" | ").slice(0, 300));
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
