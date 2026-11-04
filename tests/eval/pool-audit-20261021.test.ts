import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { expect, it } from "vitest";
import { graphFromOverpass, type BBox } from "@/lib/route/osm";
import { hasEdge, project } from "@/lib/route/graph";
import { buildBlocks, growLoops } from "@/lib/route/loops";
import { StepBudget } from "@/lib/route/budget";
import { normalizeRoadReferenceInput, normalizeRoadReferenceRenderLine } from "@/lib/art/roadReference";
import { describeRouteParts } from "@/lib/art/routeParts";
import { makeCandidate } from "../helpers/candidate";

const root = "eval/recognition/route-improvement/holdout";
const out = "eval/recognition/pool-audit-20261021";
it.skipIf(!process.env.ROUTE_POOL_AUDIT || !existsSync(`${root}/protocol.json`))("audits disjoint model-independent simple-outline and parts-high strata in three existing development pools", async () => {
  const protocol = JSON.parse(readFileSync(`${root}/protocol.json`, "utf8")) as { areas: Array<{ id: string; bbox: BBox; sha256: string }> };
  const sha = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
  const spec = { seed: 20261021, seeds: 400, minMeters: 3000, maxMeters: 8000, repeatMax: .2, samplePerArea: 10, strata: { hashSample: 4, simpleOutline: 3, partsHigh: 3 }, priorRegionsAlreadyUsed: true, holdoutV2Read: false, externalCalls: 0 };
  mkdirSync(out, { recursive: true });
  const codeHashes = Object.fromEntries(["src/lib/art/routeParts.ts", "src/lib/art/roadReferenceClient.ts", "src/lib/route/loops.ts", "src/lib/route/osm.ts", "tests/eval/pool-audit-20261021.test.ts"].map(file => [file, sha(readFileSync(file))]));
  writeFileSync(`${out}/protocol.json`, JSON.stringify({ ...spec, codeHashes }, null, 2));
  const areas = [];
  let sequence = 0;
  for (const area of protocol.areas) {
    const bytes = readFileSync(`${root}/${area.id}-roads.json`);
    expect(sha(bytes)).toBe(area.sha256);
    const g = graphFromOverpass(JSON.parse(bytes.toString()), area.bbox, { detail: "simple", excludeSteps: true });
    const [minX, minY] = project(g.origin, area.bbox.south, area.bbox.west), [maxX, maxY] = project(g.origin, area.bbox.north, area.bbox.east);
    const region = { minX, minY, maxX, maxY };
    const blocks = buildBlocks(g, (maxX - minX) * (maxY - minY) / 4);
    const loops = growLoops(g, blocks, region, spec.minMeters, spec.maxMeters, { seeds: spec.seeds, budget: new StepBudget(spec.seeds), fraction: 1, seed: spec.seed });
    const pool = [], seen = new Set<string>();
    for (const loop of loops) {
      if (loop.path.length < 4 || loop.path[0] !== loop.path.at(-1)) continue;
      if (!loop.path.every(v => g.x[v] >= minX && g.x[v] <= maxX && g.y[v] >= minY && g.y[v] <= maxY)) continue;
      let native = 0, repeated = 0, projected = 0, projectedRepeated = 0, valid = true;
      const edges = new Set<string>();
      for (let i = 1; i < loop.path.length; i++) {
        const a = loop.path[i - 1], b = loop.path[i];
        if (!hasEdge(g, a, b)) { valid = false; break; }
        let meters = 0;
        for (let k = g.adjStart[a]; k < g.adjStart[a + 1]; k++) if (g.adjTo[k] === b) { meters = g.adjLen[k]; break; }
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        const projectedMeters = Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a]);
        native += meters;
        projected += projectedMeters;
        if (edges.has(key)) { repeated += meters; projectedRepeated += projectedMeters; }
        edges.add(key);
      }
      if (!valid || native < 3000 || native > 8000 || projected < 3000 || projected > 8000 || repeated / native > .2 || projectedRepeated / projected > .2) continue;
      const key = [...edges].sort().join(",");
      if (seen.has(key)) continue;
      seen.add(key);
      pool.push(makeCandidate({ id: sha(key).slice(0, 16), shapeId: "doodle", shapeName: "", outline: [], outlines: [], latlngs: loop.path.map(v => [g.lat[v], g.lon[v]]), lengthMeters: native, repeatRatio: repeated / native }));
    }
    expect(pool.length).toBeGreaterThanOrEqual(3);
    const prepared = pool.map(candidate => {
      const source = { id: "road-input", latlngs: candidate.latlngs };
      const renderLine = normalizeRoadReferenceRenderLine(source);
      return { candidate, packet: normalizeRoadReferenceInput(source), renderLine, structure: describeRouteParts(renderLine) };
    });
    const used = new Set<string>();
    const unique: Array<typeof prepared[number] & { group: string }> = [];
    const add = (items: typeof prepared, group: string, count: number) => {
      let n = 0;
      for (const p of items) if (!used.has(p.packet.fingerprint)) {
        used.add(p.packet.fingerprint); unique.push({ ...p, group });
        if (++n >= count) break;
      }
    };
    add([...prepared].sort((a,b) => sha("audit-20261021:"+a.packet.fingerprint).localeCompare(sha("audit-20261021:"+b.packet.fingerprint))), "hash-sample", 4);
    add([...prepared].sort((a,b) => a.structure.salience-b.structure.salience || a.packet.fingerprint.localeCompare(b.packet.fingerprint)), "simple-outline", 3);
    add([...prepared].sort((a,b) => b.structure.salience-a.structure.salience || a.packet.fingerprint.localeCompare(b.packet.fingerprint)), "parts-high", 3);
    expect(unique).toHaveLength(10);
    const records = [], tiles = [];
    for (const p of unique) {
      const id = `P${String(++sequence).padStart(2, "0")}`;
      const d = p.renderLine.map(([x, y], i) => `${i ? "L" : "M"}${(x * 320).toFixed(3)},${(y * 320 + 25).toFixed(3)}`).join(" ");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="360"><rect width="320" height="360" fill="white"/><text x="12" y="20" font-size="18">${id}</text><path d="${d}" fill="none" stroke="black" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      writeFileSync(`${out}/${id}.png`, png);
      records.push({ id, fingerprint: p.packet.fingerprint, renderLine: p.renderLine, group: p.group, structure: describeRouteParts(p.renderLine), nativeMeters: p.candidate.lengthMeters, repeatRatio: p.candidate.repeatRatio, pngHash: sha(png) });
      tiles.push({ input: png, left: ((tiles.length) % 3) * 320, top: Math.floor(tiles.length / 3) * 360 });
    }
    await sharp({ create: { width: 960, height: Math.ceil(tiles.length / 3) * 360, channels: 3, background: "white" } }).composite(tiles).png().toFile(`${out}/${area.id}.png`);
    areas.push({ area: area.id, roadHash: area.sha256, generated: loops.length, validDistinctPool: pool.length, records });
  }
  for (const [file, hash] of Object.entries(codeHashes)) expect(sha(readFileSync(file))).toBe(hash);
  writeFileSync(`${out}/results.json`, JSON.stringify({ spec, codeHashes, areas }, null, 2));
}, 180000);

