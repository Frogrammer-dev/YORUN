// 부위 판별 확인용 그림표. CREATURE_SHEET=파일경로 로 실행한다. 사람이 눈으로 보는 자료이고 합격 판정이 아니다.
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { expect, it } from "vitest";
import { makeCreature, toRenderLine, type Creature, type PartName } from "@/lib/battle/creature";
import { SHAPES, groupLines, type ShapeGroup } from "@/lib/route/shapes";

const OUT = process.env.CREATURE_SHEET ?? "";
const COLORS: Record<PartName, string> = { head: "#d92d20", handL: "#7a5af8", handR: "#7a5af8", footL: "#12b76a", footR: "#12b76a" };

function draw(c: Creature, x0: number, y0: number, size: number, label: string) {
  const px = (p: readonly number[]) => `${(x0 + p[0] * size).toFixed(1)},${(y0 + p[1] * size).toFixed(1)}`;
  const body = c.lines.map((l) => `<polyline points="${l.map(px).join(" ")}" fill="none" stroke="#0a72d6" stroke-width="2.5"/>`).join("");
  const parts = (Object.keys(c.parts) as PartName[]).map((k) => {
    const part = c.parts[k];
    const [x, y] = px(part.at).split(",");
    const stub = part.stub && part.root ? `<polyline points="${px(part.root)} ${px(part.at)}" stroke="${COLORS[k]}" stroke-width="3"/>` : "";
    return `${stub}<circle cx="${x}" cy="${y}" r="5" fill="${COLORS[k]}" fill-opacity="${part.stub ? 0.35 : 1}" stroke="#111"/>`;
  }).join("");
  const [ex, ey] = px(c.eye).split(",");
  const eye = `<circle cx="${ex}" cy="${ey}" r="${(c.eyeRadius * size).toFixed(1)}" fill="#fff" stroke="#111" stroke-width="2"/>`;
  return `<g>${body}${parts}${eye}<text x="${x0 + 4}" y="${y0 + size + 12}" font-size="13">${label}</text></g>`;
}

it.skipIf(!OUT)("모양별 부위 판별을 그린다", async () => {
  const items: { label: string; line: readonly (readonly number[])[] }[] = SHAPES.map((s) => ({ label: s.name, line: s.points }));
  const fixtures: { prompt: string; model: string; group: ShapeGroup }[] = JSON.parse(readFileSync("tests/fixtures/booth-outlines-image.json", "utf8"));
  for (const f of fixtures.filter((x) => x.model === "gpt-image-1-mini")) {
    items.push({ label: `윤곽 ${f.prompt.slice(0, 8)}`, line: groupLines(f.group)[0] });
  }
  const size = 150, gap = 30, columns = 8;
  const rows = Math.ceil(items.length / columns);
  const art = items.map((item, i) => draw(makeCreature([toRenderLine(item.line)]), (i % columns) * (size + gap) + 10, Math.floor(i / columns) * (size + gap) + 10, size, item.label)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * (size + gap) + 20}" height="${rows * (size + gap) + 20}"><rect width="100%" height="100%" fill="#fff"/>${art}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(OUT);
  writeFileSync(OUT + ".txt", items.map((x) => x.label).join("\n"));
  expect(items.length).toBeGreaterThan(20);
}, 120_000);
