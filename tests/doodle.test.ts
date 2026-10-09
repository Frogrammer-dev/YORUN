import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { DoodleClassifier, parseClassNames, rasterizeLoop } from "@/lib/art/doodle";
import { DOODLE_KO, DOODLE_SKIP } from "@/lib/art/doodleNames";
import { SHAPE_BY_ID } from "@/lib/route/shapes";

const DIR = "public/models/doodlenet";
const classNames = readFileSync(`${DIR}/class_names.txt`, "utf8");

describe("낙서 인식 (DoodleNet)", () => {
  let clf: DoodleClassifier;
  beforeAll(async () => {
    const json = JSON.parse(readFileSync(`${DIR}/model.json`, "utf8"));
    const bin = readFileSync(`${DIR}/group1-shard1of1.bin`);
    clf = await DoodleClassifier.fromMemory(json, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength), classNames);
  }, 60_000);

  it("345가지 모두 한국어 이름이 있다", () => {
    const names = parseClassNames(classNames);
    expect(names).toHaveLength(345);
    for (const n of names) expect(DOODLE_KO[n], n).toBeTruthy();
    for (const n of DOODLE_SKIP) if (n !== "snow") expect(names, n).toContain(n);
  });

  it("28×28 흑백, 그림은 가운데에 꽉 차게", () => {
    const img = rasterizeLoop([[0, 0], [10, 0], [10, 10], [0, 10]]);
    expect(img).toHaveLength(28 * 28);
    expect([...img].every((v) => v === 0 || v === 1)).toBe(true);
    const on = [...img].map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
    const cols = on.map((i) => i % 28), rows = on.map((i) => Math.floor(i / 28));
    expect(Math.min(...cols)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...cols)).toBeLessThanOrEqual(26);
    expect(Math.min(...rows) + Math.max(...rows)).toBeCloseTo(27, -1); // 위아래 가운데
  });

  it("알아보기 쉬운 실루엣을 맞힌다 (기린·왕관·머그컵·번개)", async () => {
    const ids = ["giraffe", "crown", "mug", "bolt"] as const;
    const res = await clf.classify(ids.map((id) => rasterizeLoop(SHAPE_BY_ID[id].points)), 3);
    expect(res.map((r) => r[0].name)).toEqual(["giraffe", "crown", "mug", "lightning"]);
  }, 60_000);
});
