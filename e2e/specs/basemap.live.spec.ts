// @live 실제 바탕 지도 서버 접속 확인 (가짜 응답 없음, 기본 실행에서 제외): npm run test:e2e:live
// 키 없이 OpenFreeMap 스타일·타일이 뜨는지, 키가 필요하거나 막힌 서버를 쓰지 않는지 본다.
import { expect, test } from "../fixtures";

for (const [path, label] of [
  ["/routes", "단순 지도"],
  ["/run", "기본 지도(한국어 지명)"],
] as const) {
  test(`@live ${path} ${label}가 키 없이 뜬다`, async ({ page }) => {
    const reqs: Array<{ url: string; status: number }> = [];
    page.on("response", (r) => reqs.push({ url: r.url(), status: r.status() }));
    await page.goto(path);
    await page.locator(".leaflet-container").waitFor();
    await page.waitForTimeout(7000);
    expect(reqs.some((r) => /openfreemap\.org\/styles\//.test(r.url) && r.status === 200), "스타일 받음").toBe(true);
    expect(reqs.filter((r) => /cartocdn\.com|tile\.openstreetmap\.org/.test(r.url)), "키 필요·차단 서버 사용 안 함").toEqual([]);
    await expect(page.getByText(/바탕 지도(를 불러오지 못했어요| 없음)/)).toHaveCount(0);
    expect(await page.locator(".leaflet-gl-layer, canvas.maplibregl-canvas").count()).toBeGreaterThan(0);
  });
}
