import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { it } from "vitest";
import { SHAPE_BY_ID, type ShapeId } from "@/lib/route/shapes";
import { normalizeRoadReferenceRenderLine, type ReferencePoint } from "@/lib/art/roadReference";

it.skipIf(!process.env.RELATION_ORIENTATION)("separates display orientation from native-route improvement with paired ideal controls", async () => {
  const source = "eval/recognition/relation-generation-20261021/cascade-v1/results.json", out = "eval/recognition/relation-generation-20261021/orientation-v1";
  const bytes = readFileSync(source), data = JSON.parse(bytes.toString());
  const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
  mkdirSync(out, { recursive: true });
  const frame = (points: ReferencePoint[]): ReferencePoint[] => {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]), loX = Math.min(...xs), hiX = Math.max(...xs), loY = Math.min(...ys), hiY = Math.max(...ys), scale = Math.max(hiX - loX, hiY - loY);
    return points.map(([x, y]) => [.5 + .8 * (x - (loX + hiX) / 2) / scale, .5 + .8 * (y - (loY + hiY) / 2) / scale]);
  };
  const entries: Array<{ caseId: string; mode: string; shapeId: string; line: ReferencePoint[]; poseDeg: number; displayAligned: boolean; nativeRoad: boolean }> = [];
  for (const c of data.cases) {
    for (const mode of ["baseline", "uniform", "relation"]) {
      const state = mode === "baseline" ? c.baseline : c.arms.find((a: { mode: string }) => a.mode === mode).rounds[5].output;
      const line = normalizeRoadReferenceRenderLine({ id: "raw", latlngs: state.latlngs }), angle = state.placement.rotDeg * Math.PI / 180;
      // In y-down image coordinates, +pose angle undoes the y-up route pose.
      const aligned = frame(line.map(([x, y]): ReferencePoint => [(x - .5) * Math.cos(angle) - (y - .5) * Math.sin(angle), (x - .5) * Math.sin(angle) + (y - .5) * Math.cos(angle)]));
      entries.push({ caseId: c.id, mode, shapeId: c.shapeId, line: aligned, poseDeg: state.placement.rotDeg, displayAligned: true, nativeRoad: true });
    }
    const state = c.arms.find((a: { mode: string }) => a.mode === "uniform").rounds[5].output, angle = state.placement.rotDeg * Math.PI / 180;
    const ideal = frame(SHAPE_BY_ID[c.shapeId as ShapeId].points.map(([x, y]): ReferencePoint => [x * Math.cos(angle) - y * Math.sin(angle), -(x * Math.sin(angle) + y * Math.cos(angle))]));
    entries.push({ caseId: c.id, mode: "ideal-posed", shapeId: c.shapeId, line: ideal, poseDeg: state.placement.rotDeg, displayAligned: false, nativeRoad: false });
  }
  entries.sort((a, b) => sha(`${a.caseId}:${a.mode}`).localeCompare(sha(`${b.caseId}:${b.mode}`)));
  const records = [], images = [];
  for (const [i, e] of entries.entries()) {
    const id = `T${String(i + 1).padStart(2, "0")}`, d = e.line.map(([x, y], j) => `${j ? "L" : "M"}${(x * 320).toFixed(3)},${(y * 320 + 30).toFixed(3)}`).join(" ");
    const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="350"><rect width="320" height="350" fill="white"/><text x="12" y="21" font-size="18">${id}</text><path d="${d}" fill="none" stroke="black" stroke-width="2.4" stroke-linejoin="round"/></svg>`)).png().toBuffer();
    writeFileSync(`${out}/${id}.png`, png); images.push(png);
    records.push({ id, ...e, pngHash: sha(png) });
  }
  for (let page = 0; page < 4; page++) await sharp({ create: { width: 960, height: 700, channels: 3, background: "white" } }).composite(images.slice(page * 6, page * 6 + 6).map((input, i) => ({ input, left: i % 3 * 320, top: Math.floor(i / 3) * 350 }))).png().toFile(`${out}/sheet-${page + 1}.png`);
  writeFileSync(`${out}/mapping.private.json`, JSON.stringify({ source, sourceHash: sha(bytes), nativeRoutesModified: false, supplementaryDisplayExperiment: true, fixedPoseControlsIncludedInNativeRoadDenominator: false, records }, null, 2));
});
