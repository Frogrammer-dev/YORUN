import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { it } from "vitest";
import { SHAPE_BY_ID } from "@/lib/route/shapes";

it.skipIf(!process.env.RELATION_CONTROLS)("renders immutable ideal hypotheses as separate non-road recognizability controls", async () => {
  const out = "eval/recognition/relation-generation-20261021/controls-v1";
  mkdirSync(out, { recursive: true });
  const names = ["bird", "apple", "turtle", "car"] as const;
  const order = [...names].sort((a, b) => createHash("sha256").update(a).digest("hex").localeCompare(createHash("sha256").update(b).digest("hex")));
  const records = [], tiles = [];
  for (const [i, name] of order.entries()) {
    const id = `C${i + 1}`, shape = SHAPE_BY_ID[name];
    const d = shape.points.map(([x, y], k) => `${k ? "L" : "M"}${(160 + 256 * x).toFixed(3)},${(190 - 256 * y).toFixed(3)}`).join(" ");
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="350"><rect width="320" height="350" fill="white"/><text x="12" y="20" font-size="18">${id}</text><path d="${d}" fill="none" stroke="black" stroke-width="2.4" stroke-linejoin="round"/></svg>`)).png().toBuffer();
    writeFileSync(`${out}/${id}.png`, png);
    records.push({ id, shapeId: name, sourcePoints: shape.points, actualRoad: false, includedInSixCasePerformance: false, pngHash: createHash("sha256").update(png).digest("hex") });
    tiles.push({ input: png, left: i % 2 * 320, top: Math.floor(i / 2) * 350 });
  }
  await sharp({ create: { width: 640, height: 700, channels: 3, background: "white" } }).composite(tiles).png().toFile(`${out}/sheet.png`);
  writeFileSync(`${out}/mapping.private.json`, JSON.stringify({ sameCriteriaRequested: true, separateControlNotRoadBenchmark: true, records }, null, 2));
});
