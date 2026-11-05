// 윤곽 생성 비교 실험 2 (docs/booth-route-experiment.md). BOOTH_IMAGE_EVAL=결과폴더 로 실행한다. 이미지 API 비용이 든다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { nodes } from "@/components/booth/course";
import { findBoothCourse } from "@/components/booth/engine";
import { silhouettePrompt as imagePrompt, traceSilhouette as traceImage } from "@/lib/art/silhouette";
import { groupLines, type ShapeGroup } from "@/lib/route/shapes";

const OUT = process.env.BOOTH_IMAGE_EVAL ?? "";
const MODELS = ["gpt-image-2", "gpt-image-1-mini"];

function apiKey() {
  const match = readFileSync(".env.local", "utf8").match(/^OPENAI_API_KEY=(.*)$/m);
  if (!match?.[1].trim()) throw new Error("OPENAI_API_KEY 없음");
  return match[1].trim();
}
type Generated = { prompt: string; model: string; seconds: number; group: ShapeGroup | null; error?: string };
async function generate(prompt: string, model: string, key: string): Promise<Generated> {
  const started = Date.now();
  const file = path.join(OUT, `${model}-${Buffer.from(prompt).toString("hex").slice(0, 12)}.png`);
  try {
    let png: Buffer;
    if (existsSync(file)) {
      png = readFileSync(file);
    } else {
      const response = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: imagePrompt(prompt), size: "1024x1024", quality: "low", n: 1 }),
      });
      const body = await response.json();
      if (!response.ok) return { prompt, model, seconds: 0, group: null, error: String(body?.error?.code ?? response.status) };
      png = Buffer.from(body.data[0].b64_json, "base64");
      writeFileSync(file, png);
    }
    return { prompt, model, seconds: (Date.now() - started) / 1000, group: await traceImage(png) };
  } catch (error) {
    return { prompt, model, seconds: (Date.now() - started) / 1000, group: null, error: (error as Error).message.slice(0, 80) };
  }
}

const closed = (line: number[][]) => [...line, line[0]];
const draw = (line: number[][], x0: number, y0: number, cell: number, stroke: string) => {
  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const k = (cell * 0.84) / size, mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const d = line.map(([x, y], i) => `${i ? "L" : "M"}${(x0 + cell / 2 + (x - mx) * k).toFixed(1)} ${(y0 + cell / 2 + (y - my) * k).toFixed(1)}`).join("");
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>`;
};
const flipped = (group: ShapeGroup) => groupLines(group)[0].map(([x, y]) => [x, -y]);

it.skipIf(!OUT)("좌표 윤곽과 이미지 추적 윤곽을 비교한다", async () => {
  mkdirSync(OUT, { recursive: true });
  const key = apiKey();
  const base: { prompt: string; group: ShapeGroup }[] = JSON.parse(readFileSync("tests/fixtures/booth-outlines.json", "utf8"));
  const generated: Generated[] = [];
  for (const model of MODELS) {
    for (let i = 0; i < base.length; i += 3) {
      generated.push(...await Promise.all(base.slice(i, i + 3).map(({ prompt }) => generate(prompt, model, key))));
    }
  }
  writeFileSync("tests/fixtures/booth-outlines-image.json", JSON.stringify(generated.filter((g) => g.group).map(({ prompt, model, group }) => ({ prompt, model, group }))));

  const cell = 200;
  const columns = 7;
  const route = (group: ShapeGroup | null | undefined, maxMeters: number) => (group ? findBoothCourse(group.parts[0].shape, [0, 0], { maxMeters }) : null);
  const stats: unknown[] = [];
  const rows = base.map(({ prompt, group }, i) => {
    const image2 = generated.find((g) => g.prompt === prompt && g.model === MODELS[0]);
    const mini = generated.find((g) => g.prompt === prompt && g.model === MODELS[1]);
    const y = i * cell;
    const cells: (string | null)[] = [];
    const outline = (g: ShapeGroup | null | undefined, c: number) => (g ? draw(closed(flipped(g)), c * cell, y, cell, "#9aa3af") : null);
    cells.push(outline(group, 0), outline(image2?.group, 1), outline(mini?.group, 2));
    const courses = [route(group, 6000), route(image2?.group, 6000), route(mini?.group, 6000), route(image2?.group, 9000)];
    courses.forEach((course, c) => cells.push(course ? draw(course.path.map((id) => nodes[id]), (c + 3) * cell, y, cell, c === 0 ? "#111318" : "#0A72D6") : null));
    stats.push({
      i: i + 1,
      image2Seconds: image2?.seconds, miniSeconds: mini?.seconds,
      image2Points: image2?.group?.parts[0].shape.points.length, miniPoints: mini?.group?.parts[0].shape.points.length,
      km: courses.map((c) => (c ? +(c.distance / 1000).toFixed(1) : null)), sim: courses.map((c) => c?.similarity ?? null),
      errors: [image2?.error, mini?.error].filter(Boolean),
    });
    return cells.filter(Boolean).join("") + `<text x="4" y="${y + 18}" font-size="16">${String(i + 1).padStart(2, "0")}</text>`;
  }).join("");
  writeFileSync(path.join(OUT, "compare.json"), JSON.stringify(stats, null, 1));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cell}" height="${base.length * cell}"><rect width="100%" height="100%" fill="white"/>${rows}</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(OUT, "diagnostic.png"));

  // 사람 평가용 결과지: 채택 모델의 실제 코스만, 고정된 순서로 섞어 번호만 표시한다. 정답은 별도 파일이다
  const order = [6, 2, 9, 0, 4, 7, 1, 8, 3, 5];
  const blindCell = 320;
  const blind = order.map((source, index) => {
    const mini = generated.find((g) => g.prompt === base[source].prompt && g.model === MODELS[1]);
    const course = mini?.group ? findBoothCourse(mini.group.parts[0].shape, [0, 0]) : null;
    const x = (index % 5) * blindCell, y = Math.floor(index / 5) * blindCell;
    return (course ? draw(course.path.map((id) => nodes[id]), x, y, blindCell, "#111318") : "") + `<text x="${x + 8}" y="${y + 24}" font-size="20">${index + 1}</text>`;
  }).join("");
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${blindCell * 5}" height="${blindCell * 2}"><rect width="100%" height="100%" fill="white"/>${blind}</svg>`)).png().toFile(path.join(OUT, "blind-routes.png"));
  writeFileSync(path.join(OUT, "blind-answers.json"), JSON.stringify(order.map((source, index) => ({ number: index + 1, prompt: base[source].prompt })), null, 1));
  const ok = (model: string) => generated.filter((g) => g.model === model && g.group).length;
  console.log(JSON.stringify({ image2Ok: ok(MODELS[0]), miniOk: ok(MODELS[1]), maxSeconds: Math.max(...generated.map((g) => g.seconds)), errors: generated.filter((g) => g.error).map((g) => g.error) }));
  expect(generated.length).toBe(base.length * MODELS.length);
}, 560_000);
