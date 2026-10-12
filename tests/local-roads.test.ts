import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { readLocalRoads } from "../src/lib/route/roadData.server";

describe("stored road queries", () => {
  it("preserves shared OSM node IDs and whole ways without network access", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "yorun-roads-"));
    const db = new DatabaseSync(path.join(directory, "roads-test.sqlite"));
    db.exec("CREATE TABLE ways(id INTEGER PRIMARY KEY, geometry TEXT, tags TEXT); CREATE VIRTUAL TABLE bounds USING rtree(id,min_lon,max_lon,min_lat,max_lat)");
    const insert = db.prepare("INSERT INTO ways VALUES (?,?,?)");
    insert.run(1, JSON.stringify([[10,37,127],[11,37.01,127.01]]), '{"highway":"residential"}');
    insert.run(2, JSON.stringify([[11,37.01,127.01],[12,37.02,127.02]]), '{"highway":"footway"}');
    db.exec("INSERT INTO bounds VALUES (1,127,127.01,37,37.01),(2,127.01,127.02,37.01,37.02)");
    db.close();
    writeFileSync(path.join(directory,"manifest.json"), JSON.stringify({ file:"roads-test.sqlite", schema:"1", timestamp:"2026-10-09T20:21:04Z" }));
    const fetch = vi.spyOn(globalThis,"fetch");
    const result = readLocalRoads({south:37.009,north:37.011,west:127.009,east:127.011},directory);
    expect(result.elements.filter(e=>e.type==="node")).toHaveLength(3);
    expect(result.elements.filter(e=>e.type==="way")).toHaveLength(2);
    expect(result.osm3s?.timestamp_osm_base).toBe("2026-10-09T20:21:04Z");
    expect(readLocalRoads({south:38,north:38.01,west:128,east:128.01},directory).elements).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("rejects manifest paths outside the installed directory", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "yorun-roads-"));
    writeFileSync(path.join(directory,"manifest.json"), JSON.stringify({ file:"../other.sqlite", schema:"1", timestamp:"2026-10-09T20:21:04Z" }));
    expect(()=>readLocalRoads({south:37,north:37.01,west:127,east:127.01},directory)).toThrow("road_data_unavailable");
  });
});
