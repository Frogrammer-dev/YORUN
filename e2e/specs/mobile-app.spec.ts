// 모바일 앱 셸·시트·달리기 HUD 회귀 시험 (--project=mobile, 기본 360×780)
// 길 데이터는 가짜 바둑판이다. 여기서 보는 것은 레이아웃과 탐색 영역 값이며, 경로 모양·인식 품질의 근거가 아니다.
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, searchCourses, test, waitForMap } from "../fixtures";

const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

async function heartInRoom(page: Page) {
  await page.goto("/contents");
  await page.waitForLoadState("networkidle");
  await page.locator('input[type="file"]').setInputFiles(join("samples", "01-heart-single-segment.gpx"));
  await page.getByRole("button", { name: "작품 만들기" }).click();
  await page.waitForURL("**/room");
  await expect(page.locator(".scene-item")).toHaveCount(1);
}

test.describe("앱 셸", () => {
  test("@mobile 탭 3개: 표시, aria-current, 48px 이상, 탭으로 이동", async ({ page }) => {
    for (const [path, label] of [["/", "메인"], ["/routes", "러닝"], ["/hub", "콘텐츠"]] as const) {
      await page.goto(path);
      const nav = page.getByRole("navigation", { name: "주요 메뉴" });
      await expect(nav.getByRole("link")).toHaveCount(3);
      await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(nav.locator('[aria-current="page"]')).toHaveText(label);
      for (const link of await nav.getByRole("link").all()) expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    }
    await page.getByRole("navigation", { name: "주요 메뉴" }).getByRole("link", { name: "콘텐츠" }).click();
    await page.waitForURL("**/hub");
    await expect(page.getByRole("heading", { name: "콘텐츠 허브", level: 1 })).toBeVisible();
  });

  test("@mobile 콘텐츠 탭: 세 입구, 대결 화면의 탭 유지, 지도 자료 출처", async ({ page }) => {
    await page.goto("/hub");
    const nav = page.getByRole("navigation", { name: "주요 메뉴" });
    for (const href of ["/room", "/duel", "/derby"]) await expect(page.locator(`.content-menu-card[href="${href}"]`)).toBeVisible();
    await expect(page.getByRole("link", { name: "© OpenStreetMap contributors" })).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    for (const [href, heading] of [["/duel", "1대1 플레이어 대결"], ["/derby", "8인 드로잉 더비"]]) {
      await page.goto("/hub");
      await page.locator(`.content-menu-card[href="${href}"]`).click();
      await page.waitForURL("**" + href);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
      await expect(nav.locator('[aria-current="page"]')).toHaveText("콘텐츠");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    }
    await page.getByRole("link", { name: "콘텐츠로 돌아가기" }).click();
    await page.waitForURL("**/hub");
  });

  test("@mobile 데이터와 계정: 확인 뒤 기기 데이터만 지우고, 달리는 중에는 막는다", async ({ page }) => {
    await page.goto("/hub");
    await page.getByRole("link", { name: /데이터와 계정/ }).click();
    await page.waitForURL("**/settings");
    await page.evaluate(() => {
      localStorage.setItem("runcanvas.route", "{}");
      localStorage.setItem("runcanvas.runLog", "[]");
      localStorage.setItem("yorun.battle.draft.a", "{}");
      localStorage.setItem("yorun.voice", "on");
    });
    const open = page.getByRole("button", { name: "이 기기 데이터 지우기" });
    await open.click();
    await page.getByRole("button", { name: "취소" }).click();
    expect(await page.evaluate(() => localStorage.getItem("runcanvas.route"))).toBe("{}");

    await page.evaluate(() => localStorage.setItem("runcanvas.activeRun", JSON.stringify({ record: { resumedAt: 5 } })));
    await open.click();
    await page.getByRole("button", { name: "이 기기 데이터 지우기" }).click();
    await expect(page.getByRole("status")).toContainText("끝내지 않은 달리기");
    expect(await page.evaluate(() => localStorage.getItem("runcanvas.route"))).toBe("{}");

    await page.evaluate(() => localStorage.removeItem("runcanvas.activeRun"));
    await open.click();
    await page.getByRole("button", { name: "이 기기 데이터 지우기" }).click();
    await expect(page.getByRole("status")).toContainText("이 기기의 데이터를 지웠어요");
    expect(await page.evaluate(() => Object.keys(localStorage).sort())).toEqual(["yorun.voice"]);
    await expect(page.getByRole("button", { name: "계정 영구 삭제" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "로그인하러 가기" })).toBeVisible();
  });

  test("@mobile 로그인 화면: 저장 서비스가 없으면 안내하고 탭 없이 메인으로 돌아간다", async ({ page }) => {
    await page.goto("/login?next=//evil.example");
    await expect(page.getByRole("heading", { name: "요런 계정으로 계속하기", level: 1 })).toBeVisible();
    await expect(page.getByText("저장 서비스(Supabase)가 설정되어 있지 않아요")).toBeVisible();
    await expect(page.locator(".tabbar")).toHaveCount(0);
    await page.getByRole("link", { name: "메인으로 돌아가기" }).click();
    await page.waitForURL((url) => url.pathname === "/");
  });

  test("@mobile 개인정보 처리방침: 콘텐츠 탭에서 열리고 미입력 항목을 숨기지 않는다", async ({ page }) => {
    await page.goto("/hub");
    await page.getByRole("link", { name: "개인정보 처리방침" }).click();
    await page.waitForURL("**/privacy");
    await expect(page.getByRole("heading", { name: "개인정보 처리방침", level: 1 })).toBeVisible();
    await expect(page.getByText("아직 초안이에요")).toBeVisible();
    await expect(page.getByText("입력 필요").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test("@mobile 탭 없는 화면: /run, /contents, /share", async ({ page, allowedErrors }) => {
    allowedErrors.push(/404/);
    for (const path of ["/run", "/contents", "/share/abc"]) {
      await page.goto(path);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator(".tabbar"), path).toHaveCount(0);
    }
  });

  test("@mobile 기록 가져오기: 예시 데모와 개인정보 안내가 남아 있고, 뒤로 버튼은 들어온 화면으로", async ({ page }) => {
    await page.goto("/hub");
    await page.getByRole("link", { name: "GPX 불러오기" }).click();
    await page.waitForURL("**/contents");
    await expect(page.getByRole("button", { name: /예시 기록으로 둘러보기/ })).toBeVisible();
    await expect(page.getByText("지원 파일과 개인정보 안내")).toBeVisible();
    await page.getByRole("button", { name: "뒤로가기" }).click();
    await page.waitForURL("**/hub");
  });

  test("@mobile 탭이 CTA·마지막 행을 가리지 않는다", async ({ page }) => {
    await page.goto("/");
    const tabTop = (await box(page, ".tabbar")).y;
    const cta = await box(page, ".hub-start .btn");
    expect(cta.y + cta.height).toBeLessThanOrEqual(tabTop);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const last = page.locator(".hub-row").last();
    await last.scrollIntoViewIfNeeded();
    const lastBox = (await last.boundingBox())!;
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual((await box(page, ".tabbar")).y);
  });

  test("@mobile 390×844 홈: 스크롤 없이 첫 행동이 보인다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const cta = await box(page, ".hub-start .btn");
    expect(cta.y + cta.height).toBeLessThanOrEqual(844 - 56);
    await expect(page.locator(".hub-row").first()).toBeInViewport();
  });

  test("@mobile 이어 달리기: 저장된 기록이 있으면 홈 맨 위, 없으면 표시 안 함", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".hub-resume")).toHaveCount(0);
    await page.evaluate(() => {
      localStorage.setItem("runcanvas.activeRun", JSON.stringify({ routeId: null, savedAt: Date.now(), record: { segments: [[{ lat: 35.15, lon: 129.11, time: 1 }, { lat: 35.151, lon: 129.11, time: 2 }]], distanceMeters: 1230, activeMs: 60000, startedAt: 1, resumedAt: null } }));
    });
    await page.goto("/");
    await expect(page.locator(".hub-resume")).toContainText("끝내지 않은 달리기 1.23km");
    const banner = await box(page, ".hub-resume");
    expect(banner.y).toBeLessThan((await box(page, ".hub-start")).y);
    await page.locator(".hub-resume").click();
    await page.waitForURL("**/run");
    await expect(page.getByText(/끝내지 않은 달리기/)).toBeVisible();
  });

  test("@mobile 360·320px 어느 화면도 가로 스크롤이 없다", async ({ page }) => {
    for (const width of [360, 320]) {
      await page.setViewportSize({ width, height: 640 });
      for (const path of ["/", "/running", "/room", "/contents", "/routes", "/run"]) {
        await page.goto(path);
        await page.waitForLoadState("load");
        await page.waitForTimeout(300);
        expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width} ${path}`).toBeLessThanOrEqual(width);
      }
    }
  });
});

test.describe("작품방", () => {
  test("@mobile 빈 상태는 캔버스 하나로, 첫 행동 두 개", async ({ page }) => {
    await page.goto("/room");
    await expect(page.locator(".stage-empty")).toBeVisible();
    await expect(page.locator(".stage-empty").getByRole("link", { name: "코스 찾아 달리기" })).toHaveAttribute("href", "/routes");
    await expect(page.locator(".stage-empty").getByRole("link", { name: "기록 가져오기" })).toBeVisible();
    await expect(page.locator(".empty-state")).toHaveCount(0);
  });

  test("@mobile 편집 중에는 탭을 숨기고 패널은 하단 시트, 씬 주변에 빈 테두리가 없다", async ({ page }) => {
    await heartInRoom(page);
    await expect(page.locator(".tabbar")).toBeVisible();
    await page.locator(".scene-item").first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "선택한 작품 편집" })).toBeVisible();
    await expect(page.locator(".tabbar")).toBeHidden();
    const scene = await box(page, ".scene");
    expect(scene.width / scene.height).toBeCloseTo(4 / 3, 1);
    const sheet = await box(page, ".side");
    expect(sheet.y).toBeGreaterThanOrEqual(scene.y + scene.height - 1);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(780 + 1);
    // 십자 패드는 접혀 있지만 없어지지 않았다
    await expect(page.getByRole("button", { name: "오른쪽으로 이동" })).toBeHidden();
    await page.getByText("정밀 이동").click();
    await expect(page.getByRole("button", { name: "오른쪽으로 이동" })).toBeVisible();
    await page.getByRole("button", { name: "닫기" }).click();
    await expect(page.locator(".tabbar")).toBeVisible();
  });
});

test.describe("코스 찾기", () => {
  // 작업 전(19671aa)에 같은 위치·화면에서 실측한 값. 접힌 상태의 탐색 영역이 바뀌면 안 된다.
  const BEFORE_360 = { mapHeight: 414, bbox: { south: 35.14724890664041, north: 35.16177520742384, west: 129.1062641143799, east: 129.1217136383057 } };

  test("@mobile 지도 높이와 탐색 영역은 시트 상태와 무관하고 작업 전과 같다", async ({ page, apiCalls }) => {
    test.setTimeout(240_000);
    await page.goto("/routes");
    await waitForMap(page);
    expect((await box(page, ".finder-map")).height).toBe(BEFORE_360.mapHeight);
    await expect(page.getByText(/화면 영역 1\.4×1\.6km/)).toBeVisible();

    // 펼쳐도 지도 크기와 표시되는 영역은 그대로
    await page.getByRole("button", { name: "시트 펼치기" }).click();
    await page.waitForTimeout(400);
    expect((await box(page, ".finder-map")).height).toBe(BEFORE_360.mapHeight);
    await expect(page.getByText(/화면 영역 1\.4×1\.6km/)).toBeAttached();
    const sheet = await box(page, ".finder-side");
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(780 + 1); // 예전에는 약 62px 잘렸다

    // 펼친 채 찾아도 접힌 기준과 같은 영역을 찾는다
    await searchCourses(page);
    const b = apiCalls.overpass[0];
    for (const k of ["south", "north", "west", "east"] as const) expect(b[k], k).toBeCloseTo(BEFORE_360.bbox[k], 6);

    // 결과가 나와도 지도는 줄지 않는다
    expect((await box(page, ".finder-map")).height).toBe(BEFORE_360.mapHeight);
  });

  test("@mobile 결과: 후보는 가로 카드, 썸네일 96px 이상, 찾기 버튼 없이 달리기 CTA 하나", async ({ page }) => {
    await page.route("**/api/recognition", (route) => route.fulfill({ status: 503, json: { error: "model_unavailable" } }));
    await page.goto("/routes");
    await waitForMap(page);
    await searchCourses(page);
    const first = await box(page, ".cand");
    const thumb = await box(page, ".cand-thumb");
    expect(thumb.width).toBeGreaterThanOrEqual(96);
    expect(await page.locator(".cand").count()).toBeGreaterThan(1);
    expect((await page.locator(".cand").nth(1).boundingBox())!.x).toBeGreaterThan(first.x + first.width - 1);
    await expect(page.getByRole("button", { name: /이 코스로 달리기/ })).toBeInViewport();
    await expect(page.getByRole("button", { name: "지금 보이는 지도에서 코스 찾기" })).toBeHidden();
    // 후보 카드에는 참고 그림이 없고 실제 경로 선만 있다
    await expect(page.locator(".cand .shape-explanation")).toHaveCount(0);
    await expect(page.locator(".cand-thumb path").first()).toHaveAttribute("stroke", "#0EA5E9");
    // 안전 고지는 결과 화면에 남아 있다
    await expect(page.getByText(/통행 가능 여부/)).toBeAttached();
    // 상세로 갔다가 돌아오기
    await page.getByRole("button", { name: /코스 자세히/ }).click();
    await expect(page.getByLabel("코스 길 정보")).toBeVisible();
    await page.getByRole("button", { name: /찾은 코스 \d+개/ }).click();
    await expect(page.locator(".cand").first()).toBeVisible();
    // 조건은 접혀 있어도 AI 토글에 닿을 수 있다
    await page.getByRole("button", { name: "조건 바꾸기" }).click();
    await expect(page.getByRole("switch", { name: /AI 선 그림 해석/ })).toBeHidden();
    await page.getByRole("button", { name: /조건 더 보기/ }).click();
    await expect(page.getByRole("switch", { name: /AI 선 그림 해석/ })).toBeChecked();
  });

  test("@mobile 상단은 뒤로·검색 한 줄이고 뒤로는 달리기 탭으로 고정 이동", async ({ page }) => {
    await page.goto("/routes");
    await waitForMap(page);
    await expect(page.locator(".map-pill")).toHaveCount(0);
    const back = await box(page, ".map-tl .map-fab");
    const search = await box(page, ".place-search");
    expect(Math.abs(back.y - search.y)).toBeLessThanOrEqual(1);
    await page.getByRole("link", { name: "달리기 화면으로 돌아가기" }).click();
    await page.waitForURL("**/running");
  });

  test("@mobile 줌·출처 버튼 터치 영역 44px", async ({ page }) => {
    await page.goto("/routes");
    await waitForMap(page);
    for (const s of [".leaflet-control-zoom-in", ".leaflet-control-zoom-out", ".attr-toggle"]) {
      const b = await box(page, s);
      expect(b.width, s).toBeGreaterThanOrEqual(44);
      expect(b.height, s).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe("달리기", () => {
  const AT = { latitude: 35.1545, longitude: 129.114 };

  test("@mobile 종료 확인 때 버튼 위치·폭이 그대로, 두 번 눌러야 끝나고, 달리는 중 줌은 숨긴다", async ({ page, context }) => {
    await context.setGeolocation({ ...AT, accuracy: 8 });
    await page.goto("/run");
    await page.locator(".leaflet-container").waitFor();
    await expect(page.locator(".leaflet-control-zoom")).toBeVisible();
    await page.getByRole("button", { name: /시작/ }).click();
    await expect(page.getByRole("button", { name: /일시정지/ })).toBeVisible();
    await expect(page.locator(".leaflet-control-zoom")).toBeHidden();
    const hold = await box(page, ".btn-run.hold");
    const end = await box(page, ".btn-run.end");
    expect(end.height).toBeGreaterThanOrEqual(72);
    await page.getByRole("button", { name: "종료" }).click();
    await expect(page.getByRole("button", { name: "한 번 더 눌러 종료" })).toBeVisible();
    expect(await box(page, ".btn-run.hold")).toEqual(hold);
    expect(await box(page, ".btn-run.end")).toEqual(end);
    await expect(page.getByRole("heading", { name: "달리기 완료" })).toHaveCount(0);
    await page.getByRole("button", { name: "한 번 더 눌러 종료" }).click();
    await expect(page.getByRole("heading", { name: "달리기 완료" })).toBeVisible();
    // 완료 화면: 작품방에 걸기는 스크롤 없이 화면 안
    await expect(page.getByRole("button", { name: /작품방에 걸기/ })).toBeInViewport({ ratio: 1 });
  });

  test("@mobile 음성 버튼 아이콘이 배경과 구분된다", async ({ page }) => {
    await page.goto("/run");
    await page.locator(".leaflet-container").waitFor();
    const voice = page.locator('.run-top-row .map-fab[aria-pressed]');
    const look = () => voice.evaluate((e) => { const s = getComputedStyle(e); return { fg: s.color, bg: s.backgroundColor, pressed: e.getAttribute("aria-pressed") }; });
    const first = await look();
    expect(first.fg).not.toBe(first.bg);
    await voice.click();
    const second = await look();
    expect(second.pressed).not.toBe(first.pressed);
    expect(second.fg).not.toBe(second.bg);
  });

  test("@mobile 달리는 중 화면을 떠나면 5초를 기다리지 않고 저장한다", async ({ page, context }) => {
    await context.setGeolocation({ ...AT, accuracy: 8 });
    await page.goto("/running");
    await page.locator("a.hub-row[href='/run']").click();
    await page.waitForURL("**/run");
    await page.getByRole("button", { name: /시작/ }).click();
    await expect(page.getByRole("button", { name: /일시정지/ })).toBeVisible();
    await page.goBack();
    await page.waitForURL("**/running");
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("runcanvas.activeRun") ?? "null"));
    expect(saved?.record).toBeTruthy();
    expect(saved.finished).toBeUndefined();
  });
});
