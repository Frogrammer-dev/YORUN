import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { branchLoops, withBranches } from "@/lib/route/branches";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import { hasEdge, project } from "@/lib/route/graph";
import { buildBlocks, growLoops } from "@/lib/route/loops";
import { graphFromOverpass, type BBox, type OverpassJson } from "@/lib/route/osm";
import { SHAPES } from "@/lib/route/shapes";

describe("왕복 가지 붙이기 (실험)", () => {
  it("가지는 갔던 길 그대로 되돌아와 고리로 이어진다", () => {
    // 고리 0-1-2-3-0, 1에서 가지 1→7→8
    const p = withBranches([0, 1, 2, 3, 0], [{ at: 1, nodes: [1, 7, 8], length: 100 }]);
    expect(p).toEqual([0, 1, 7, 8, 7, 1, 2, 3, 0]);
  });

  const json = JSON.parse(gunzipSync(readFileSync("tests/fixtures/osm/gangnam-center.json.gz")).toString("utf8")) as OverpassJson & { bbox: BBox };
  const g = graphFromOverpass(json, json.bbox, { excludeSteps: true, detail: "simple" });
  const [minX, minY] = project(g.origin, json.bbox.south, json.bbox.west);
  const [maxX, maxY] = project(g.origin, json.bbox.north, json.bbox.east);
  const region = { minX, minY, maxX, maxY };

  it("실제 길로만 이어진 닫힌 경로이고, 길마다 최대 두 번 지나며, 거리 범위 안이다", () => {
    const m = buildBlocks(g, ((maxX - minX) * (maxY - minY)) / 4);
    const loops = growLoops(g, m, region, 1500, 8000, { seeds: 120, budget: new StepBudget(120), fraction: 1 });
    const bs = branchLoops(g, loops, { minMeters: 3000, maxMeters: 8000, max: 60 });
    expect(bs.length).toBeGreaterThan(10);
    for (const b of bs) {
      expect(b.path[0]).toBe(b.path[b.path.length - 1]);
      expect(b.length).toBeGreaterThanOrEqual(2700);
      expect(b.length).toBeLessThanOrEqual(8800);
      const used = new Map<string, number>();
      for (let i = 1; i < b.path.length; i++) {
        const [u, v] = [b.path[i - 1], b.path[i]];
        expect(hasEdge(g, u, v)).toBe(true);
        const k = u < v ? `${u}-${v}` : `${v}-${u}`;
        used.set(k, (used.get(k) ?? 0) + 1);
      }
      for (const c of used.values()) expect(c).toBeLessThanOrEqual(2);
    }
  });

  it("끄면 동네 추천 결과가 그대로, 켜면 가지 코스가 낙서 인식 후보에 더해진다", () => {
    const run = (branchPool: number) =>
      discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: 3000, maxMeters: 8000, region, budget: new StepBudget(800), poolSize: 50, branchPool });
    const off = run(0), on = run(80);
    expect(off.pool!.some((c) => c.branchMeters)).toBe(false);
    const branched = on.pool!.filter((c) => c.branchMeters);
    expect(branched.length).toBeGreaterThan(0);
    for (const c of branched) expect(c.repeatRatio).toBeGreaterThan(0);
    expect(on.candidates.every((c) => c.lengthMeters >= 3000 * 0.85)).toBe(true);
  }, 120_000);
});
