// 사람 판정 결과로 점수 등급 기준선 갱신 (CALIBRATE=1 일 때만): npm run eval:calibrate
// eval/labels/*.json (판정 페이지에서 저장한 파일)을 모두 읽어 src/lib/eval/calibration.json을 다시 쓴다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { calibrate, TARGETS, type Judged } from "@/lib/eval/calibrate";

const DIR = "eval/labels";
const OUT = "src/lib/eval/calibration.json";

it.skipIf(process.env.CALIBRATE !== "1")("판정 결과로 등급 기준선 갱신", () => {
  if (!existsSync(DIR)) throw new Error(`${DIR} 폴더에 판정 결과(JSON)를 넣어 주세요`);
  const items: Array<Judged & { kind: string; id: string }> = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json")))
    for (const it of JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")).items) items.push(it);
  // 같은 코스를 여러 사람이 판정했으면 각각 표본으로 센다 (다수결이 아니라 '알아볼 확률'을 잰다)
  const cur = JSON.parse(readFileSync(OUT, "utf8"));
  const doodle = calibrate(items.filter((i) => i.kind === "doodle"), cur.doodle);
  const similarity = calibrate(items.filter((i) => i.kind === "template"), cur.similarity);
  const next = {
    note: `사람 판정 ${items.length}건으로 보정 (목표: 보여 줌 ${TARGETS.show * 100}%·그럭저럭 ${TARGETS.fair * 100}%·또렷함 ${TARGETS.clear * 100}% 이상 알아봄, 95% 하한)`,
    calibrated: true,
    labels: items.length,
    doodle: doodle.grades,
    similarity: similarity.grades,
  };
  writeFileSync(OUT, JSON.stringify(next, null, 2) + "\n");
  const show = (name: string, t: typeof doodle.table) =>
    console.log(`\n[${name}] 점수 이상 → 개수 · 알아본 비율 · 95% 하한\n` + t.filter((r) => r.threshold % 5 === 0 && r.n > 0).map((r) => `${r.threshold}+ → ${r.n} · ${Math.round(r.precision * 100)}% · ${Math.round(r.lower * 100)}%`).join("\n"));
  show("낙서 인식", doodle.table);
  show("도형 유사도", similarity.table);
  console.log("\n새 기준선:", JSON.stringify({ doodle: next.doodle, similarity: next.similarity }));
});
