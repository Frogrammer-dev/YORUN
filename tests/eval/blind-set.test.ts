// 블라인드 판정 세트 (BLIND_SET=1 일 때만): npm run eval:blind-set
// 세 방식의 코스를 같은 수만큼 뽑아 섞고, 어느 방식인지·의도한 이름을 숨긴 채 판정받기 위한 세트를 만든다.
//   doodle   — 지금 동네 추천: 낙서 인식이 이름 붙인 동네 고리 (화면과 같은 고르기)
//   discover — 동네 고리를 기본 그림에 맞춘 결과 (동네 추천의 도형 결과)
//   shape    — 그림을 지정해 길에 맞춘 결과 (그림 지정 모드)
// 출력: eval/blind/items.json (그림 좌표만), eval/blind/key.json (정답·방식·점수 — 판정 전에는 열지 않는다)
// 썸네일 PNG는 node tests/eval/blind-shots.mjs 로 만든다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { it } from "vitest";
import { DoodleClassifier, rasterizeLoop, type XY } from "@/lib/art/doodle";
import { DOODLE_SKIP } from "@/lib/art/doodleNames";
import type { Recognized } from "@/lib/art/recognize";
import { StepBudget } from "@/lib/route/budget";
import { discoverRoutes } from "@/lib/route/discover";
import type { RouteCandidate } from "@/lib/route/fit";
import { project } from "@/lib/route/graph";
import { graphFromOverpass, type BBox, type OverpassJson } from "@/lib/route/osm";
import { pickDoodles, SIMILARITY_MIN } from "@/lib/route/present";
import { SHAPES, SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";

const OUT = "eval/blind";
const FIXTURES = ["gangnam-center", "gangnam-southwest"];
const RANGES = [
  { min: 2000, max: 5000 },
  { min: 3000, max: 8000 },
];
/** 조건(지도×거리)마다 방식별로 뽑을 수 → 4조건 × 5 = 방식마다 20개 */
const PER = 5;
/** 그림 지정 모드로 찾아볼 그림 (조건마다 돌아가며) */
const SHAPE_IDS: ShapeId[] = ["heart", "star", "cat", "fish", "bolt", "house", "tree", "rabbit", "whale", "apple", "triangle", "butterfly"];

type Method = "doodle" | "discover" | "shape";
interface KeyItem {
  id: string;
  method: Method;
  /** 의도한(붙인) 이름 */
  name: string;
  /** 낙서 인식 확신도 또는 도형 유사도 (0~100) */
  score: number;
  lengthMeters: number;
  condition: string;
}

it.skipIf(process.env.BLIND_SET !== "1")(
  "블라인드 판정 세트 만들기",
  async () => {
    const dir = "public/models/doodlenet";
    const bin = readFileSync(`${dir}/group1-shard1of1.bin`);
    const clf = await DoodleClassifier.fromMemory(JSON.parse(readFileSync(`${dir}/model.json`, "utf8")), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), readFileSync(`${dir}/class_names.txt`, "utf8"));
    const rot = (p: XY[], d: number) => {
      const a = (d * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
      return p.map(([x, y]) => [x * cs - y * sn, x * sn + y * cs] as XY);
    };
    // 화면(recognizeCourses)과 같은 판정: 세 각도 평균, 무늬 갈래 제외
    const recognize = async (xys: XY[][]): Promise<Array<Recognized | null>> => {
      const out: Array<Recognized | null> = [];
      for (let s = 0; s < xys.length; s += 100) {
        const chunk = xys.slice(s, s + 100);
        const guesses = await clf.classify(chunk.flatMap((xy) => [-12, 0, 12].map((d) => rasterizeLoop(rot(xy, d)))), clf.classes.length);
        for (let i = 0; i < chunk.length; i++) {
          const avg = new Float64Array(clf.classes.length);
          for (let k = 0; k < 3; k++) for (const gs of guesses[i * 3 + k]) avg[gs.index] += gs.prob / 3;
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

    const lines: Array<{ line: XY[]; key: Omit<KeyItem, "id"> }> = [];
    let shapeTurn = 0;
    for (const name of FIXTURES) {
      const json = JSON.parse(gunzipSync(readFileSync(`tests/fixtures/osm/${name}.json.gz`)).toString("utf8")) as OverpassJson & { bbox: BBox };
      const g = graphFromOverpass(json, json.bbox, { excludeSteps: true, detail: "simple" });
      const [minX, minY] = project(g.origin, json.bbox.south, json.bbox.west);
      const [maxX, maxY] = project(g.origin, json.bbox.north, json.bbox.east);
      const region = { minX, minY, maxX, maxY };
      const toXY = (c: RouteCandidate) => c.latlngs.map(([la, lo]) => project(g.origin, la, lo) as XY);
      for (const range of RANGES) {
        const condition = `${name} ${range.min / 1000}~${range.max / 1000}km`;
        const add = (c: RouteCandidate, method: Method, label: string, score: number) =>
          lines.push({ line: toXY(c), key: { method, name: label, score, lengthMeters: c.lengthMeters, condition } });

        // 동네 추천 (화면과 같은 흐름)
        const r = discoverRoutes(g, { mode: "discover", shapes: SHAPES, minMeters: range.min, maxMeters: range.max, region, budget: new StepBudget(2500), poolSize: 300 });
        const templ = r.candidates.filter((c) => c.similarity >= SIMILARITY_MIN);
        for (const c of templ.slice(0, PER)) add(c, "discover", c.shapeName, c.similarity);
        const pool = [...r.candidates, ...(r.pool ?? [])];
        const named = pickDoodles(pool, await recognize(pool.map(toXY)));
        for (const c of named.slice(0, PER)) add(c, "doodle", c.shapeName, c.similarity);

        // 그림 지정 모드: 그림을 돌아가며 하나씩, 그림마다 가장 잘 맞은 코스
        let got = 0;
        for (let t = 0; t < SHAPE_IDS.length && got < PER; t++) {
          const shape = SHAPE_BY_ID[SHAPE_IDS[shapeTurn++ % SHAPE_IDS.length]];
          const s = discoverRoutes(g, { mode: "shape", shapes: [shape], minMeters: range.min, maxMeters: range.max, region, budget: new StepBudget(500) });
          const best = s.candidates.filter((c) => c.similarity >= SIMILARITY_MIN)[0];
          if (!best) continue;
          add(best, "shape", shape.name, best.similarity);
          got++;
        }
      }
    }

    // 고정 시드로 섞고, 방식을 짐작할 수 없는 번호를 붙인다
    let seed = 20261010;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const order = lines.map((_, i) => i).sort(() => rand() - 0.5);
    const items: Array<{ id: string; line: XY[] }> = [];
    const key: KeyItem[] = [];
    order.forEach((i, k) => {
      const id = `c${String(k + 1).padStart(2, "0")}`;
      items.push({ id, line: lines[i].line.map(([x, y]) => [Math.round(x), Math.round(y)] as XY) });
      key.push({ id, ...lines[i].key });
    });
    mkdirSync(OUT, { recursive: true });
    writeFileSync(`${OUT}/items.json`, JSON.stringify(items));
    writeFileSync(`${OUT}/key.json`, JSON.stringify(key, null, 1));
    const count = (m: Method) => key.filter((k) => k.method === m).length;
    console.log(`블라인드 세트 ${items.length}개 (doodle ${count("doodle")}, discover ${count("discover")}, shape ${count("shape")}) → ${OUT}/`);
  },
  900_000,
);

