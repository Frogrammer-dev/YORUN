// 사람 판정 결과로 점수 등급 기준선 갱신 (CALIBRATE=1 일 때만): npm run eval:calibrate
// eval/labels/*.json (판정 페이지에서 저장한 파일)을 모두 읽어 src/lib/eval/calibration.json을 다시 쓴다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { z } from "zod";
import { calibrate, TARGETS, type Judged } from "@/lib/eval/calibrate";

const DIR = "eval/labels";
const OUT = "src/lib/eval/calibration.json";

it.skipIf(process.env.CALIBRATE !== "1")("판정 결과로 등급 기준선 갱신", () => {
  if (!existsSync(DIR)) throw new Error(`${DIR} 폴더에 판정 결과(JSON)를 넣어 주세요`);
  const schema = z.object({ judgeType: z.literal("human"), who: z.string().trim().min(1), savedAt: z.string(),
    items: z.array(z.object({ id: z.string().min(1), kind: z.enum(["doodle", "template"]), name: z.string(), score: z.number().min(0).max(100), recognized: z.boolean() }).strict()).min(1) }).strict();
  const groups = new Map<string, { id: string; kind: string; score: number; votes: boolean[] }>();
  const judges = new Set<string>();
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json"))) {
    const file = schema.parse(JSON.parse(readFileSync(`${DIR}/${f}`, "utf8")));
    if (judges.has(file.who)) throw new Error(`판정자 ${file.who}의 파일이 중복됩니다. 한 사람당 파일 하나만 사용하세요.`);
    judges.add(file.who);
    const seen = new Set<string>();
    for (const item of file.items) {
      const key = `${item.kind}:${item.id}`;
      if (seen.has(key)) throw new Error(`중복 항목 ${key}`);
      seen.add(key);
      const g = groups.get(key);
      if (g && g.score !== item.score) throw new Error(`동일 코스의 점수가 다릅니다: ${key}`);
      if (g) g.votes.push(item.recognized);
      else groups.set(key, { id: item.id, kind: item.kind, score: item.score, votes: [item.recognized] });
    }
  }
  // Do not inflate n by treating repeated judgments of the same course as independent courses.
  const items: Array<Judged & { kind: string; id: string }> = [...groups.values()]
    .filter((g) => g.votes.filter(Boolean).length * 2 !== g.votes.length)
    .map((g) => ({ id: g.id, kind: g.kind, score: g.score, recognized: g.votes.filter(Boolean).length * 2 > g.votes.length }));
  if (!items.length) throw new Error("유효한 사람 판정이 없어 보정 파일을 변경하지 않았습니다.");
  const cur = JSON.parse(readFileSync(OUT, "utf8"));
  const doodle = calibrate(items.filter((i) => i.kind === "doodle"), cur.doodle);
  const similarity = calibrate(items.filter((i) => i.kind === "template"), cur.similarity);
  const next = {
    note: `사람 판정 ${items.length}건으로 보정 (목표: 보여 줌 ${TARGETS.show * 100}%·그럭저럭 ${TARGETS.fair * 100}%·또렷함 ${TARGETS.clear * 100}% 이상 알아봄, 95% 하한)`,
    calibrated: doodle.status === "validated" && similarity.status === "validated",
    labels: items.length,
    status: { doodle: doodle.status, similarity: similarity.status },
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
