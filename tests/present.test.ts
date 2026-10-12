import { describe, expect, it } from "vitest";
import { DOODLE_MAX, DOODLE_MIN, courseBadge, courseTitle, moveLines, nameDiscoveries, pickDoodles, pixelToLatLng } from "@/lib/route/present";
import { groupFromLoops } from "@/lib/route/shapes";
import { placeShape } from "@/lib/route/fit";
import { makeOrigin, unproject } from "@/lib/route/graph";
import { makeCandidate } from "./helpers/candidate";

/** 서로 겹치지 않는 자리의 코스 n개 */
const spread = (n: number) => Array.from({ length: n }, (_, i) => makeCandidate({}, [37.5 + i * 0.05, 127]));

describe("낙서 인식 결과 고르기", () => {
  it("CLIP uses its rejection decision, not the legacy probability threshold", () => {
    const pool = spread(3);
    const out = pickDoodles(pool, [
      { name: "hammer", label: "망치", prob: .32, model: "clip", accepted: true, margin: .006 },
      { name: "sheep", prob: .95, model: "clip", accepted: false },
      { name: "phone", prob: .95, model: "clip" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].shapeName).toBe("망치");
    expect(courseBadge(out[0])).toBe("AI 해석 · 실험");
    expect(out[0].latlngs).toEqual(pool[0].latlngs);
  });
  it("확신이 기준 미만이거나 판정 못 한 코스는 빼고, 확신 높은 순으로", () => {
    const pool = spread(4);
    const out = pickDoodles(pool, [{ name: "sheep", prob: 0.5 }, null, { name: "owl", prob: DOODLE_MIN - 0.01 }, { name: "lion", prob: 0.9 }]);
    expect(out.map((c) => c.shapeName)).toEqual(["사자", "양"]);
    expect(out[0]).toMatchObject({ shapeId: "doodle", similarity: 90, outline: [], outlines: [], doodle: { name: "lion" } });
    expect(out[0].id).toBe(`dd-${pool[3].id}`);
  });

  it("같은 이름은 2개까지, 전체는 최대 8개", () => {
    const pool = spread(12);
    const out = pickDoodles(pool, pool.map((_, i) => ({ name: i < 5 ? "sheep" : `x${i}`, prob: 0.9 - i * 0.01 })));
    expect(out.filter((c) => c.doodle!.name === "sheep")).toHaveLength(2);
    expect(out).toHaveLength(DOODLE_MAX);
  });

  it("같은 자리(겹치는 코스)는 하나만", () => {
    const a = makeCandidate({}, [37.5, 127]), b = makeCandidate({}, [37.5, 127.0001]);
    const out = pickDoodles([a, b], [{ name: "sheep", prob: 0.9 }, { name: "owl", prob: 0.8 }]);
    expect(out).toHaveLength(1);
  });
});

describe("동네 추천 목록 만들기", () => {
  it("이름 붙인 코스를 앞에, 자리가 겹치지 않는 도형 코스를 뒤에", async () => {
    const templ = spread(3);
    const pool = [templ[0], makeCandidate({}, [38, 127])];
    const r = await nameDiscoveries(templ, pool, async () => [{ name: "sheep", prob: 0.9 }, null], 1000);
    expect(r.doodleError).toBe(false);
    expect(r.candidates.map((c) => c.shapeName)).toEqual(["양", "네모", "네모"]); // templ[0]은 '양'과 같은 자리라 빠짐
  });

  it("인식이 실패하면 도형 코스만 + 오류 표시", async () => {
    const templ = spread(2);
    const r = await nameDiscoveries(templ, templ, async () => Promise.reject(new Error("no webgl")), 1000);
    expect(r).toEqual({ candidates: templ, doodleError: true });
  });

  it("인식이 시간 제한을 넘기면 기다리지 않는다", async () => {
    const templ = spread(1);
    const t = Date.now();
    const r = await nameDiscoveries(templ, templ, () => new Promise(() => {}), 50);
    expect(r.doodleError).toBe(true);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});

describe("목록 표시 문구", () => {
  it("낙서 인식·동네 추천·지정 그림 제목과 배지", () => {
    const doodle = makeCandidate({ shapeName: "양", similarity: 72, doodle: { name: "sheep", prob: 0.72 } });
    const templ = makeCandidate({ shapeName: "하트", similarity: 81 });
    expect(courseTitle(doodle, true)).toBe("양처럼 보이는 코스");
    expect(courseTitle(templ, true)).toBe("하트 닮은 코스");
    expect(courseTitle(templ, false)).toBe("하트");
    expect(courseBadge(doodle)).toBe("인식 · 또렷함"); // 72 ≥ 또렷함 기준 (잠정 70)
    expect(courseBadge({ ...doodle, similarity: 40 })).toBe("인식 · 희미함");
    expect(courseBadge(templ)).toBe("유사도 81");
  });

  it("이동 구간 좌표 (끝 점 포함)", () => {
    const c = makeCandidate({ moves: [[1, 3]] });
    expect(moveLines(c)).toEqual([c.latlngs.slice(1, 4)]);
    expect(moveLines(makeCandidate())).toEqual([]);
  });
});

describe("이미지 겹쳐 보기 위치", () => {
  it("회전·확대·이동해 놓은 그림에서, 이미지의 윤곽 꼭짓점이 지도 외곽선 꼭짓점에 겹친다", () => {
    // 이미지 안의 오각형 윤곽 (화면 픽셀, y 아래로)
    const px: [number, number][] = [[60, 30], [200, 50], [180, 150], [90, 160], [40, 100]];
    const part = groupFromLoops([px])!.parts[0];
    const o = makeOrigin(35.15, 129.1);
    const outline = placeShape(part.shape.points, { cx: 300, cy: -120, scale: 900, rotDeg: 37 }).map(([x, y]) => unproject(o, x, y));
    const toLL = pixelToLatLng(part.shape.points, outline, part.frame!)!;
    for (const [u, v] of px) {
      const [lat, lon] = toLL(u, v);
      const nearest = Math.min(...outline.map(([a, b]) => Math.hypot(a - lat, b - lon)));
      expect(nearest).toBeLessThan(1e-6); // 약 0.1m
    }
  });
});
