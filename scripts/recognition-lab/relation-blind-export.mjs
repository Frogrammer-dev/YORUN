import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
const source = "eval/recognition/relation-generation-20261021/cascade-v1";
const folder = "eval/recognition/relation-generation-20261021/blind-v1";
const sha = b => createHash("sha256").update(b).digest("hex");
const bytes = readFileSync(`${source}/results.json`), data = JSON.parse(bytes.toString());
const entries = data.cases.flatMap(c => ["baseline", "uniform", "relation"].map(mode => ({ caseId: c.id, mode, file: `${source}/${c.id}-${mode}.png` })));
entries.sort((a, b) => sha(Buffer.from(a.file)).localeCompare(sha(Buffer.from(b.file))));
mkdirSync(folder, { recursive: true });
const mapping = [], tiles = [];
for (const [i, entry] of entries.entries()) {
  const id = `Q${String(i + 1).padStart(2, "0")}`, png = readFileSync(entry.file);
  writeFileSync(`${folder}/${id}.png`, png);
  mapping.push({ id, ...entry, pngHash: sha(png) });
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="30"><rect width="320" height="30" fill="white"/><text x="12" y="21" font-size="18">${id}</text></svg>`);
  const tile = await sharp(png).resize(320, 320).extend({ top: 30, bottom: 0, left: 0, right: 0, background: "white" }).composite([{ input: label, top: 0, left: 0 }]).png().toBuffer();
  tiles.push(tile);
}
for (let page = 0; page < 3; page++) {
  const image = await sharp({ create: { width: 960, height: 700, channels: 3, background: "white" } }).composite(tiles.slice(page * 6, page * 6 + 6).map((input, i) => ({ input, left: i % 3 * 320, top: Math.floor(i / 3) * 350 }))).png().toBuffer();
  writeFileSync(`${folder}/sheet-${page + 1}.png`, image);
}
writeFileSync(`${folder}/mapping.private.json`, JSON.stringify({ sourceHash: sha(bytes), source, sameModelFamilyAIOnly: true, methodAndTargetWithheld: true, denominatorPerArm: 6, entries: mapping }, null, 2));
console.log(JSON.stringify({ images: entries.length, sheets: 3, folder }));
