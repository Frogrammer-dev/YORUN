import { readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BBox, OverpassJson } from "./osm";
let current: { file: string; db: DatabaseSync; timestamp: string } | undefined;
export function readLocalRoads(area: BBox, directory = process.env.ROAD_DATA_DIR || path.join(process.cwd(), "data", "roads")): OverpassJson {
  const manifest = JSON.parse(readFileSync(/* turbopackIgnore: true */ path.join(directory, "manifest.json"), "utf8")) as { file: string; schema: string; timestamp: string };
  if (manifest.schema !== "1" || !/^roads-[\w-]+\.sqlite$/.test(manifest.file) || !Number.isFinite(Date.parse(manifest.timestamp))) throw new Error("road_data_unavailable");
  const file = path.resolve(directory, manifest.file);
  if (current?.file !== file) {
    const db = new DatabaseSync(file, { readOnly: true });
    current?.db.close();
    current = { file, db, timestamp: manifest.timestamp };
  }
  const rows = current.db.prepare("SELECT w.id,w.geometry,w.tags FROM bounds b JOIN ways w ON w.id=b.id WHERE b.min_lon<=? AND b.max_lon>=? AND b.min_lat<=? AND b.max_lat>=? LIMIT 30001").all(area.east, area.west, area.north, area.south) as Array<{ id: number; geometry: string; tags: string }>;
  if (rows.length > 30000) throw new Error("road_area_too_large");
  const nodes = new Map<number, { type: "node"; id: number; lat: number; lon: number }>();
  let vertices = 0;
  const ways = rows.map(row => {
    const geometry = JSON.parse(row.geometry) as Array<[number, number, number]>;
    vertices += geometry.length;
    if (vertices > 500000) throw new Error("road_area_too_large");
    for (const [id, lat, lon] of geometry) nodes.set(id, { type: "node", id, lat, lon });
    return { type: "way" as const, id: row.id, nodes: geometry.map(n => n[0]), tags: JSON.parse(row.tags) as Record<string, string> };
  });
  return { osm3s: { timestamp_osm_base: current.timestamp }, elements: [...nodes.values(), ...ways] };
}
