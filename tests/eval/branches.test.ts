// (실험) 왕복 가지 붙이기 효과 비교 (BRANCH_EVAL=1 일 때만): npm run eval:branches
// 고정한 실제 지도 데이터에서 동네 고리(지금 방식)와 가지를 붙인 고리를 같은 낙서 인식으로 판정해
// 이름이 붙는 코스 수·확신도를 비교하고, 눈으로 확인할 미리보기를 eval/branch-preview/index.html 로 만든다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { it } from "vitest";
import { DoodleClassifier, rasterizeLoop, type XY } from "@/lib/art/doodle";
import { DOODLE_SKIP, doodleKo } from "@/lib/art/doodleNames";
import type { Recognized } from "@/lib/art/recognize";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import type { RouteCandidate } from "@/lib/route/fit";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox, type OverpassJson } from "@/lib/route/osm";
import { DOODLE_MIN, pickDoodles } from "@/lib/route/present";
import { SHAPES } from "@/lib/route/shapes";

const OUT = "eval/branch-preview";
const FIXTURES = ["gangnam-center", "gangnam-southwest"];
const RANGES = [
  { min: 2000, max: 5000 },
  { min: 3000, max: 8000 },
];

it.skipIf(process.env.BRANCH_EVAL !== "1")(
  "왕복 가지 붙이기: 낙서 인식 비교",
  async () => {
    const dir = "public/models/doodlenet";
    const bin = readFileSync(`${dir}/group1-shard1of1.bin`);
    const clf = await DoodleClassifier.fromMemory(JSON.parse(readFileSync(`${dir}/model.json`, "utf8")), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), readFileSync(`${dir}/class_names.txt`, "utf8"));
    const rot = (p: XY[], d: number) => {
      const a = (d * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      return p.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs] as XY);
    };
    // 화면(recognizeCourses)과 같이: 세 각도 평균, 무늬·단순 도형 갈래 제외
    const recognize = async (xys: XY[][]): Promise<Array<Recognized | null>> => {
      const imgs = xys.flatMap((xy) => [-12, 0, 12].map((d) => rasterizeLoop(rot(xy, d))));
      const out: Array<Recognized | null> = [];
      for (let s = 0; s < imgs.length; s += 300) {
        const guesses = await clf.classify(imgs.slice(s, s + 300), clf.classes.length);
        for (let i = 0; i < guesses.length; i += 3) {
          const avg = new Float64Array(clf.classes.length);
          for (let k = 0; k < 3; k++) for (const gs of guesses[i + k]) avg[gs.index] += gs.prob / 3;
          let best = -1, bp = 0;
          avg.forEach((p, j) => {
            if (!DOODLE_SKIP.has(clf.classes[j]) && p > bp) {
              bp = p;
              best = j;
            }
          });
          out.push(best < 0 ? null : { name: clf.classes[best], prob: bp });
        }
      }
      return out;
    };

    const rows: string[] = [];
    const cards: string[] = [];
    for (const name of FIXTURES)
      for (const range of RANGES) {
        const json = JSON.parse(gunzipSync(readFileSync(`tests/fixtures/osm/${name}.json.gz`)).toString("utf8")) as OverpassJson & { bbox: BBox };
        const g = graphFromOverpass(json, json.bbox, { excludeSteps: true, detail: "simple" });
        const [minX, minY] = project(g.origin, json.bbox.south, json.bbox.west);
        const [maxX, maxY] = project(g.origin, json.bbox.north, json.bbox.east);
        const r = discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: range.min, maxMeters: range.max, region: { minX, minY, maxX, maxY }, budget: new StepBudget(2500), poolSize: 300, branchPool: 300 });
        const toXY = (c: RouteCandidate) => c.latlngs.map(([la, lo]) => project(g.origin, la, lo) as XY);
        const pool = (r.pool ?? []).filter((c) => c.shapeId === "doodle");
        const rec = await recognize(pool.map(toXY));
        const plainIdx = pool.map((c, i) => (c.branchMeters ? -1 : i)).filter((i) => i >= 0);
        const branchIdx = pool.map((c, i) => (c.branchMeters ? i : -1)).filter((i) => i >= 0);
        const stats = (idx: number[]) => {
          const ps = idx.map((i) => rec[i]?.prob ?? 0).sort((a, b) => b - a);
          const over = (t: number) => ps.filter((p) => p >= t).length;
          const names = new Set(idx.filter((i) => (rec[i]?.prob ?? 0) >= DOODLE_MIN).map((i) => rec[i]!.name));
          return { n: idx.length, shown: over(DOODLE_MIN), over50: over(0.5), over70: over(0.7), top: Math.round((ps[0] ?? 0) * 100), names: names.size };
        };
        const a = stats(plainIdx), b = stats(branchIdx);
        // 화면과 같은 고르기: 지금 방식(고리만) vs 가지 포함
        const pickPlain = pickDoodles(plainIdx.map((i) => pool[i]), plainIdx.map((i) => rec[i]));
        const pickAll = pickDoodles(pool, rec);
        const fromBranch = pickAll.filter((c) => c.branchMeters).length;
        const label = `${name} ${range.min / 1000}~${range.max / 1000}km`;
        rows.push(
          `| ${label} | ${a.n} / ${b.n} | ${a.shown} / ${b.shown} | ${a.over50} / ${b.over50} | ${a.over70} / ${b.over70} | ${a.top} / ${b.top} | ${a.names} / ${b.names} | ${pickPlain.length} → ${pickAll.length} (가지 ${fromBranch}) |`,
        );
        // 미리보기: 최종 목록(가지 포함) + 확신 높은 가지 코스
        const show = [...pickAll, ...branchIdx.filter((i) => (rec[i]?.prob ?? 0) >= DOODLE_MIN).sort((x, y) => rec[y]!.prob - rec[x]!.prob).slice(0, 16).map((i) => ({ ...pool[i], shapeName: doodleKo(rec[i]!.name), similarity: Math.round(rec[i]!.prob * 100) }))];
        const seen = new Set<string>();
        cards.push(`<h2>${label}</h2><div class="grid">`);
        for (const c of show) {
          if (seen.has(c.id.replace(/^dd-/, ""))) continue;
          seen.add(c.id.replace(/^dd-/, ""));
          cards.push(card(toXY(c), c.shapeName, c.similarity, c.branchMeters ?? 0, c.lengthMeters));
        }
        cards.push(`</div>`);
      }

    const table = [
      "| 지도·거리 | 후보 수 (고리 / 가지) | 이름 붙음 ≥35% | ≥50% | ≥70% | 최고 확신 % | 서로 다른 이름 | 최종 목록 (고리만 → 가지 포함) |",
      "|---|---|---|---|---|---|---|---|",
      ...rows,
    ].join("\n");
    console.log(`\n${table}\n`);
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/summary.md`, `${table}\n`);
    writeFileSync(
      `${OUT}/index.html`,
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>가지 붙이기 미리보기</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#fafafa;color:#111}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:10px}
figure{margin:0;background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}figure.b{border-color:#e85d04}svg{width:100%;height:auto}figcaption{font-size:12px;line-height:1.4}
.tag{color:#e85d04;font-weight:600}</style>
<h1>왕복 가지 붙이기 미리보기</h1><p>주황 테두리·주황 선 = 왕복 가지를 붙인 코스, 검은 테두리 = 지금 방식(고리만). 낙서 인식 이름과 확신도(%)는 화면과 같은 방식.</p>
<pre>${table}</pre>${cards.join("\n")}`,
    );
  },
  600_000,
);

function card(xy: XY[], name: string, score: number, branch: number, len: number) {
  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const s = 150 / Math.max(maxX - minX, maxY - minY, 1);
  const pts = xy.map(([x, y]) => `${(10 + (x - minX) * s).toFixed(1)},${(10 + (maxY - y) * s).toFixed(1)}`).join(" ");
  const color = branch ? "#e85d04" : "#111";
  return `<figure class="${branch ? "b" : ""}"><svg viewBox="0 0 170 170"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/></svg>
<figcaption><b>${name}</b> ${score}% · ${(len / 1000).toFixed(1)}km${branch ? ` <span class="tag">가지 ${branch}m 왕복</span>` : ""}</figcaption></figure>`;
}
