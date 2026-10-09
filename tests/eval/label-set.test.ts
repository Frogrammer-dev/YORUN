// 사람 판정용 평가 세트 만들기 (MAKE_LABEL_SET=1 일 때만): npm run eval:make-set
// 고정한 실제 지도 데이터(tests/fixtures/osm)에서 단계 예산으로 코스를 모으고, 화면과 같은 방식으로 이름·점수를 붙여
// eval/label-set/index.html 한 파일로 만든다. 브라우저로 열어 코스마다 '알아볼 수 있음/없음'을 고르고 결과 JSON을 저장한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { it } from "vitest";
import { DoodleClassifier, rasterizeLoop, type XY } from "@/lib/art/doodle";
import { DOODLE_SKIP, doodleKo } from "@/lib/art/doodleNames";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import type { RouteCandidate } from "@/lib/route/fit";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox, type OverpassJson } from "@/lib/route/osm";
import { SHAPES } from "@/lib/route/shapes";

const OUT = "eval/label-set";
const FIXTURES = ["gangnam-center", "gangnam-southwest"];

interface LabelItem {
  id: string;
  /** doodle: 낙서 인식 이름, template: 도형 맞추기 이름 */
  kind: "doodle" | "template";
  name: string;
  score: number;
  /** 화면 비율 그대로의 코스 선 (x 오른쪽, y 위쪽, 미터) */
  line: XY[];
  /** 도형 맞추기면 원래 그림 외곽선 */
  outline?: XY[];
}

it.skipIf(process.env.MAKE_LABEL_SET !== "1")(
  "사람 판정용 평가 세트 만들기",
  async () => {
    const dir = "public/models/doodlenet";
    const bin = readFileSync(`${dir}/group1-shard1of1.bin`);
    const clf = await DoodleClassifier.fromMemory(JSON.parse(readFileSync(`${dir}/model.json`, "utf8")), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), readFileSync(`${dir}/class_names.txt`, "utf8"));
    const items: LabelItem[] = [];
    for (const name of FIXTURES) {
      const json = JSON.parse(gunzipSync(readFileSync(`tests/fixtures/osm/${name}.json.gz`)).toString("utf8")) as OverpassJson & { bbox: BBox };
      const g = graphFromOverpass(json, json.bbox, { excludeSteps: true, detail: "simple" });
      const [minX, minY] = project(g.origin, json.bbox.south, json.bbox.west);
      const [maxX, maxY] = project(g.origin, json.bbox.north, json.bbox.east);
      const r = discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: 3000, maxMeters: 8000, region: { minX, minY, maxX, maxY }, budget: new StepBudget(2500), poolSize: 150 });
      const toXY = (c: RouteCandidate) => c.latlngs.map(([la, lo]) => project(g.origin, la, lo) as XY);
      // 도형 맞추기 결과: 점수(유사도) 고르게
      for (const c of [...r.candidates, ...(r.pool ?? []).filter((p) => p.shapeId !== "doodle")].slice(0, 60))
        items.push({ id: `${name}:t:${c.id}`, kind: "template", name: c.shapeName, score: c.similarity, line: toXY(c), outline: c.outline.map(([la, lo]) => project(g.origin, la, lo) as XY) });
      // 낙서 인식: 화면과 같이 세 각도 평균, 무늬 갈래 제외
      const pool = r.pool ?? [];
      const rot = (p: XY[], d: number) => {
        const a = (d * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
        return p.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs] as XY);
      };
      const imgs = pool.flatMap((c) => [-12, 0, 12].map((d) => rasterizeLoop(rot(toXY(c), d))));
      const guesses = await clf.classify(imgs, clf.classes.length);
      pool.forEach((c, i) => {
        const avg = new Float64Array(clf.classes.length);
        for (let k = 0; k < 3; k++) for (const gs of guesses[i * 3 + k]) avg[gs.index] += gs.prob / 3;
        let best = -1, bp = 0;
        avg.forEach((p, j) => {
          if (!DOODLE_SKIP.has(clf.classes[j]) && p > bp) {
            bp = p;
            best = j;
          }
        });
        if (best >= 0 && bp >= 0.2) items.push({ id: `${name}:d:${c.id}`, kind: "doodle", name: doodleKo(clf.classes[best]), score: Math.round(bp * 100), line: toXY(c) });
      });
    }
    // 한 사람이 10분 안팎에 끝낼 수 있게, 점수 구간(10점)마다 고르게 뽑는다: 낙서 인식 120개 + 도형 60개
    let s = 7;
    const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const stratified = (kind: LabelItem["kind"], total: number) => {
      const bins = new Map<number, LabelItem[]>();
      for (const it of items.filter((i) => i.kind === kind)) {
        const b = Math.floor(it.score / 10);
        if (!bins.has(b)) bins.set(b, []);
        bins.get(b)!.push(it);
      }
      const per = Math.ceil(total / Math.max(1, bins.size));
      return [...bins.values()].flatMap((list) => list.sort(() => rand() - 0.5).slice(0, per)).slice(0, total);
    };
    const picked = [...stratified("doodle", 120), ...stratified("template", 60)];
    items.length = 0;
    items.push(...picked);
    // 판정하는 사람이 점수에 끌리지 않도록 순서를 섞는다 (고정 시드)
    items.sort(() => rand() - 0.5);
    mkdirSync(OUT, { recursive: true });
    const tpl = readFileSync("tests/eval/label-page.html", "utf8");
    writeFileSync(`${OUT}/index.html`, tpl.replace("/*__ITEMS__*/[]", JSON.stringify(items)));
    console.log(`평가 세트 ${items.length}개 → ${OUT}/index.html`);
  },
  900_000,
);
