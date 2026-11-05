// 부스 코스 비교 실험 (docs/booth-route-experiment.md). BOOTH_EVAL=결과폴더 로 실행한다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { extractOutline, nodes } from "@/components/booth/course";
import { findBoothCourse } from "@/components/booth/engine";
import { groupLines, type ShapeGroup } from "@/lib/route/shapes";

type Pt = number[];
const OUT = process.env.BOOTH_EVAL ?? "";

function densify(line: Pt[], step: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
const closed = (line: Pt[]) => [...line, line[0]];
const nearestDistance = (p: Pt, set: Pt[]) => Math.sqrt(Math.min(...set.map((q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)));
function chamfer(route: Pt[], outline: Pt[]) {
  const step = 10;
  const r = densify(route, step), o = densify(closed(outline), step);
  const xs = outline.map((p) => p[0]), ys = outline.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const mean = (a: Pt[], b: Pt[]) => a.reduce((sum, p) => sum + nearestDistance(p, b), 0) / a.length;
  return (mean(r, o) + mean(o, r)) / 2 / size;
}
function pathStats(ids: number[]) {
  let spurs = 0, total = 0, repeated = 0;
  const seen = new Set<string>();
  for (let i = 1; i < ids.length; i++) {
    if (i + 1 < ids.length && ids[i - 1] === ids[i + 1]) spurs++;
    const len = Math.hypot(nodes[ids[i]][0] - nodes[ids[i - 1]][0], nodes[ids[i]][1] - nodes[ids[i - 1]][1]);
    const key = [Math.min(ids[i], ids[i - 1]), Math.max(ids[i], ids[i - 1])].join();
    total += len;
    if (seen.has(key)) repeated += len;
    seen.add(key);
  }
  return { spurs, repeat: repeated / total, closed: ids[0] === ids[ids.length - 1], km: total / 1000 };
}
const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1];
const svgLine = (line: Pt[], box: number[], stroke: string, width: number) => {
  const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const k = (box[2] * 0.86) / size, mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
  const d = line.map(([x, y], i) => `${i ? "L" : "M"}${(box[0] + box[2] / 2 + (x - mx) * k).toFixed(1)} ${(box[1] + box[2] / 2 + (y - my) * k).toFixed(1)}`).join("");
  return `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
};

it.skipIf(!OUT)("현재 방식(A)과 기존 엔진(B)을 같은 윤곽으로 비교한다", async () => {
  mkdirSync(OUT, { recursive: true });
  const fixtures: { prompt: string; group: ShapeGroup }[] = JSON.parse(readFileSync("tests/fixtures/booth-outlines.json", "utf8"));
  const rows = fixtures.map(({ prompt, group }) => {
    const line = groupLines(group)[0];
    const a = extractOutline(line, [0, 0]);
    const xs = line.map((p) => p[0]), ys = line.map((p) => p[1]);
    const mx = (Math.min(...xs) + Math.max(...xs)) / 2, my = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
    const aOutline = line.slice(0, -1).map(([x, y]) => [((x - mx) / half) * 0.95 * 480, (-(y - my) / half) * 0.95 * 480]);
    const started = Date.now();
    const b = findBoothCourse(group.parts[0].shape, [0, 0]);
    const seconds = (Date.now() - started) / 1000;
    const aRoute = a.path.map((id) => nodes[id]);
    const bRoute = b ? b.path.map((id) => nodes[id]) : null;
    return {
      prompt, seconds, aOutline, aRoute, bRoute, bOutline: b?.outline ?? null,
      a: { chamfer: chamfer(aRoute, aOutline), ...pathStats(a.path) },
      b: b && bRoute ? { chamfer: chamfer(bRoute, b.outline), similarity: b.similarity, ...pathStats(b.path) } : null,
    };
  });

  const found = rows.filter((r) => r.b);
  const aMedian = median(rows.map((r) => r.a.chamfer));
  const bMedian = found.length ? median(found.map((r) => r.b!.chamfer)) : Infinity;
  const summary = {
    aMedian, bMedian, reduction: 1 - bMedian / aMedian,
    improved: found.filter((r) => r.b!.chamfer < r.a.chamfer).length,
    found: found.length,
    maxSpurs: Math.max(0, ...found.map((r) => r.b!.spurs)),
    maxRepeat: Math.max(0, ...found.map((r) => r.b!.repeat)),
    allClosed: found.every((r) => r.b!.closed),
    maxSeconds: Math.max(...rows.map((r) => r.seconds)),
  };
  writeFileSync(path.join(OUT, "compare.json"), JSON.stringify({ summary, rows: rows.map(({ prompt, seconds, a: ra, b: rb }) => ({ prompt, seconds, a: ra, b: rb })) }, null, 1));

  // 진단용 표: 윤곽 | A | B. 설명 이름은 넣지 않는다
  const cell = 300;
  const parts = rows.map((r, i) => {
    const y = i * cell;
    return svgLine(closed(r.aOutline), [0, y, cell], "#9aa3af", 5) + svgLine(r.aRoute, [cell, y, cell], "#111318", 6) + (r.bRoute ? svgLine(r.bRoute, [cell * 2, y, cell], "#0A72D6", 6) : "") + `<text x="8" y="${y + 24}" font-size="20">${String(i + 1).padStart(2, "0")}</text>`;
  }).join("");
  writeFileSync(path.join(OUT, "diagnostic.svg"), `<svg xmlns="http://www.w3.org/2000/svg" width="${cell * 3}" height="${cell * rows.length}"><rect width="100%" height="100%" fill="white"/>${parts}</svg>`);
  console.log(JSON.stringify(summary));
  console.table(rows.map((r, i) => ({ i: i + 1, s: r.seconds.toFixed(1), aCh: r.a.chamfer.toFixed(3), bCh: r.b?.chamfer.toFixed(3), bSpur: r.b?.spurs, bRep: r.b?.repeat.toFixed(2), aKm: r.a.km.toFixed(1), bKm: r.b?.km.toFixed(1), sim: r.b?.similarity })));
  expect(rows.length).toBe(fixtures.length);
}, 180_000);
